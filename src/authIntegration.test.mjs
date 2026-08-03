// authIntegration tests (Phase 4B) — pure flow orchestration. Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInstructor, tokenResultToEvent, profileToEvent,
  requestCodeResultToEvent, submitCodeResultToEvent, applyEvent,
} from './authIntegration.js';
import { EVENTS as E, STATES as S, INITIAL_STATE, transition } from './authState.js';

test('validateInstructor: ONLY literal true -> true (fail closed)', () => {
  assert.equal(validateInstructor(true), true);
  for (const v of [false, undefined, null, 'true', 1, 0, {}, [], 'yes']) assert.equal(validateInstructor(v), false, String(v));
});

test('tokenResultToEvent: ok -> SESSION_VALID with validated instructor', () => {
  assert.deepEqual(tokenResultToEvent({ ok: true, token: 't', userId: 'cats-x', instructor: true }),
    { event: E.SESSION_VALID, userId: 'cats-x', token: 't', instructor: true });
  // non-boolean instructor from a token result is coerced fail-closed
  assert.equal(tokenResultToEvent({ ok: true, token: 't', userId: 'cats-x', instructor: 'true' }).instructor, false);
});

test('tokenResultToEvent: 401/session errors -> SESSION_NONE; network/5xx -> SERVICE_ERROR (not unauthenticated)', () => {
  assert.equal(tokenResultToEvent({ ok: false, status: 401, error: 'session_required' }).event, E.SESSION_NONE);
  assert.equal(tokenResultToEvent({ ok: false, error: 'session_invalid' }).event, E.SESSION_NONE);
  assert.equal(tokenResultToEvent({ ok: false, error: 'network_error' }).event, E.SERVICE_ERROR);
  assert.equal(tokenResultToEvent({ ok: false, error: 'service_unavailable', status: 503 }).event, E.SERVICE_ERROR);
});

test('profileToEvent: routes by ACTUAL completeness (version, legacy name, malformed)', () => {
  assert.equal(profileToEvent({ id: 'cats-x', profile_version: 1 }), E.PROFILE_COMPLETE);
  assert.equal(profileToEvent({ id: 'cats-x', name: 'Alex Rivera' }), E.PROFILE_COMPLETE); // legacy
  assert.equal(profileToEvent({ id: 'cats-x', name: '   ' }), E.PROFILE_INCOMPLETE);
  assert.equal(profileToEvent({ id: 'cats-x' }), E.PROFILE_INCOMPLETE);
  assert.equal(profileToEvent(null), E.PROFILE_INCOMPLETE); // malformed -> setup
});

test('requestCode/submitCode result mapping', () => {
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

// -------- integration: boot / routing / wrong-path / logout --------

// Drive the machine from booting through a full boot, given a /token result and a
// Stream user, using ONLY the pure mappers + transition.
function bootThrough(tokenResult, streamUser) {
  let st = INITIAL_STATE;
  st = transition(st, E.BOOT).state;                       // booting -> checkingSession
  const tk = tokenResultToEvent(tokenResult);
  st = transition(st, tk.event).state;                     // -> loadingProfile | entryChoice | serviceError
  if (tk.event === E.SESSION_VALID) st = transition(st, profileToEvent(streamUser)).state; // -> community | profileSetup
  return st;
}

test('boot: valid session + complete profile -> community (auto-restore, no email)', () => {
  assert.equal(bootThrough({ ok: true, userId: 'cats-x', token: 't', instructor: false }, { id: 'cats-x', name: 'A' }), S.COMMUNITY);
});
test('boot: valid session + incomplete profile -> profileSetup', () => {
  assert.equal(bootThrough({ ok: true, userId: 'cats-x', token: 't', instructor: false }, { id: 'cats-x' }), S.PROFILE_SETUP);
});
test('boot: no session (401) -> entryChoice', () => {
  assert.equal(bootThrough({ ok: false, status: 401, error: 'session_required' }, null), S.ENTRY_CHOICE);
});
test('boot: network failure -> serviceError (NOT entryChoice)', () => {
  assert.equal(bootThrough({ ok: false, error: 'network_error' }, null), S.SERVICE_ERROR);
});

test('wrong-path: routing depends on completeness, not the chosen path', () => {
  // "New here" but an existing complete profile -> community (reconnect), NOT setup.
  assert.equal(profileToEvent({ id: 'cats-x', name: 'Existing User' }), E.PROFILE_COMPLETE);
  // "Returning" but no profile -> setup.
  assert.equal(profileToEvent({ id: 'cats-y' }), E.PROFILE_INCOMPLETE);
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
