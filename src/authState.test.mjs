// authState tests (Phase 4A1). Pure transitions; deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_STATE, STATES as S, EVENTS as E, transition, canTransition } from './authState.js';

// Drive a sequence of events, asserting the resulting state at the end.
function run(start, events) {
  let state = start;
  for (const ev of events) state = transition(state, ev).state;
  return state;
}

test('initial state is booting', () => {
  assert.equal(INITIAL_STATE, S.BOOTING);
});

test('valid session on boot restores straight to community when profile complete', () => {
  const end = run(S.BOOTING, [E.BOOT, E.SESSION_VALID, E.PROFILE_COMPLETE]);
  assert.equal(end, S.COMMUNITY);
});

test('valid session with incomplete profile routes to profile setup', () => {
  const end = run(S.BOOTING, [E.BOOT, E.SESSION_VALID, E.PROFILE_INCOMPLETE]);
  assert.equal(end, S.PROFILE_SETUP);
});

test('no session on boot routes to entry choice', () => {
  const end = run(S.BOOTING, [E.BOOT, E.SESSION_NONE]);
  assert.equal(end, S.ENTRY_CHOICE);
});

test('boot service error is distinct from unauthenticated and can retry', () => {
  const afterError = run(S.BOOTING, [E.BOOT, E.SERVICE_ERROR]);
  assert.equal(afterError, S.SERVICE_ERROR);
  assert.equal(transition(afterError, E.RETRY).state, S.CHECKING_SESSION);
});

test('full new-user verification flow to community', () => {
  const end = run(S.ENTRY_CHOICE, [
    E.CHOOSE_ENTRY, E.SUBMIT_EMAIL, E.CODE_REQUEST_OK, E.SUBMIT_CODE,
    E.VERIFY_OK, E.TOKEN_OK, E.PROFILE_INCOMPLETE, E.SAVE_PROFILE, E.SAVE_OK,
  ]);
  assert.equal(end, S.COMMUNITY);
});

test('full returning-user flow (existing profile) to community', () => {
  const end = run(S.ENTRY_CHOICE, [
    E.CHOOSE_ENTRY, E.SUBMIT_EMAIL, E.CODE_REQUEST_OK, E.SUBMIT_CODE,
    E.VERIFY_OK, E.TOKEN_OK, E.PROFILE_COMPLETE,
  ]);
  assert.equal(end, S.COMMUNITY);
});

test('wrong code returns to code entry, then a resend re-requests', () => {
  const afterFail = run(S.CODE_ENTRY, [E.SUBMIT_CODE, E.VERIFY_FAIL]);
  assert.equal(afterFail, S.CODE_ENTRY);
  assert.equal(transition(afterFail, E.SUBMIT_EMAIL).state, S.REQUESTING_CODE);
});

test('verify rate-limit stays on code entry', () => {
  assert.equal(run(S.CODE_ENTRY, [E.SUBMIT_CODE, E.VERIFY_RATELIMITED]), S.CODE_ENTRY);
});

test('logout from community begins signingOut; LOGOUT_OK -> entryChoice', () => {
  const so = transition(S.COMMUNITY, E.LOGOUT).state;
  assert.equal(so, S.SIGNING_OUT);
  assert.equal(transition(so, E.LOGOUT_OK).state, S.ENTRY_CHOICE);
});

test('session expiry from community routes through sessionExpired to entry', () => {
  const expired = transition(S.COMMUNITY, E.SESSION_EXPIRED).state;
  assert.equal(expired, S.SESSION_EXPIRED);
  assert.equal(transition(expired, E.RETRY).state, S.ENTRY_CHOICE);
});

test('edit profile from community and save returns to community', () => {
  const setup = transition(S.COMMUNITY, E.EDIT_PROFILE).state;
  assert.equal(setup, S.PROFILE_SETUP);
  assert.equal(run(setup, [E.SAVE_PROFILE, E.SAVE_OK]), S.COMMUNITY);
});

test('invalid transitions are no-ops (changed:false), never throw', () => {
  const r = transition(S.COMMUNITY, E.SUBMIT_CODE);
  assert.equal(r.state, S.COMMUNITY);
  assert.equal(r.changed, false);
  // unknown state
  const u = transition('not-a-state', E.BOOT);
  assert.equal(u.changed, false);
  assert.equal(u.state, 'not-a-state');
  // unknown event
  assert.equal(transition(S.BOOTING, 'NONSENSE').changed, false);
});

test('canTransition reflects the table', () => {
  assert.equal(canTransition(S.BOOTING, E.BOOT), true);
  assert.equal(canTransition(S.BOOTING, E.LOGOUT), false);
  assert.equal(canTransition(S.COMMUNITY, E.LOGOUT), true);
  assert.equal(canTransition(S.SIGNING_OUT, E.LOGOUT_OK), true);
  assert.equal(canTransition(S.SIGNING_OUT, E.LOGOUT_FAILED), true);
});

test('changed flag is true only on a real state change', () => {
  assert.equal(transition(S.BOOTING, E.BOOT).changed, true);
});

// ---- global safety events (Phase 4A1 re-review) ----

test('LOGOUT from an authenticated state -> signingOut; from others it is a no-op', () => {
  const AUTH = [S.AUTHENTICATING, S.LOADING_PROFILE, S.PROFILE_SETUP, S.SAVING_PROFILE, S.COMMUNITY];
  for (const st of Object.values(S)) {
    const r = transition(st, E.LOGOUT);
    if (AUTH.includes(st)) assert.equal(r.state, S.SIGNING_OUT, `logout from ${st} -> signingOut`);
    else { assert.equal(r.changed, false, `logout from ${st} is a no-op`); assert.equal(r.state, st); }
  }
});

test('truthful logout: LOGOUT_OK -> entryChoice; LOGOUT_FAILED -> signOutError; RETRY -> signingOut', () => {
  const so = transition(S.COMMUNITY, E.LOGOUT).state;
  assert.equal(so, S.SIGNING_OUT);
  assert.equal(transition(so, E.LOGOUT_OK).state, S.ENTRY_CHOICE);
  const err = transition(so, E.LOGOUT_FAILED).state;
  assert.equal(err, S.SIGN_OUT_ERROR);
  assert.equal(transition(err, E.RETRY).state, S.SIGNING_OUT); // retry re-attempts logout
});

test('logout during authenticating/savingProfile -> signingOut', () => {
  assert.equal(transition(S.AUTHENTICATING, E.LOGOUT).state, S.SIGNING_OUT);
  assert.equal(transition(S.SAVING_PROFILE, E.LOGOUT).state, S.SIGNING_OUT);
});

test('stale async success after logout cannot reconnect: no-ops from signingOut/signOutError/entryChoice', () => {
  const so = transition(S.COMMUNITY, E.LOGOUT).state; // signingOut
  for (const ev of [E.VERIFY_OK, E.TOKEN_OK, E.SAVE_OK, E.PROFILE_COMPLETE, E.SESSION_VALID]) {
    assert.equal(transition(so, ev).changed, false, `${ev} from signingOut`);
  }
  const err = transition(so, E.LOGOUT_FAILED).state; // signOutError
  for (const ev of [E.VERIFY_OK, E.TOKEN_OK, E.PROFILE_COMPLETE]) assert.equal(transition(err, ev).changed, false, `${ev} from signOutError`);
  const entry = transition(so, E.LOGOUT_OK).state; // entryChoice
  for (const ev of [E.VERIFY_OK, E.TOKEN_OK, E.PROFILE_COMPLETE]) assert.equal(transition(entry, ev).changed, false, `${ev} from entryChoice`);
});

test('SESSION_EXPIRED handled from every authenticated state', () => {
  for (const st of [S.AUTHENTICATING, S.LOADING_PROFILE, S.PROFILE_SETUP, S.SAVING_PROFILE, S.COMMUNITY]) {
    assert.equal(transition(st, E.SESSION_EXPIRED).state, S.SESSION_EXPIRED, `expiry from ${st}`);
  }
});

test('session expiry during profileSetup and savingProfile is handled', () => {
  assert.equal(transition(S.PROFILE_SETUP, E.SESSION_EXPIRED).state, S.SESSION_EXPIRED);
  assert.equal(transition(S.SAVING_PROFILE, E.SESSION_EXPIRED).state, S.SESSION_EXPIRED);
});

test('SESSION_EXPIRED is NOT accepted from unauthenticated states (no-op)', () => {
  for (const st of [S.ENTRY_CHOICE, S.EMAIL_ENTRY, S.CODE_ENTRY, S.VERIFYING]) {
    assert.equal(transition(st, E.SESSION_EXPIRED).changed, false, st);
  }
});

test('global events take precedence but per-state transitions still work', () => {
  // community: EDIT_PROFILE (per-state) still works; LOGOUT (global) begins signingOut.
  assert.equal(transition(S.COMMUNITY, E.EDIT_PROFILE).state, S.PROFILE_SETUP);
  assert.equal(transition(S.COMMUNITY, E.LOGOUT).state, S.SIGNING_OUT);
  assert.equal(canTransition(S.COMMUNITY, E.LOGOUT), true);
  assert.equal(canTransition(S.VERIFYING, E.LOGOUT), false); // pre-auth: no logout
  assert.equal(canTransition(S.COMMUNITY, E.SESSION_EXPIRED), true);
});
