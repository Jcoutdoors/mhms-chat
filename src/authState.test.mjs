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

test('logout from community returns to entry choice', () => {
  assert.equal(transition(S.COMMUNITY, E.LOGOUT).state, S.ENTRY_CHOICE);
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
});

test('changed flag is true only on a real state change', () => {
  assert.equal(transition(S.BOOTING, E.BOOT).changed, true);
});
