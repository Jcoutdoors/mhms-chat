// Pure verification-logic tests (VIF Phase 2). Deterministic; clock injected.
// No network, no Stream, no Cloudflare, no email, no real secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, canSend, requestCode, submitCode, pruneSends,
  CODE_TTL_MS, RESEND_COOLDOWN_MS, HOUR_MS, MAX_SENDS_PER_HOUR, MAX_ATTEMPTS,
} from '../src/verificationLogic.js';

// Simulate the Pages Function's code -> HMAC step with a TEST-ONLY secret.
async function codeHmac(code, secret = 'phase2-test-secret') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const T0 = 1_000_000_000_000;

test('issuance: first code accepted', async () => {
  const s = defaultState();
  const h = await codeHmac('123456');
  const { result } = requestCode(s, T0, h);
  assert.equal(result.ok, true);
  assert.equal(s.codeHmac, h);
  assert.equal(s.expiresAt, T0 + CODE_TTL_MS);
  assert.equal(s.attemptsRemaining, MAX_ATTEMPTS);
});

test('issuance: replacing the active code (after cooldown) leaves only ONE active code', async () => {
  const s = defaultState();
  const hA = await codeHmac('111111');
  const hB = await codeHmac('222222');
  requestCode(s, T0, hA);
  requestCode(s, T0 + RESEND_COOLDOWN_MS, hB); // allowed: past cooldown
  assert.equal(s.codeHmac, hB);
  // Old code A no longer validates; only B does.
  assert.equal(submitCode(s, T0 + RESEND_COOLDOWN_MS + 1, hA).result.ok, false);
  const s2 = defaultState();
  requestCode(s2, T0, hA);
  requestCode(s2, T0 + RESEND_COOLDOWN_MS, hB);
  assert.equal(submitCode(s2, T0 + RESEND_COOLDOWN_MS + 1, hB).result.ok, true);
});

test('expiration: valid just before 10 min, invalid at/after; expired state cleared lazily', async () => {
  const h = await codeHmac('123456');
  const before = defaultState();
  requestCode(before, T0, h);
  assert.equal(submitCode(before, T0 + CODE_TTL_MS - 1, h).result.ok, true);

  const after = defaultState();
  requestCode(after, T0, h);
  const r = submitCode(after, T0 + CODE_TTL_MS, h);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.reason, 'expired');
  assert.equal(after.codeHmac, null); // lazily removed
  assert.equal(after.expiresAt, null);
});

test('failed attempts: 5 wrong locks; a later correct code cannot succeed', async () => {
  const s = defaultState();
  const good = await codeHmac('654321');
  const bad = await codeHmac('000000');
  requestCode(s, T0, good);
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const r = submitCode(s, T0 + i, bad);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.reason, 'invalid');
    assert.equal(r.result.attemptsRemaining, MAX_ATTEMPTS - i);
  }
  // Locked: correct code now fails.
  assert.equal(submitCode(s, T0 + 100, good).result.ok, false);
});

test('success: correct code succeeds, is consumed, and cannot be reused', async () => {
  const s = defaultState();
  const h = await codeHmac('424242');
  requestCode(s, T0, h);
  assert.equal(submitCode(s, T0 + 1000, h).result.ok, true);
  assert.equal(s.consumed, true);
  const second = submitCode(s, T0 + 2000, h);
  assert.equal(second.result.ok, false);
  assert.equal(second.result.reason, 'no_active_code');
});

test('resend cooldown: <60s rejected, >=60s allowed', async () => {
  const s = defaultState();
  const h = await codeHmac('123456');
  requestCode(s, T0, h);
  const early = requestCode(s, T0 + RESEND_COOLDOWN_MS - 1, h);
  assert.equal(early.result.ok, false);
  assert.equal(early.result.reason, 'cooldown');
  const ok = requestCode(s, T0 + RESEND_COOLDOWN_MS, h);
  assert.equal(ok.result.ok, true);
});

test('rolling hourly limit: 3 sends allowed, 4th rejected, allowed after oldest ages out', async () => {
  const s = defaultState();
  const h = await codeHmac('123456');
  // 3 sends spaced past the cooldown but within an hour.
  assert.equal(requestCode(s, T0, h).result.ok, true);
  assert.equal(requestCode(s, T0 + RESEND_COOLDOWN_MS, h).result.ok, true);
  assert.equal(requestCode(s, T0 + 2 * RESEND_COOLDOWN_MS, h).result.ok, true);
  // 4th within the hour (past cooldown) -> hourly limit.
  const fourth = requestCode(s, T0 + 3 * RESEND_COOLDOWN_MS, h);
  assert.equal(fourth.result.ok, false);
  assert.equal(fourth.result.reason, 'hourly_limit');
  // After the oldest send ages out of the rolling hour, a send is allowed again.
  const later = requestCode(s, T0 + HOUR_MS + 1, h);
  assert.equal(later.result.ok, true);
});

test('concurrency (serialized model): duplicate correct submissions -> exactly one success', async () => {
  // A Durable Object serializes requests, so concurrent submits apply
  // sequentially. Applying submitCode twice to the same state proves single-use.
  const s = defaultState();
  const h = await codeHmac('314159');
  requestCode(s, T0, h);
  const first = submitCode(s, T0 + 1, h);
  const second = submitCode(s, T0 + 1, h); // "concurrent" -> serialized after first
  assert.equal(first.result.ok, true);
  assert.equal(second.result.ok, false);
});

test('security invariants: state stores only opaque HMAC + timestamps/counters (no code, no email, no secret)', async () => {
  const s = defaultState();
  const h = await codeHmac('secret-code-value');
  requestCode(s, T0, h);
  const keys = Object.keys(s).sort();
  assert.deepEqual(keys, ['activeIssuanceId', 'attemptsRemaining', 'codeHmac', 'consumed', 'expiresAt', 'lastSendAt', 'pending', 'sends']);
  // codeHmac is opaque hex, not the plaintext code.
  assert.match(s.codeHmac, /^[0-9a-f]{64}$/);
  assert.equal(s.codeHmac.includes('secret-code-value'), false);
  // No email/secret-shaped fields exist anywhere in the serialized state (incl. any pending issuance).
  const blob = JSON.stringify(s);
  assert.equal(blob.includes('@'), false);
  assert.equal(blob.toLowerCase().includes('secret'), false);
});

test('pruneSends drops timestamps older than one hour', () => {
  const s = defaultState();
  s.sends = [T0 - HOUR_MS - 1, T0 - 10, T0];
  pruneSends(s, T0);
  assert.deepEqual(s.sends, [T0 - 10, T0]);
});

// ===== Phase 3 issuance transaction (reserve / confirm / cancel) =====
import { reserveCode, confirmCode, cancelCode, PENDING_TTL_MS } from '../src/verificationLogic.js';

test('tx success: reserve -> confirm makes code active; cooldown+hourly committed exactly once', async () => {
  const s = defaultState();
  const h = await codeHmac('112233');
  assert.equal(reserveCode(s, T0, h, 'iss-A').result.ok, true);
  // pending is NOT submittable yet
  assert.equal(submitCode(s, T0 + 1, h).result.reason, 'no_active_code');
  // confirm -> active + one send committed
  assert.equal(confirmCode(s, T0 + 2, 'iss-A').result.ok, true);
  assert.equal(s.sends.length, 1);
  assert.equal(s.lastSendAt, T0 + 2);
  assert.equal(submitCode(s, T0 + 3, h).result.ok, true);
  // duplicate confirm does not commit a second send
  confirmCode(s, T0 + 4, 'iss-A');
  assert.equal(s.sends.length, 1);
});

test('tx failure: reserve -> cancel leaves no active code, no cooldown, retry allowed immediately', async () => {
  const s = defaultState();
  const h = await codeHmac('445566');
  reserveCode(s, T0, h, 'iss-A');
  assert.equal(cancelCode(s, T0 + 1, 'iss-A').result.ok, true);
  assert.equal(s.pending, null);
  assert.equal(s.sends.length, 0);        // nothing committed
  assert.equal(s.lastSendAt, null);
  assert.equal(submitCode(s, T0 + 2, h).result.reason, 'no_active_code');
  // immediate re-reserve allowed (no cooldown retained)
  assert.equal(reserveCode(s, T0 + 3, await codeHmac('778899'), 'iss-B').result.ok, true);
});

test('tx idempotency: dup cancel safe; cancel-after-confirm keeps active; confirm-after-cancel cannot reactivate', async () => {
  const s = defaultState();
  const h = await codeHmac('111000');
  reserveCode(s, T0, h, 'iss-A');
  confirmCode(s, T0 + 1, 'iss-A');
  // cancel after confirm must NOT remove the active confirmed code
  cancelCode(s, T0 + 2, 'iss-A');
  assert.equal(s.codeHmac, h);
  assert.equal(submitCode(s, T0 + 3, h).result.ok, true);
  // confirm-after-cancel on a fresh pending
  const s2 = defaultState();
  const h2 = await codeHmac('222000');
  reserveCode(s2, T0, h2, 'iss-X');
  cancelCode(s2, T0 + 1, 'iss-X');
  cancelCode(s2, T0 + 2, 'iss-X'); // duplicate cancel safe
  assert.equal(confirmCode(s2, T0 + 3, 'iss-X').result.ok, false); // cannot reactivate a canceled issuance
  assert.equal(submitCode(s2, T0 + 4, h2).result.reason, 'no_active_code');
});

test('tx concurrency: two reserves, older confirm/cancel cannot beat newer; exactly one active', async () => {
  // Two concurrent requests (serialized by the DO): A then B reserve before either confirms.
  const s = defaultState();
  const hA = await codeHmac('AAA111');
  const hB = await codeHmac('BBB222');
  reserveCode(s, T0, hA, 'iss-A');
  reserveCode(s, T0, hB, 'iss-B'); // supersedes pending A
  // A's delivery fails -> cancel(A) must NOT touch pending B
  assert.equal(cancelCode(s, T0 + 1, 'iss-A').result.ok, true);
  assert.equal(s.pending && s.pending.issuanceId, 'iss-B');
  // B's delivery succeeds -> confirm B
  assert.equal(confirmCode(s, T0 + 2, 'iss-B').result.ok, true);
  // A can never promote (superseded)
  assert.equal(confirmCode(s, T0 + 3, 'iss-A').result.ok, false);
  // exactly one active code (B), one send committed
  assert.equal(s.sends.length, 1);
  assert.equal(submitCode(s, T0 + 4, hB).result.ok, true);
});

test('tx concurrency: older successful-then-confirm cannot revive after a newer active code', async () => {
  const s = defaultState();
  const hA = await codeHmac('OLD111');
  const hB = await codeHmac('NEW222');
  reserveCode(s, T0, hA, 'iss-A');
  reserveCode(s, T0, hB, 'iss-B');
  confirmCode(s, T0 + 1, 'iss-B');            // B becomes active
  assert.equal(confirmCode(s, T0 + 2, 'iss-A').result.ok, false); // stale A confirm rejected
  assert.equal(submitCode(s, T0 + 3, hA).result.ok, false);       // A never valid
  assert.equal(submitCode(s, T0 + 4, hB).result.ok, true);
});

test('tx pending expiry: abandoned pending is lazily cleaned and cannot later confirm', async () => {
  const s = defaultState();
  const h = await codeHmac('909090');
  reserveCode(s, T0, h, 'iss-A');
  const late = T0 + PENDING_TTL_MS + 1;
  assert.equal(confirmCode(s, late, 'iss-A').result.ok, false); // expired pending
  assert.equal(s.pending, null); // lazily cleaned
});

test('tx: submit while pending (no active) is rejected', async () => {
  const s = defaultState();
  const h = await codeHmac('303030');
  reserveCode(s, T0, h, 'iss-A');
  assert.equal(submitCode(s, T0 + 1, h).result.reason, 'no_active_code');
});
