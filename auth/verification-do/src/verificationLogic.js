// VerificationDO core logic (VIF Phase 2 + Phase 3 issuance transaction) — pure,
// I/O-free, deterministic. The Durable Object applies these to its serialized
// per-identity storage; serialization is what makes the transitions race-safe.
//
// INVARIANTS:
//   - Never handles a plaintext code — only the code's HMAC (hex), computed
//     upstream by the Pages Function.
//   - Never handles the raw email; the object is addressed by an opaque key.
//   - Server time is authoritative (`now` supplied by the DO).
//
// Phase 3 issuance transaction (reserve -> confirm/cancel): a code is made
// SUBMITTABLE only after email delivery is accepted (confirm). A failed delivery
// cancels the pending issuance and consumes NO send/cooldown allowance. Send
// accounting (cooldown + rolling-hour) is committed exactly once, at confirm.

'use strict';

const CODE_TTL_MS = 10 * 60 * 1000; // 10-minute active code lifetime
const RESEND_COOLDOWN_MS = 60 * 1000; // 60-second resend cooldown
const HOUR_MS = 60 * 60 * 1000; // rolling window
const MAX_SENDS_PER_HOUR = 3;
const MAX_ATTEMPTS = 5;
const PENDING_TTL_MS = 2 * 60 * 1000; // abandoned pending issuance expires (lazy)

function defaultState() {
  return {
    // Active (submittable) issuance:
    codeHmac: null,
    expiresAt: null,
    attemptsRemaining: MAX_ATTEMPTS,
    consumed: false,
    activeIssuanceId: null,
    // Pending (reserved, not yet delivered) issuance:
    pending: null, // { issuanceId, codeHmac, reservedAt } | null
    // Send accounting — committed ONLY on confirm:
    sends: [],
    lastSendAt: null,
  };
}

function pruneSends(state, now) {
  state.sends = (state.sends || []).filter((t) => now - t < HOUR_MS);
  return state;
}
function prunePending(state, now) {
  if (state.pending && now - state.pending.reservedAt > PENDING_TTL_MS) state.pending = null;
  return state;
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Whether another send is allowed right now (against COMMITTED accounting only).
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

// ---- Phase 3 issuance transaction ----

// Reserve a pending issuance. Checks cooldown/hourly against COMMITTED sends but
// commits nothing yet. Does not make the code submittable. Replaces any prior
// pending issuance (older pending's confirm/cancel will no-op on id mismatch).
function reserveCode(state, now, codeHmac, issuanceId) {
  pruneSends(state, now);
  prunePending(state, now);
  const gate = canSend(state, now);
  if (!gate.ok) return { state, result: gate };
  state.pending = { issuanceId, codeHmac, reservedAt: now };
  return { state, result: { ok: true, issuanceId } };
}

// Promote the matching pending issuance to active and commit the send exactly
// once. Idempotent for a re-confirm of the already-active issuance.
function confirmCode(state, now, issuanceId) {
  pruneSends(state, now);
  prunePending(state, now);
  if (state.activeIssuanceId === issuanceId && state.codeHmac && !state.consumed) {
    return { state, result: { ok: true, alreadyActive: true } }; // duplicate confirm: no double-commit
  }
  if (!state.pending || state.pending.issuanceId !== issuanceId) {
    return { state, result: { ok: false, reason: 'no_pending' } }; // superseded / canceled / expired
  }
  state.codeHmac = state.pending.codeHmac;
  state.expiresAt = now + CODE_TTL_MS;
  state.attemptsRemaining = MAX_ATTEMPTS;
  state.consumed = false;
  state.activeIssuanceId = issuanceId;
  state.pending = null;
  state.lastSendAt = now; // commit cooldown
  state.sends.push(now); // commit rolling-hour count
  return { state, result: { ok: true } };
}

// Cancel a pending issuance after delivery failure. Only clears the EXACT
// matching pending issuance; never touches committed/active state or a newer
// issuance. Always idempotent-safe.
function cancelCode(state, now, issuanceId) {
  prunePending(state, now);
  if (state.pending && state.pending.issuanceId === issuanceId) {
    state.pending = null;
  }
  return { state, result: { ok: true } };
}

// Legacy single-shot issuance (Phase 2). Retained for canSend/back-compat tests.
// NOT used by the Phase 3 route (which uses reserve/confirm/cancel).
function requestCode(state, now, codeHmac) {
  const gate = canSend(state, now);
  if (!gate.ok) return { state, result: gate };
  state.codeHmac = codeHmac;
  state.expiresAt = now + CODE_TTL_MS;
  state.attemptsRemaining = MAX_ATTEMPTS;
  state.consumed = false;
  state.activeIssuanceId = null;
  state.lastSendAt = now;
  state.sends.push(now);
  return { state, result: { ok: true } };
}

// Validate a submitted code HMAC against the ACTIVE issuance only (a pending
// issuance is never submittable). Enforces expiry, attempts, single-use.
function submitCode(state, now, codeHmac) {
  if (!state.codeHmac || state.consumed) {
    return { state, result: { ok: false, reason: 'no_active_code' } };
  }
  if (state.expiresAt == null || now >= state.expiresAt) {
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
      state.codeHmac = null;
      state.expiresAt = null;
    }
    return { state, result: { ok: false, reason: 'invalid', attemptsRemaining: state.attemptsRemaining } };
  }
  state.consumed = true;
  state.codeHmac = null;
  state.expiresAt = null;
  state.attemptsRemaining = 0;
  return { state, result: { ok: true } };
}

export {
  CODE_TTL_MS, RESEND_COOLDOWN_MS, HOUR_MS, MAX_SENDS_PER_HOUR, MAX_ATTEMPTS, PENDING_TTL_MS,
  defaultState, pruneSends, prunePending, constantTimeEqual, canSend,
  reserveCode, confirmCode, cancelCode, requestCode, submitCode,
};
