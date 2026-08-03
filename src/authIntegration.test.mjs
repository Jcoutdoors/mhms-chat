// authIntegration tests (Phase 4B, corrected). Pure flow orchestration.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInstructor, tokenResultToEvent, profileToEvent, connectResultToEvent,
  requestCodeResultToEvent, submitCodeResultToEvent, applyEvent,
} from './authIntegration.js';
import { EVENTS as E, STATES as S, INITIAL_STATE, transition } from './authState.js';

test('validateInstructor: ONLY literal true -> true (fail closed)', () => {
  assert.equal(validateInstructor(true), true);
  for (const v of [false, undefined, null, 'true', 1, 0, {}, [], 'yes']) assert.equal(validateInstructor(v), false, String(v));
});

// ---- tokenResultToEvent: structural validation of a nominal success ----
test('tokenResultToEvent: fully valid -> SESSION_VALID with validated instructor', () => {
  assert.deepEqual(tokenResultToEvent({ ok: true, token: 't.t.t', userId: 'cats-x', instructor: true }),
    { event: E.SESSION_VALID, userId: 'cats-x', token: 't.t.t', instructor: true });
});
test('tokenResultToEvent: valid token/user_id, missing instructor -> instructor:false', () => {
  assert.equal(tokenResultToEvent({ ok: true, token: 't', userId: 'cats-x' }).instructor, false);
});
test('tokenResultToEvent: valid token/user_id, instructor:"true" -> instructor:false', () => {
  assert.equal(tokenResultToEvent({ ok: true, token: 't', userId: 'cats-x', instructor: 'true' }).instructor, false);
});
test('tokenResultToEvent: malformed nominal success -> SERVICE_ERROR (safe classification)', () => {
  const cases = [
    { ok: true, userId: 'cats-x' },                 // missing token
    { ok: true, token: '', userId: 'cats-x' },      // empty token
    { ok: true, token: 123, userId: 'cats-x' },     // non-string token
    { ok: true, token: 't' },                       // missing user_id
    { ok: true, token: 't', userId: '' },           // empty user_id
    { ok: true, token: 't', userId: 99 },           // non-string user_id
  ];
  for (const c of cases) {
    const r = tokenResultToEvent(c);
    assert.equal(r.event, E.SERVICE_ERROR, JSON.stringify(c));
    assert.equal(r.reason, 'malformed_token_result');
    assert.equal('token' in r, false); // token never carried/exposed on the error path
  }
});
test('tokenResultToEvent: 401/session errors -> SESSION_NONE; network/5xx -> SERVICE_ERROR', () => {
  assert.equal(tokenResultToEvent({ ok: false, status: 401, error: 'session_required' }).event, E.SESSION_NONE);
  assert.equal(tokenResultToEvent({ ok: false, error: 'session_invalid' }).event, E.SESSION_NONE);
  assert.equal(tokenResultToEvent({ ok: false, error: 'network_error' }).event, E.SERVICE_ERROR);
  assert.equal(tokenResultToEvent({ ok: false, error: 'service_unavailable', status: 503 }).event, E.SERVICE_ERROR);
});

test('profileToEvent: completeness of a successfully read user', () => {
  assert.equal(profileToEvent({ id: 'x', profile_version: 1 }), E.PROFILE_COMPLETE);
  assert.equal(profileToEvent({ id: 'x', name: 'Alex' }), E.PROFILE_COMPLETE);
  assert.equal(profileToEvent({ id: 'x', name: '   ' }), E.PROFILE_INCOMPLETE);
  assert.equal(profileToEvent({ id: 'x' }), E.PROFILE_INCOMPLETE);
});

test('connectResultToEvent: existing/bare/failure separation', () => {
  assert.equal(connectResultToEvent({ ok: true, status: 'existing_profile' }).event, E.PROFILE_COMPLETE);
  assert.equal(connectResultToEvent({ ok: true, status: 'bare_user' }).event, E.PROFILE_INCOMPLETE);
  assert.equal(connectResultToEvent({ ok: false, error: 'connect_failed' }).event, E.PROFILE_LOAD_ERROR);
  assert.equal(connectResultToEvent({ ok: false, error: 'profile_read_failed' }).event, E.PROFILE_LOAD_ERROR);
  assert.equal(connectResultToEvent(null).event, E.PROFILE_LOAD_ERROR); // defensive
});

test('request/submit result mapping', () => {
  assert.equal(requestCodeResultToEvent({ ok: true }).event, E.CODE_REQUEST_OK);
  assert.equal(requestCodeResultToEvent({ ok: false, error: 'invalid_request' }).event, E.CODE_REQUEST_INVALID);
  const rl = requestCodeResultToEvent({ ok: false, error: 'rate_limited', retryAfterMs: 5000 });
  assert.equal(rl.event, E.CODE_REQUEST_RATELIMITED); assert.equal(rl.retryAfterMs, 5000);
  assert.equal(requestCodeResultToEvent({ ok: false, error: 'network_error' }).event, E.SERVICE_ERROR);

  assert.equal(submitCodeResultToEvent({ ok: true }).event, E.VERIFY_OK);
  assert.equal(submitCodeResultToEvent({ ok: false, error: 'verification_failed' }).event, E.VERIFY_FAIL);
  assert.equal(submitCodeResultToEvent({ ok: false, error: 'verification_expired' }).event, E.VERIFY_FAIL);
  assert.equal(submitCodeResultToEvent({ ok: false, error: 'rate_limited', retryAfterMs: 1000 }).event, E.VERIFY_RATELIMITED);
  assert.equal(submitCodeResultToEvent({ ok: false, error: 'service_unavailable' }).event, E.SERVICE_ERROR);
});

// ---- integration: boot / routing / wrong-path / logout ----
// Boot uses tokenResultToEvent then connectResultToEvent (typed connect outcome).
function bootThrough(tokenResult, connectResult) {
  let st = INITIAL_STATE;
  st = transition(st, E.BOOT).state;                              // -> checkingSession
  st = transition(st, tokenResultToEvent(tokenResult).event).state; // -> loadingProfile | entryChoice | serviceError
  if (st === S.LOADING_PROFILE) st = transition(st, connectResultToEvent(connectResult).event).state;
  return st;
}
const VALID = { ok: true, token: 't', userId: 'cats-x', instructor: false };

test('boot: valid session + existing profile -> community (auto-restore)', () => {
  assert.equal(bootThrough(VALID, { ok: true, status: 'existing_profile' }), S.COMMUNITY);
});
test('boot: valid session + bare user -> profileSetup', () => {
  assert.equal(bootThrough(VALID, { ok: true, status: 'bare_user' }), S.PROFILE_SETUP);
});
test('boot: valid session + profile-read FAILURE -> serviceError (NOT profileSetup)', () => {
  assert.equal(bootThrough(VALID, { ok: false, error: 'profile_read_failed' }), S.SERVICE_ERROR);
});
test('boot: connection FAILURE -> serviceError (NOT profileSetup)', () => {
  assert.equal(bootThrough(VALID, { ok: false, error: 'connect_failed' }), S.SERVICE_ERROR);
});
test('boot: no session (401) -> entryChoice', () => {
  assert.equal(bootThrough({ ok: false, status: 401, error: 'session_required' }, null), S.ENTRY_CHOICE);
});
test('boot: /token network failure -> serviceError (not unauthenticated)', () => {
  assert.equal(bootThrough({ ok: false, error: 'network_error' }, null), S.SERVICE_ERROR);
});
test('boot: malformed /token success -> serviceError (not unauthenticated, not setup)', () => {
  assert.equal(bootThrough({ ok: true, userId: 'cats-x' /* no token */ }, null), S.SERVICE_ERROR);
});

test('wrong-path: routing depends on completeness/connect result, not the chosen path', () => {
  assert.equal(connectResultToEvent({ ok: true, status: 'existing_profile' }).event, E.PROFILE_COMPLETE); // New+existing -> reconnect
  assert.equal(connectResultToEvent({ ok: true, status: 'bare_user' }).event, E.PROFILE_INCOMPLETE);       // Returning+none -> setup
});

test('post-logout: late async success events are no-ops (cannot reconnect)', () => {
  const afterLogout = transition(S.LOADING_PROFILE, E.LOGOUT).state;
  assert.equal(afterLogout, S.ENTRY_CHOICE);
  for (const ev of [E.SESSION_VALID, E.TOKEN_OK, E.VERIFY_OK, E.PROFILE_COMPLETE]) {
    const r = applyEvent(afterLogout, ev);
    assert.equal(r.changed, false, ev);
    assert.equal(r.state, S.ENTRY_CHOICE);
  }
});
