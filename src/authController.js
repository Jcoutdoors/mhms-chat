// Verified-auth controller (VIF Phase 4B2). Owns the async orchestration so App()
// is a thin binding: it drives the authState machine, manages the Stream client
// lifecycle, and enforces the mandatory 4B2 adjustments. Fully unit-testable via
// injected `deps` (no React, no real network, no real Stream).
//
// TOKEN LIFETIME: the Stream token exists ONLY as a local variable inside the
// authenticate/connect operation. It is never placed on the controller, in the
// emitted snapshot, in storage, in logs, or in errors. After connect it goes out
// of scope.
//
// STREAM CLIENT LIFECYCLE (single, explicit):
//   - `clientRef.current` is assigned ONLY in _connectAndRoute, after a successful
//     connect + profile read.
//   - Before connecting a newly verified identity we tear down any existing client
//     (disconnect + clear) — never connect a second identity over a live one.
//   - If connectUser succeeds but the profile read fails, we disconnect + clear
//     before entering serviceError.
//   - Before retrying a Stream failure we disconnect + clear.
//   - logout clears clientRef.current even if disconnect throws (finally).
//   - A stale async op (after the generation guard advances) tears down any client
//     it created and never restores clientRef — it cannot resurrect a disconnected
//     session, nor create duplicate watchers/listeners.
//
// GENERATION GUARD: `gen` advances on logout. Every async step captures gen at
// start and aborts (without applying results) if gen changed — so late completions
// after logout are no-ops (belt-and-suspenders with the machine's signingOut no-op).
//
// TRUTHFUL LOGOUT: when logout BEGINS we disconnect Stream through the guarded
// lifecycle and clear ALL local authenticated + profile state immediately
// (clearSensitive) — regardless of the server result. Then POST /logout: success ->
// entryChoice; failure -> signOutError, which holds only safe error/retry state.
// A failed logout does NOT claim the cookie-backed session ended (a refresh may
// restore a still-valid server session), and we never locally restore the previous
// user. Retry needs no retained identity. localStorage is never a logout tombstone.
//
// SETUP CHANNELS CONTRACT (generation-aware): setupChannels is invoked as
//   setupChannels({ client, userId, user, isCurrent })
// where isCurrent() returns true only while THIS operation's generation is current
// (no logout / newer op has superseded it). The App-side implementation (Commit 2)
// MUST consult isCurrent(): before network stages, after each awaited stage, before
// every App-state mutation (currentUser, channels, messages, unread, threads,
// Featured Updates), before registering listeners/watchers, and before setting the
// active channel; and it MUST dispose any listener/unsubscribe handles it allocated
// if it becomes stale. The controller ALSO re-checks staleness after setupChannels
// resolves and disconnects + clears clientRef on a stale completion — it does not
// rely on that post-check alone.

'use strict';

const { INITIAL_STATE, EVENTS, transition } = require('./authState.js');
const {
  tokenResultToEvent, connectResultToEvent, requestCodeResultToEvent,
  submitCodeResultToEvent, validateInstructor,
} = require('./authIntegration.js');
const { deadlineFromRetryAfter } = require('./cooldown.js');

const PROFILE_FIELDS = ['name', 'color', 'image', 'bio', 'link'];

function createAuthController(deps) {
  const {
    authClient, makeStreamClient, connect, disconnect, save, readProfile, setupChannels,
    onChange = () => {}, now = Date.now,
  } = deps;

  const st = {
    phase: INITIAL_STATE,
    entryPath: null,
    error: null,
    cooldownDeadline: null,
    userId: null,
    instructor: false,
    user: null,
  };
  const clientRef = { current: null };
  let email = '';        // internal only (for resend); never emitted/logged
  let streamUser = null; // last authoritative Stream user (for post-save merge)
  let gen = 0;

  const stale = (g) => g !== gen;
  const apply = (event) => { st.phase = transition(st.phase, event).state; };
  const emit = () => onChange(snapshot()); // NOTE: snapshot never contains token/email
  function snapshot() {
    return {
      phase: st.phase, entryPath: st.entryPath, error: st.error,
      cooldownDeadline: st.cooldownDeadline, userId: st.userId,
      instructor: st.instructor, user: st.user,
    };
  }
  function buildUser(su) {
    const out = { id: st.userId, instructor: st.instructor };
    if (su && typeof su === 'object') for (const f of PROFILE_FIELDS) if (su[f] !== undefined) out[f] = su[f];
    return out;
  }
  async function teardownClient() {
    const c = clientRef.current;
    if (!c) return;
    try { await disconnect(c); } catch { /* best-effort */ } finally { clientRef.current = null; }
  }
  // Clear ALL local authenticated + profile state. Used at logout start so nothing
  // sensitive survives, regardless of the server /logout result.
  function clearSensitive() {
    st.user = null;
    st.userId = null;
    st.instructor = false;
    st.cooldownDeadline = null;
    st.entryPath = null;
    st.error = null;
    email = '';
    streamUser = null;
  }

  // token is a LOCAL parameter only; never stored on `st`.
  async function connectAndRoute(g, userId, token, instructor) {
    await teardownClient();                 // disconnect-before-connect
    if (stale(g)) return;
    const client = makeStreamClient();
    let res;
    try { res = await connect(client, userId, token); } catch { res = { ok: false, error: 'connect_failed' }; }
    if (stale(g)) { try { await disconnect(client); } catch { /* ignore */ } return; }
    if (!res.ok) {                          // partial-connection cleanup before serviceError
      try { await disconnect(client); } catch { /* ignore */ }
      clientRef.current = null;
      st.error = { error: res.error };
      apply(EVENTS.PROFILE_LOAD_ERROR);     // loadingProfile -> serviceError
      emit();
      return;
    }
    clientRef.current = client;
    st.userId = userId;
    st.instructor = validateInstructor(instructor); // fail-closed; only /token claim
    streamUser = res.user;
    st.user = buildUser(streamUser);
    if (connectResultToEvent(res).event === EVENTS.PROFILE_COMPLETE) {
      try { await setupChannels({ client, userId, user: st.user, isCurrent: () => g === gen }); }
      catch { await teardownClient(); apply(EVENTS.PROFILE_LOAD_ERROR); emit(); return; }
      if (stale(g)) { await teardownClient(); return; } // belt-and-suspenders; App also honors isCurrent()
      apply(EVENTS.PROFILE_COMPLETE);       // -> community
    } else {
      apply(EVENTS.PROFILE_INCOMPLETE);     // -> profileSetup
    }
    emit();
  }

  // getToken -> (connect+route | entryChoice | serviceError). `origin` selects the
  // machine event on success: boot uses SESSION_VALID, post-verify uses TOKEN_OK.
  async function authenticate(origin) {
    const g = gen;
    let tk;
    try { tk = await authClient.getToken(); } catch { tk = { ok: false, error: 'network_error' }; }
    if (stale(g)) return;
    const ev = tokenResultToEvent(tk);
    if (ev.event === EVENTS.SESSION_VALID) {
      apply(origin === 'boot' ? EVENTS.SESSION_VALID : EVENTS.TOKEN_OK); // -> loadingProfile
      emit();
      await connectAndRoute(g, ev.userId, tk.token, ev.instructor); // token local only
    } else {
      apply(ev.event); // SESSION_NONE -> entryChoice ; SERVICE_ERROR -> serviceError
      emit();
    }
  }

  return {
    getState: snapshot,
    getPhase: () => st.phase,
    _clientRef: clientRef, // test visibility only

    async boot() { apply(EVENTS.BOOT); emit(); await authenticate('boot'); },

    chooseEntry(path) {
      st.entryPath = path === 'returning' ? 'returning' : 'new';
      st.error = null;
      apply(EVENTS.CHOOSE_ENTRY); emit();
    },

    async requestCode(addr) {
      email = String(addr || '');
      st.error = null;
      apply(EVENTS.SUBMIT_EMAIL); emit();
      const g = gen;
      let r; try { r = await authClient.requestCode(email); } catch { r = { ok: false, error: 'network_error' }; }
      if (stale(g)) return;
      const ev = requestCodeResultToEvent(r);
      if (ev.event === EVENTS.CODE_REQUEST_OK) st.cooldownDeadline = deadlineFromRetryAfter(undefined, now());
      else if (ev.event === EVENTS.CODE_REQUEST_RATELIMITED) { st.cooldownDeadline = deadlineFromRetryAfter(ev.retryAfterMs, now()); st.error = { error: r.error, retryAfterMs: r.retryAfterMs }; }
      else if (ev.event === EVENTS.CODE_REQUEST_INVALID) st.error = { error: r.error };
      apply(ev.event); emit();
    },

    async resend() { return this.requestCode(email); },

    async submitCode(code) {
      st.error = null;
      apply(EVENTS.SUBMIT_CODE); emit();
      const g = gen;
      let r; try { r = await authClient.verifyCode(email, code); } catch { r = { ok: false, error: 'network_error' }; }
      if (stale(g)) return;
      const ev = submitCodeResultToEvent(r);
      if (ev.event === EVENTS.VERIFY_OK) { apply(EVENTS.VERIFY_OK); emit(); await authenticate('verify'); return; }
      if (ev.event === EVENTS.VERIFY_RATELIMITED) { st.cooldownDeadline = deadlineFromRetryAfter(ev.retryAfterMs, now()); st.error = { error: r.error, retryAfterMs: r.retryAfterMs }; }
      else if (ev.event === EVENTS.VERIFY_FAIL) st.error = { error: r.error };
      apply(ev.event); emit();
    },

    async saveProfile(formData) {
      apply(EVENTS.SAVE_PROFILE); emit();
      const g = gen;
      const client = clientRef.current;
      try {
        const payload = await save(client, st.userId, formData); // authoritative userId; no instructor written
        if (stale(g)) return;
        // Post-save: rebuild currentUser from the AUTHORITATIVE Stream profile (merged),
        // not the partial form payload — omitted fields stay preserved.
        const after = (readProfile ? readProfile(client) : null) || Object.assign({}, streamUser || {}, payload);
        streamUser = after;
        st.user = buildUser(after);
        await setupChannels({ client, userId: st.userId, user: st.user, isCurrent: () => g === gen });
        if (stale(g)) return;
        apply(EVENTS.SAVE_OK); emit();
      } catch {
        if (stale(g)) return;
        st.error = { error: 'save_failed' };
        apply(EVENTS.SAVE_FAIL); emit();
      }
    },

    editProfile() { apply(EVENTS.EDIT_PROFILE); emit(); },

    // Truthful logout. Disconnect through the guarded lifecycle and clear ALL local
    // authenticated + profile state immediately (clearSensitive) — regardless of the
    // server result. Then POST /logout; success -> entryChoice, failure ->
    // signOutError holding only safe error/retry state (do NOT claim the cookie-backed
    // session ended; a refresh may restore a still-valid server session).
    async logout() {
      gen += 1; // invalidate any in-flight async
      const client = clientRef.current;
      try { await disconnect(client); } catch { /* best-effort; still clear */ } finally { clientRef.current = null; }
      clearSensitive(); // user, userId, instructor, streamUser, email, cooldown, entryPath, error
      apply(EVENTS.LOGOUT); emit(); // authenticated state -> signingOut
      let r; try { r = await authClient.logout(); } catch { r = { ok: false }; }
      if (r && r.ok) {
        apply(EVENTS.LOGOUT_OK); // -> entryChoice (state already cleared)
      } else {
        st.error = { error: 'signout_failed' }; // safe error/retry state only
        apply(EVENTS.LOGOUT_FAILED); // -> signOutError (cookie-backed session may still be valid)
      }
      emit();
    },

    // Retry: from signOutError re-attempt /logout (no retained identity needed — state
    // was already cleared at logout start); from serviceError re-run boot.
    async retry() {
      if (st.phase === 'signOutError') {
        apply(EVENTS.RETRY); emit(); // -> signingOut
        let r; try { r = await authClient.logout(); } catch { r = { ok: false }; }
        if (r && r.ok) { st.error = null; apply(EVENTS.LOGOUT_OK); } // -> entryChoice
        else { st.error = { error: 'signout_failed' }; apply(EVENTS.LOGOUT_FAILED); }
        emit();
        return;
      }
      apply(EVENTS.RETRY); emit(); // serviceError -> checkingSession
      await authenticate('boot');
    },
  };
}

module.exports = { createAuthController, PROFILE_FIELDS };
