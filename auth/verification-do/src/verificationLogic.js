// VerificationDO core logic (VIF Phase 2) — pure, I/O-free, deterministic.
//
// Split from the Durable Object class so every rule is unit-testable with an
// injected clock and no runtime. The Durable Object (verificationDO.js) applies
// these functions to its serialized per-identity storage.
//
// IMPORTANT invariants:
//   - Never handles a plaintext verification code. It only ever sees the code's
//     HMAC (a hex string), computed upstream by the Pages Function. See the
//     "HMAC ownership" note in auth/README.md.
//   - Never handles the raw email. The object is addressed by an opaque key
//     (HMAC-SHA256(normalizedEmail, IDENTITY_KEY_SECRET)) chosen by the caller.
//   - Server time is authoritative: `now` is supplied by the DO (Date.now()),
//     never by the client, so clock skew/manipulation cannot bypass limits.

'use strict';

const CODE_TTL_MS = 10 * 60 * 1000; // 10-minute code lifetime
const RESEND_COOLDOWN_MS = 60 * 1000; // 60-second resend cooldown
const HOUR_MS = 60 * 60 * 1000; // rolling window
const MAX_SENDS_PER_HOUR = 3;
const MAX_ATTEMPTS = 5;

function defaultState() {
  return {
    codeHmac: null, // hex string of HMAC(code) or null
    expiresAt: null, // ms
    attemptsRemaining: MAX_ATTEMPTS,
    sends: [], // ms timestamps within the rolling hour
    lastSendAt: null, // ms
    consumed: false,
  };
}

// Drop send timestamps older than one rolling hour (lazy cleanup).
function pruneSends(state, now) {
  state.sends = (state.sends || []).filter((t) => now - t < HOUR_MS);
  return state;
}

// Constant-time comparison of two hex strings (avoids leaking match position).
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Inspect (no mutation of send-limit state beyond pruning) whether another send
// is currently allowed. Returns { ok } or { ok:false, reason, retryAfterMs }.
function canSend(state, now) {
  pruneSends(state, now);
  if (state.lastSendAt != null && now - state.lastSendAt < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown', retryAfterMs: RESEND_COOLDOWN_MS - (now - state.lastSendAt) };
  }
  if (state.sends.length >= MAX_SENDS_PER_HOUR) {
    const oldest = Math.min(...state.sends);
    return { ok: false, reason: 'hourly_limit', retryAfterMs: HOUR_MS - (now - oldest) };
  }
  return { ok: true };
}

// Issue or replace the active verification code (as its HMAC). Enforces cooldown
// and the rolling-hour send limit atomically with recording the send.
function requestCode(state, now, codeHmac) {
  const gate = canSend(state, now);
  if (!gate.ok) return { state, result: gate };
  state.codeHmac = codeHmac;
  state.expiresAt = now + CODE_TTL_MS;
  state.attemptsRemaining = MAX_ATTEMPTS;
  state.consumed = false;
  state.lastSendAt = now;
  state.sends.push(now);
  return { state, result: { ok: true } };
}

// Validate a submitted code HMAC. Enforces expiry, attempt limit, single-use.
function submitCode(state, now, codeHmac) {
  if (!state.codeHmac || state.consumed) {
    return { state, result: { ok: false, reason: 'no_active_code' } };
  }
  if (state.expiresAt == null || now >= state.expiresAt) {
    // Lazy expiry: clear the dead code state.
    state.codeHmac = null;
    state.expiresAt = null;
    return { state, result: { ok: false, reason: 'expired' } };
  }
  if (state.attemptsRemaining <= 0) {
    return { state, result: { ok: false, reason: 'locked' } };
  }
  if (!constantTimeEqual(codeHmac, state.codeHmac)) {
    state.attemptsRemaining -= 1;
    if (state.attemptsRemaining <= 0) {
      // Fifth failure locks the code (cannot succeed afterward).
      state.codeHmac = null;
      state.expiresAt = null;
    }
    return { state, result: { ok: false, reason: 'invalid', attemptsRemaining: state.attemptsRemaining } };
  }
  // Success: consume single-use state.
  state.consumed = true;
  state.codeHmac = null;
  state.expiresAt = null;
  state.attemptsRemaining = 0;
  return { state, result: { ok: true } };
}

export {
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  HOUR_MS,
  MAX_SENDS_PER_HOUR,
  MAX_ATTEMPTS,
  defaultState,
  pruneSends,
  constantTimeEqual,
  canSend,
  requestCode,
  submitCode,
};
