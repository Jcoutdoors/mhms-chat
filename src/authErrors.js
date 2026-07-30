// Auth error mapping (VIF Phase 4A1).
//
// Maps the auth service's SAFE, generic error categories to user-facing states
// and copy for the onboarding UI. It never reveals limiter internals, Durable
// Object identifiers, exact thresholds, stack traces, provider errors, or secret
// names — it only translates the small set of category strings the server
// returns (see auth/pages/functions/*). The server intentionally collapses
// wrong / used / locked codes into `verification_failed`, so this module treats
// them as one generic "code didn't work" state and never claims which.
//
// Also provides resend-countdown helpers driven by a parsed Retry-After.
//
// Pure CommonJS: no I/O, no globals, no React.

'use strict';

// Buckets an error into a UI "kind". `canResend` means the user may request a
// new code; `isCooldown` means a Retry-After countdown should gate retry.
const CATEGORY = {
  invalid_request:     { kind: 'invalid',   canResend: true,  isCooldown: false },
  rate_limited:        { kind: 'cooldown',  canResend: false, isCooldown: true  },
  verification_failed: { kind: 'code_bad',  canResend: true,  isCooldown: false },
  verification_expired:{ kind: 'code_expired', canResend: true, isCooldown: false },
  service_unavailable: { kind: 'service',   canResend: true,  isCooldown: false },
  session_required:    { kind: 'session',   canResend: false, isCooldown: false },
  session_invalid:     { kind: 'session',   canResend: false, isCooldown: false },
  network_error:       { kind: 'network',   canResend: true,  isCooldown: false },
};

// Safe, generic user-facing copy per kind. No internals, no counts, no naming of
// which specific failure occurred for security-sensitive categories.
const COPY = {
  invalid:      'That doesn’t look right. Please check what you entered and try again.',
  cooldown:     'Too many attempts. Please wait a moment and try again.',
  code_bad:     'That code didn’t work. Double-check it and try again, or request a new code.',
  code_expired: 'That code has expired. Request a new code to continue.',
  service:      'We’re having trouble reaching the service. Please try again in a moment.',
  session:      'Please sign in again to continue.',
  network:      'We couldn’t connect. Check your connection and try again.',
  unknown:      'Something went wrong. Please try again.',
};

// Rounds a wait in ms to a friendly label (no exact-threshold leakage).
function roundedWaitLabel(retryAfterMs) {
  const secs = Math.max(0, Math.ceil((Number(retryAfterMs) || 0) / 1000));
  if (secs <= 0) return 'a moment';
  if (secs < 90) return `${secs} second${secs === 1 ? '' : 's'}`;
  const mins = Math.round(secs / 60);
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

// Whole seconds remaining, for a live resend countdown (never negative).
function cooldownSeconds(retryAfterMs) {
  return Math.max(0, Math.ceil((Number(retryAfterMs) || 0) / 1000));
}

// Translate a server result into a UI descriptor. `result` is the typed object
// returned by authClient: { ok:false, error, retryAfterMs? }.
function describeError(result) {
  const category = result && typeof result.error === 'string' ? result.error : '';
  const spec = CATEGORY[category] || { kind: 'unknown', canResend: true, isCooldown: false };
  const retryAfterMs = result && typeof result.retryAfterMs === 'number' ? result.retryAfterMs : 0;
  let message = COPY[spec.kind] || COPY.unknown;
  if (spec.isCooldown && retryAfterMs > 0) {
    message = `Too many attempts. Please wait ${roundedWaitLabel(retryAfterMs)} and try again.`;
  }
  return {
    kind: spec.kind,
    message,
    canResend: spec.canResend,
    isCooldown: spec.isCooldown,
    retryAfterMs,
    cooldownSeconds: cooldownSeconds(retryAfterMs),
  };
}

module.exports = { describeError, roundedWaitLabel, cooldownSeconds, CATEGORY, COPY };
