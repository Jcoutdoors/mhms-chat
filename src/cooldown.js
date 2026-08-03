// Resend-cooldown timing (VIF Phase 4B2) — pure, deadline-based (no drift).
//
// The state owner stores a single absolute deadline (ms epoch) and derives the
// remaining whole seconds from it on each tick. This avoids the accumulated drift
// of a decrementing counter and makes "resend enabled" a pure function of the clock.
//
// Pure CommonJS: no timers, no I/O. The interval/tick + cleanup are owned by the
// App (Phase 4B2); this module only computes values.

'use strict';

const DEFAULT_COOLDOWN_MS = 60 * 1000; // server resend cooldown when no Retry-After

// Compute an absolute deadline from a Retry-After (ms) or the default cooldown.
function deadlineFromRetryAfter(retryAfterMs, now = Date.now(), fallbackMs = DEFAULT_COOLDOWN_MS) {
  const ms = typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : fallbackMs;
  return now + ms;
}

// Whole seconds remaining until `deadline` (never negative). A null/invalid
// deadline (or one in the past) yields 0 -> resend enabled.
function remainingSeconds(deadline, now = Date.now()) {
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) return 0;
  const ms = deadline - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 1000);
}

// True iff resend is allowed right now (no active cooldown).
function canResend(deadline, now = Date.now()) {
  return remainingSeconds(deadline, now) === 0;
}

module.exports = { DEFAULT_COOLDOWN_MS, deadlineFromRetryAfter, remainingSeconds, canResend };
