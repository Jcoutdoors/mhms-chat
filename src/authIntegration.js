// Verified-auth flow orchestration (VIF Phase 4B) — pure glue over the Phase 4A1
// modules. It maps authClient results to authState events, validates the
// server-derived instructor claim fail-closed, and routes by profile completeness
// (Stream data), so the UI layer stays thin and the decisions are unit-testable.
//
// Key invariants enforced here:
//   - Identity/user_id and instructor come ONLY from /token results.
//   - New-vs-Returning routing is decided by ACTUAL profile completeness, never by
//     the entry-path the user picked (path affects copy only). So "New + existing
//     profile" reconnects and "Returning + no profile" routes to setup, with ONE
//     identity flow underneath.
//   - After LOGOUT the state machine is in entryChoice, so late async success
//     events (VERIFY_OK/TOKEN_OK/PROFILE_COMPLETE) applied via transition() are
//     no-ops — the user cannot be silently reconnected.
//
// CommonJS; composes authState/authErrors/profileCompleteness. No I/O, no React.

'use strict';

const { EVENTS, transition } = require('./authState.js');
const { isProfileComplete } = require('./profileCompleteness.js');

// Fail-closed instructor: ONLY a literal boolean true is instructor; anything else
// (false, undefined, null, 'true', 1, missing) resolves to false.
function validateInstructor(value) {
  return value === true;
}

// Map a POST /token result -> a boot/auth event (+ carried data on success).
//   { ok:true, token, userId }            -> SESSION_VALID (+ userId, token, instructor)
//   401 / session_required|session_invalid -> SESSION_NONE (unauthenticated)
//   network / 5xx / anything else          -> SERVICE_ERROR (NOT unauthenticated)
function tokenResultToEvent(result) {
  const r = result || {};
  if (r.ok === true) {
    return { event: EVENTS.SESSION_VALID, userId: r.userId, token: r.token, instructor: validateInstructor(r.instructor) };
  }
  if (r.status === 401 || r.error === 'session_required' || r.error === 'session_invalid') {
    return { event: EVENTS.SESSION_NONE };
  }
  return { event: EVENTS.SERVICE_ERROR };
}

// Route after Stream connect by ACTUAL completeness of the server profile.
function profileToEvent(streamUser) {
  return isProfileComplete(streamUser) ? EVENTS.PROFILE_COMPLETE : EVENTS.PROFILE_INCOMPLETE;
}

// Map a POST /verify/request result -> event.
function requestCodeResultToEvent(result) {
  const r = result || {};
  if (r.ok === true) return { event: EVENTS.CODE_REQUEST_OK };
  if (r.error === 'invalid_request') return { event: EVENTS.CODE_REQUEST_INVALID };
  if (r.error === 'rate_limited') return { event: EVENTS.CODE_REQUEST_RATELIMITED, retryAfterMs: r.retryAfterMs || 0 };
  return { event: EVENTS.SERVICE_ERROR };
}

// Map a POST /verify/submit result -> event. The server intentionally collapses
// wrong/used/locked/expired into generic failures; rate_limited is distinct.
function submitCodeResultToEvent(result) {
  const r = result || {};
  if (r.ok === true) return { event: EVENTS.VERIFY_OK };
  if (r.error === 'rate_limited') return { event: EVENTS.VERIFY_RATELIMITED, retryAfterMs: r.retryAfterMs || 0 };
  if (r.error === 'service_unavailable' || r.error === 'network_error') return { event: EVENTS.SERVICE_ERROR };
  return { event: EVENTS.VERIFY_FAIL }; // verification_failed / verification_expired / invalid_request
}

// Apply an event to the current state (thin wrapper over transition) — used so the
// effect layer routes every async result through the machine, making post-logout
// stale results automatic no-ops.
function applyEvent(currentState, event) {
  return transition(currentState, event);
}

module.exports = {
  validateInstructor,
  tokenResultToEvent,
  profileToEvent,
  requestCodeResultToEvent,
  submitCodeResultToEvent,
  applyEvent,
};
