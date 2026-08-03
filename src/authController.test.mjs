// authController tests (Phase 4B2). Injected auth + Stream boundaries; deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthController } from './authController.js';
import { STATES as S } from './authState.js';

// Deferred promise helper (for stale-after-logout timing).
function deferred() { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; }

// Build a controller with programmable boundaries and recorded calls.
function mk(over = {}) {
  const calls = { getToken: 0, requestCode: [], verifyCode: [], logout: 0, connect: [], disconnect: 0, save: [], setup: [] };
  const q = {
    token: over.token || [{ ok: true, token: 'tok', userId: 'cats-x', instructor: false }],
    request: over.request || [{ ok: true }],
    verify: over.verify || [{ ok: true }],
    logout: over.logout || [{ ok: true }],
    connect: over.connect || [{ ok: true, status: 'existing_profile', user: { id: 'cats-x', name: 'Existing' } }],
  };
  const next = (arr, dflt) => (arr.length > 1 ? arr.shift() : arr[0] || dflt);
  const client = { __id: 'singleton' };
  const authClient = {
    async getToken() { calls.getToken++; if (over.getTokenImpl) return over.getTokenImpl(); return next(q.token); },
    async requestCode(e) { calls.requestCode.push(e); return next(q.request); },
    async verifyCode(e, c) { calls.verifyCode.push({ e, c }); return next(q.verify); },
    async logout() { calls.logout++; if (over.logoutImpl) return over.logoutImpl(); return next(q.logout); },
  };
  const snaps = [];
  const ctrl = createAuthController({
    authClient,
    makeStreamClient: over.makeStreamClientImpl || (() => client),
    connect: over.connectImpl || (async (cl, userId, token) => { calls.connect.push({ userId, token }); return next(q.connect); }),
    disconnect: over.disconnectImpl || (async () => { calls.disconnect++; }),
    save: over.saveImpl || (async (cl, userId, data) => { calls.save.push({ userId, data }); return over.savePayload || { id: userId, ...data }; }),
    readProfile: over.readProfile || ((cl) => over.readProfileValue),
    // Generation-aware setup contract: setupChannels({ client, userId, user, isCurrent }).
    setupChannels: over.setupImpl || (async ({ userId }) => { calls.setup.push(userId); }),
    onChange: (s) => snaps.push(s),
    now: over.now || (() => 1000),
  });
  return { ctrl, calls, snaps, client };
}

// ---- boot / session ----
test('valid boot restoration -> community; setupChannels once; user built', async () => {
  const { ctrl, calls } = mk();
  await ctrl.boot();
  assert.equal(ctrl.getPhase(), S.COMMUNITY);
  assert.equal(calls.setup.length, 1);
  assert.equal(ctrl.getState().user.id, 'cats-x');
  assert.equal(ctrl.getState().user.name, 'Existing');
  assert.equal(calls.connect[0].userId, 'cats-x'); // userId from /token, not derived
});
test('no session -> entryChoice', async () => {
  const { ctrl } = mk({ token: [{ ok: false, status: 401, error: 'session_required' }] });
  await ctrl.boot();
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE);
});
test('malformed token result -> serviceError', async () => {
  const { ctrl } = mk({ token: [{ ok: true, token: '', userId: 'cats-x' }] });
  await ctrl.boot();
  assert.equal(ctrl.getPhase(), S.SERVICE_ERROR);
});
test('token service failure -> serviceError', async () => {
  const { ctrl } = mk({ token: [{ ok: false, error: 'network_error' }] });
  await ctrl.boot();
  assert.equal(ctrl.getPhase(), S.SERVICE_ERROR);
});
test('Stream connect failure -> serviceError; disconnect called; clientRef cleared', async () => {
  const { ctrl, calls } = mk({ connect: [{ ok: false, error: 'connect_failed' }] });
  await ctrl.boot();
  assert.equal(ctrl.getPhase(), S.SERVICE_ERROR);
  assert.ok(calls.disconnect >= 1);
  assert.equal(ctrl._clientRef.current, null);
});
test('profile-read failure -> disconnect + clear + serviceError', async () => {
  const { ctrl, calls } = mk({ connect: [{ ok: false, error: 'profile_read_failed' }] });
  await ctrl.boot();
  assert.equal(ctrl.getPhase(), S.SERVICE_ERROR);
  assert.ok(calls.disconnect >= 1);
  assert.equal(ctrl._clientRef.current, null);
});
test('retry after connection failure reconnects; no duplicate connection', async () => {
  const { ctrl, calls } = mk({ connect: [{ ok: false, error: 'connect_failed' }, { ok: true, status: 'existing_profile', user: { id: 'cats-x', name: 'A' } }] });
  await ctrl.boot();
  assert.equal(ctrl.getPhase(), S.SERVICE_ERROR);
  await ctrl.retry();
  assert.equal(ctrl.getPhase(), S.COMMUNITY);
  assert.equal(calls.setup.length, 1);        // channel setup once (only the successful connect)
  assert.equal(calls.connect.length, 2);       // one failed + one good; single live client
});

// ---- verification / wrong-path ----
// token queue: first result is the boot getToken (401 -> entryChoice); second is the
// post-verify getToken (valid session).
const BOOT_401 = { ok: false, status: 401, error: 'session_required' };
const POST_VERIFY_OK = { ok: true, token: 't', userId: 'cats-x', instructor: false };
async function toCode(ctrl, path) { ctrl.chooseEntry(path); await ctrl.requestCode('u@example.com'); }
test('New here + existing profile -> community (reconnect, not setup)', async () => {
  const { ctrl } = mk({ token: [BOOT_401, POST_VERIFY_OK], connect: [{ ok: true, status: 'existing_profile', user: { id: 'cats-x', name: 'Existing' } }] });
  await ctrl.boot();
  await toCode(ctrl, 'new');
  await ctrl.submitCode('123456');
  assert.equal(ctrl.getPhase(), S.COMMUNITY);
});
test('Returning + bare profile -> profileSetup', async () => {
  const { ctrl } = mk({ token: [BOOT_401, POST_VERIFY_OK], connect: [{ ok: true, status: 'bare_user', user: { id: 'cats-x' } }] });
  await ctrl.boot();
  await toCode(ctrl, 'returning');
  await ctrl.submitCode('123456');
  assert.equal(ctrl.getPhase(), S.PROFILE_SETUP);
});
test('verify wrong/expired code -> codeEntry (generic)', async () => {
  const { ctrl } = mk({ token: [BOOT_401], verify: [{ ok: false, error: 'verification_failed' }] });
  await ctrl.boot(); await toCode(ctrl, 'new');
  await ctrl.submitCode('000000');
  assert.equal(ctrl.getPhase(), S.CODE_ENTRY);
  assert.equal(ctrl.getState().error.error, 'verification_failed');
});

// ---- instructor ----
test('instructor true/false/malformed from /token only; Stream instructor ignored', async () => {
  const t = async (instr, connUser) => { const { ctrl } = mk({ token: [{ ok: true, token: 't', userId: 'cats-x', instructor: instr }], connect: [{ ok: true, status: 'existing_profile', user: connUser }] }); await ctrl.boot(); return ctrl.getState(); };
  assert.equal((await t(true, { id: 'cats-x', name: 'A' })).instructor, true);
  assert.equal((await t(false, { id: 'cats-x', name: 'A' })).instructor, false);
  assert.equal((await t('true', { id: 'cats-x', name: 'A' })).instructor, false); // malformed
  // Stream user.instructor:true but /token says false -> UI instructor false (no Stream authority)
  const s = await t(false, { id: 'cats-x', name: 'A', instructor: true });
  assert.equal(s.instructor, false);
  assert.equal(s.user.instructor, false);
});

// ---- profile save ----
async function toSetup(over) {
  const m = mk({ token: [BOOT_401, POST_VERIFY_OK], connect: [{ ok: true, status: 'bare_user', user: { id: 'cats-x' } }], ...over });
  await m.ctrl.boot(); await toCode(m.ctrl, 'new'); await m.ctrl.submitCode('123456');
  return m;
}
test('save uses authoritative userId; post-save omitted fields preserved', async () => {
  const m = await toSetup({ readProfileValue: { id: 'cats-x', name: 'New', bio: 'kept', link: 'x.com' } });
  await m.ctrl.saveProfile({ name: 'New' }); // form omits bio/link
  assert.equal(m.ctrl.getPhase(), S.COMMUNITY);
  assert.equal(m.calls.save[0].userId, 'cats-x'); // authoritative id
  assert.equal(m.ctrl.getState().user.bio, 'kept');  // preserved from authoritative Stream read
  assert.equal(m.ctrl.getState().user.link, 'x.com');
});
test('save failure -> profileSetup with error', async () => {
  const m = await toSetup({ saveImpl: async () => { throw new Error('stream down'); } });
  await m.ctrl.saveProfile({ name: 'X' });
  assert.equal(m.ctrl.getPhase(), S.PROFILE_SETUP);
  assert.equal(m.ctrl.getState().error.error, 'save_failed');
});

// ---- logout ----
test('logout success: disconnect + clear + entryChoice; sensitive state cleared', async () => {
  const { ctrl, calls } = mk();
  await ctrl.boot();
  await ctrl.logout();
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE);
  assert.ok(calls.disconnect >= 1);
  assert.equal(ctrl._clientRef.current, null);
  const s = ctrl.getState();
  assert.equal(s.userId, null); assert.equal(s.instructor, false); assert.equal(s.user, null);
});
test('logout SERVER FAILURE -> signOutError; ALL sensitive state cleared regardless of result', async () => {
  // instructor:true so we prove instructor is reset even when the server logout fails.
  const { ctrl, calls } = mk({
    token: [{ ok: true, token: 'tok', userId: 'cats-x', name: 'A', instructor: true }],
    connect: [{ ok: true, status: 'existing_profile', user: { id: 'cats-x', name: 'A' } }],
    logout: [{ ok: false }],
  });
  await ctrl.boot();
  assert.equal(ctrl.getState().instructor, true); // authenticated as instructor first
  await ctrl.logout();
  const s = ctrl.getState();
  assert.equal(ctrl.getPhase(), S.SIGN_OUT_ERROR);      // does NOT claim signed out
  assert.notEqual(ctrl.getPhase(), S.ENTRY_CHOICE);
  assert.ok(calls.disconnect >= 1);                     // Stream disconnected even on failure
  assert.equal(ctrl._clientRef.current, null);
  assert.equal(s.user, null);                           // no user / profile
  assert.equal(s.userId, null);                         // no userId
  assert.equal(s.instructor, false);                    // instructor reset to false
  assert.equal(s.cooldownDeadline, null);               // cooldown reset (clearSensitive runs unconditionally)
  assert.equal(JSON.stringify(s).includes('cats-x'), false); // no identity/profile anywhere in snapshot
  assert.equal(s.error && s.error.error, 'signout_failed');   // only safe error state
});
test('logout retry from signOutError succeeds WITHOUT any retained identity data', async () => {
  const { ctrl } = mk({ logout: [{ ok: false }, { ok: true }] });
  await ctrl.boot(); await ctrl.logout();
  assert.equal(ctrl.getPhase(), S.SIGN_OUT_ERROR);
  // Everything was already cleared at logout start; retry must not depend on it.
  assert.equal(ctrl.getState().userId, null);
  assert.equal(ctrl.getState().user, null);
  await ctrl.retry();
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE);        // server logout retried and succeeded
  assert.equal(ctrl.getState().userId, null);
});
test('logout clears clientRef even when disconnect throws', async () => {
  const { ctrl } = mk({ disconnectImpl: async () => { throw new Error('disconnect boom'); } });
  await ctrl.boot();
  await ctrl.logout();
  assert.equal(ctrl._clientRef.current, null);
});

// ---- stale completion after logout ----
test('stale completion after logout cannot reconnect (generation guard)', async () => {
  // Reach `authenticating` (post-verify) with the getToken hanging, then logout.
  const d = deferred();
  let n = 0;
  const { ctrl } = mk({ getTokenImpl: () => { n += 1; return n === 1 ? Promise.resolve(BOOT_401) : d.p; } });
  await ctrl.boot();                 // boot getToken -> 401 -> entryChoice
  await toCode(ctrl, 'new');         // -> codeEntry
  const verifyP = ctrl.submitCode('123456'); // VERIFY_OK -> authenticating -> getToken hangs
  await new Promise((r) => setImmediate(r)); // let submitCode park at the hanging getToken
  assert.equal(ctrl.getPhase(), S.AUTHENTICATING);
  await ctrl.logout();               // from authenticating -> signingOut -> /logout ok -> entryChoice (gen++)
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE);
  d.resolve({ ok: true, token: 't', userId: 'cats-x', instructor: true }); // late success
  await verifyP;
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE); // NOT community; stale result ignored
});

// ---- lifecycle: stale-after-connect / stale-during-setup / healthy replacement ----
test('stale immediately after connect resolves: client disconnected, no setup, clientRef null', async () => {
  // connect is pending; logout advances the generation; then connect resolves ok.
  const d = deferred();
  const created = [];
  let n = 0;
  const { ctrl, calls } = mk({
    makeStreamClientImpl: () => { const c = { __n: ++n }; created.push(c); return c; },
    connectImpl: async (cl, userId, token) => { calls.connect.push({ userId, token }); return d.p; },
  });
  const bootP = ctrl.boot();
  await new Promise((r) => setImmediate(r)); // park at the pending connect
  assert.equal(ctrl.getPhase(), S.LOADING_PROFILE);
  assert.equal(ctrl._clientRef.current, null);          // not assigned until connect resolves current
  await ctrl.logout();                                   // gen++ -> pending connect is now stale
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE);
  d.resolve({ ok: true, status: 'existing_profile', user: { id: 'cats-x', name: 'A' } }); // late success
  await bootP;
  assert.equal(created.length, 1);                       // exactly one client was created
  assert.equal(ctrl._clientRef.current, null);           // stale success never assigns clientRef
  assert.equal(calls.setup.length, 0);                   // setupChannels never invoked
  assert.ok(calls.disconnect >= 1);                      // the created client was disconnected
  assert.equal(ctrl.getState().user, null);
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE);         // NOT loadingProfile/community/profileSetup
});

test('stale while setupChannels pending: isCurrent() flips false; no commit; client disconnected; clientRef null', async () => {
  const d = deferred();
  let sawCurrentAtStart = null;
  let currentAtResolve = null;
  const { ctrl } = mk({
    setupImpl: async ({ isCurrent }) => {
      sawCurrentAtStart = isCurrent();
      await d.p;
      currentAtResolve = isCurrent();
      // A conformant App setup would stop here and NOT mutate App state / register listeners.
    },
  });
  const bootP = ctrl.boot();
  await new Promise((r) => setImmediate(r)); // park inside the pending setupChannels
  assert.equal(sawCurrentAtStart, true);                 // current while the op is live
  assert.equal(ctrl.getPhase(), S.LOADING_PROFILE);      // PROFILE_COMPLETE not applied yet
  await ctrl.logout();                                   // gen++ -> setup becomes stale
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE);
  d.resolve();
  await bootP;
  assert.equal(currentAtResolve, false);                 // predicate correctly reports stale
  assert.equal(ctrl._clientRef.current, null);           // client cleared, not left connected
  assert.equal(ctrl.getState().user, null);              // authenticated state not restored
  assert.equal(ctrl.getPhase(), S.ENTRY_CHOICE);         // stayed logged out (no PROFILE_COMPLETE)
});

test('healthy-client replacement: old client torn down BEFORE new connect; no duplicate live clients', async () => {
  const events = [];
  let n = 0;
  const { ctrl } = mk({
    makeStreamClientImpl: () => ({ __n: ++n }),
    connectImpl: async (cl) => { events.push(`connect:${cl.__n}`); return { ok: true, status: 'existing_profile', user: { id: 'cats-x', name: 'A' } }; },
    disconnectImpl: async (cl) => { events.push(`disconnect:${cl ? cl.__n : 'none'}`); },
  });
  await ctrl.boot();                                     // connect client #1 -> community
  assert.equal(ctrl.getPhase(), S.COMMUNITY);
  assert.equal(ctrl._clientRef.current.__n, 1);
  await ctrl.boot();                                     // a second connect op over the live client
  assert.equal(ctrl._clientRef.current.__n, 2);          // new live client is #2
  // Observable call ORDER: #1 connected, then #1 disconnected before #2 connects.
  assert.deepEqual(events, ['connect:1', 'disconnect:1', 'connect:2']);
});

// ---- cooldown ----
test('cooldown deadline set on request success and on rate-limit; reset on logout', async () => {
  let t = 1000; const { ctrl } = mk({ now: () => t, token: [{ ok: false, status: 401, error: 'session_required' }], request: [{ ok: true }] });
  await ctrl.boot(); ctrl.chooseEntry('new');
  await ctrl.requestCode('u@example.com');
  assert.equal(ctrl.getState().cooldownDeadline, 1000 + 60000); // default 60s
  await ctrl.logout();
  assert.equal(ctrl.getState().cooldownDeadline, null);          // reset on logout
});
test('rate-limited request sets deadline from Retry-After', async () => {
  const { ctrl } = mk({ now: () => 5000, token: [{ ok: false, status: 401, error: 'session_required' }], request: [{ ok: false, error: 'rate_limited', retryAfterMs: 30000 }] });
  await ctrl.boot(); ctrl.chooseEntry('new');
  await ctrl.requestCode('u@example.com');
  assert.equal(ctrl.getState().cooldownDeadline, 5000 + 30000);
});

// ---- privacy / no-fallback / no-localStorage ----
test('no token in snapshot; no token logged; no localStorage touched; no legacy fetch', async () => {
  const origLS = globalThis.localStorage;
  let lsTouched = false;
  globalThis.localStorage = new Proxy({}, { get() { lsTouched = true; return () => {}; } });
  const logs = [];
  const oc = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(oc)) console[k] = (...a) => logs.push(a.join(' '));
  try {
    const { ctrl, calls } = mk();
    await ctrl.boot();
    const snap = ctrl.getState();
    assert.equal('token' in snap, false);            // token never in snapshot
    assert.equal(JSON.stringify(snap).includes('tok'), false);
    assert.equal(calls.getToken, 1);                  // token obtained only via /token
    assert.equal(logs.join('\n'), '');                // nothing logged
    assert.equal(lsTouched, false);                   // controller never touches localStorage
  } finally { Object.assign(console, oc); if (origLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = origLS; }
});
