// Verification-logic tests (VIF Phase 2 + Phase 3 exclusive issuance transaction).
// Deterministic; clock injected. No network / Stream / Cloudflare / email / real secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, canSend, submitCode, pruneSends, prunePending,
  reserveCode, confirmCode, cancelCode,
  CODE_TTL_MS, RESEND_COOLDOWN_MS, HOUR_MS, MAX_SENDS_PER_HOUR, MAX_ATTEMPTS, PENDING_TTL_MS,
} from '../src/verificationLogic.js';

// Simulate the Pages Function's code -> HMAC step with a TEST-ONLY secret.
async function codeHmac(code, secret = 'phase-test-secret') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const T0 = 1_000_000_000_000;
// Full issuance = reserve (accepted) + confirm (active). Returns the confirm result.
function issue(s, now, h, id) {
  const r = reserveCode(s, now, h, id);
  if (!r.result.ok || !r.result.accepted) return r.result;
  return confirmCode(s, now, id).result;
}

// ---------- active code: expiry / attempts / success ----------
test('active code: valid before 10 min, invalid at/after; expired cleared lazily', async () => {
  const h = await codeHmac('123456');
  const before = defaultState();
  issue(before, T0, h, 'i1');
  assert.equal(submitCode(before, T0 + CODE_TTL_MS - 1, h).result.ok, true);

  const after = defaultState();
  issue(after, T0, h, 'i2');
  const r = submitCode(after, T0 + CODE_TTL_MS, h);
  assert.equal(r.result.reason, 'expired');
  assert.equal(after.codeHmac, null);
});

test('active code: 5 wrong attempts lock; later correct fails', async () => {
  const s = defaultState();
  const good = await codeHmac('654321');
  const bad = await codeHmac('000000');
  issue(s, T0, good, 'i1');
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const r = submitCode(s, T0 + i, bad);
    assert.equal(r.result.reason, 'invalid');
    assert.equal(r.result.attemptsRemaining, MAX_ATTEMPTS - i);
  }
  assert.equal(submitCode(s, T0 + 100, good).result.ok, false);
});

test('active code: correct code succeeds, consumed, no reuse', async () => {
  const s = defaultState();
  const h = await codeHmac('424242');
  issue(s, T0, h, 'i1');
  assert.equal(submitCode(s, T0 + 1000, h).result.ok, true);
  assert.equal(submitCode(s, T0 + 2000, h).result.reason, 'no_active_code');
});

// ---------- resend cooldown / rolling-hour (committed only on confirm) ----------
test('cooldown: a confirmed send blocks a new reservation for 60s, then allows it', async () => {
  const s = defaultState();
  const h = await codeHmac('111111');
  issue(s, T0, h, 'i1'); // commits a send
  assert.equal(reserveCode(s, T0 + RESEND_COOLDOWN_MS - 1, h, 'i2').result.reason, 'cooldown');
  const ok = reserveCode(s, T0 + RESEND_COOLDOWN_MS, h, 'i3');
  assert.equal(ok.result.ok, true);
  assert.equal(ok.result.accepted, true);
});

test('rolling-hour: 3 confirmed sends allowed, 4th blocked, allowed after oldest ages out', async () => {
  const s = defaultState();
  const h = await codeHmac('222222');
  assert.equal(issue(s, T0, h, 'a').ok, true);
  assert.equal(issue(s, T0 + RESEND_COOLDOWN_MS, h, 'b').ok, true);
  assert.equal(issue(s, T0 + 2 * RESEND_COOLDOWN_MS, h, 'c').ok, true);
  assert.equal(reserveCode(s, T0 + 3 * RESEND_COOLDOWN_MS, h, 'd').result.reason, 'hourly_limit');
  assert.equal(reserveCode(s, T0 + HOUR_MS + 1, h, 'e').result.ok, true);
});

// ---------- exclusive pending lock ----------
test('pending lock: a different issuance id is rejected while a pending exists (not superseded)', async () => {
  const s = defaultState();
  const hA = await codeHmac('AAA111');
  const hB = await codeHmac('BBB222');
  const a = reserveCode(s, T0, hA, 'iss-A');
  assert.equal(a.result.accepted, true);
  const b = reserveCode(s, T0 + 1, hB, 'iss-B');
  assert.equal(b.result.ok, false);
  assert.equal(b.result.reason, 'pending');
  assert.equal(s.pending.issuanceId, 'iss-A'); // NOT superseded
  // The first issuance can still be confirmed and used.
  assert.equal(confirmCode(s, T0 + 2, 'iss-A').result.ok, true);
  assert.equal(submitCode(s, T0 + 3, hA).result.ok, true);
});

test('pending lock: same issuance id is idempotent and does not authorize another email', async () => {
  const s = defaultState();
  const h = await codeHmac('333333');
  const first = reserveCode(s, T0, h, 'iss-X');
  assert.equal(first.result.accepted, true);
  const again = reserveCode(s, T0 + 1, h, 'iss-X');
  assert.equal(again.result.ok, true);
  assert.equal(again.result.accepted, false); // no new delivery authorized
});

test('pending lock: expired pending is lazily removed and a new reservation is permitted', async () => {
  const s = defaultState();
  const h = await codeHmac('444444');
  reserveCode(s, T0, h, 'iss-old');
  const late = reserveCode(s, T0 + PENDING_TTL_MS + 1, h, 'iss-new');
  assert.equal(late.result.ok, true);
  assert.equal(late.result.accepted, true);
  assert.equal(s.pending.issuanceId, 'iss-new');
});

test('pending lock: explicit cancel permits an immediate new reservation', async () => {
  const s = defaultState();
  const h = await codeHmac('555555');
  reserveCode(s, T0, h, 'iss-A');
  cancelCode(s, T0 + 1, 'iss-A');
  const b = reserveCode(s, T0 + 2, h, 'iss-B');
  assert.equal(b.result.accepted, true);
});

// ---------- issuance transaction: success / failure / accounting ----------
test('tx success: reserve -> confirm activates; cooldown+hourly committed exactly once', async () => {
  const s = defaultState();
  const h = await codeHmac('112233');
  assert.equal(reserveCode(s, T0, h, 'iss-A').result.accepted, true);
  assert.equal(submitCode(s, T0 + 1, h).result.reason, 'no_active_code'); // pending not submittable
  assert.equal(confirmCode(s, T0 + 2, 'iss-A').result.ok, true);
  assert.equal(s.sends.length, 1);
  assert.equal(s.lastSendAt, T0 + 2);
  assert.equal(submitCode(s, T0 + 3, h).result.ok, true);
  confirmCode(s, T0 + 4, 'iss-A'); // duplicate confirm
  assert.equal(s.sends.length, 1); // not incremented again
});

test('tx failure: cancel leaves no active code, no cooldown, immediate retry allowed', async () => {
  const s = defaultState();
  const h = await codeHmac('445566');
  reserveCode(s, T0, h, 'iss-A');
  assert.equal(cancelCode(s, T0 + 1, 'iss-A').result.ok, true);
  assert.equal(s.pending, null);
  assert.equal(s.sends.length, 0);
  assert.equal(s.lastSendAt, null);
  assert.equal(submitCode(s, T0 + 2, h).result.reason, 'no_active_code');
  assert.equal(reserveCode(s, T0 + 3, await codeHmac('778899'), 'iss-B').result.accepted, true);
});

test('tx idempotency: dup cancel safe; cancel-after-confirm keeps active; confirm-after-cancel cannot reactivate', async () => {
  const s = defaultState();
  const h = await codeHmac('111000');
  reserveCode(s, T0, h, 'iss-A');
  confirmCode(s, T0 + 1, 'iss-A');
  cancelCode(s, T0 + 2, 'iss-A'); // after confirm: must NOT remove the active code
  assert.equal(s.codeHmac, h);
  assert.equal(submitCode(s, T0 + 3, h).result.ok, true);

  const s2 = defaultState();
  const h2 = await codeHmac('222000');
  reserveCode(s2, T0, h2, 'iss-X');
  cancelCode(s2, T0 + 1, 'iss-X');
  cancelCode(s2, T0 + 2, 'iss-X'); // duplicate cancel safe
  assert.equal(confirmCode(s2, T0 + 3, 'iss-X').result.ok, false); // cannot reactivate
  assert.equal(submitCode(s2, T0 + 4, h2).result.reason, 'no_active_code');
});

test('tx concurrency: older cancel cannot clear the accepted pending; only accepted confirms; one send', async () => {
  // A reserves (accepted). B is rejected by the lock (pending). A's competing/stale
  // cancel of a non-pending id is a no-op; A confirms; exactly one send committed.
  const s = defaultState();
  const hA = await codeHmac('AAA111');
  assert.equal(reserveCode(s, T0, hA, 'iss-A').result.accepted, true);
  assert.equal(reserveCode(s, T0, await codeHmac('BBB222'), 'iss-B').result.reason, 'pending');
  cancelCode(s, T0 + 1, 'iss-B'); // stale/rejected id -> no-op, must not clear pending A
  assert.equal(s.pending.issuanceId, 'iss-A');
  assert.equal(confirmCode(s, T0 + 2, 'iss-A').result.ok, true);
  assert.equal(confirmCode(s, T0 + 3, 'iss-B').result.ok, false); // stale confirm cannot replace
  assert.equal(s.sends.length, 1);
  assert.equal(submitCode(s, T0 + 4, hA).result.ok, true);
});

test('tx pending expiry: abandoned pending cannot later confirm', async () => {
  const s = defaultState();
  const h = await codeHmac('909090');
  reserveCode(s, T0, h, 'iss-A');
  assert.equal(confirmCode(s, T0 + PENDING_TTL_MS + 1, 'iss-A').result.ok, false);
  assert.equal(s.pending, null);
});

// ---------- helpers ----------
test('pruneSends drops timestamps older than one hour', () => {
  const s = defaultState();
  s.sends = [T0 - HOUR_MS - 1, T0 - 10, T0];
  pruneSends(s, T0);
  assert.deepEqual(s.sends, [T0 - 10, T0]);
});

test('prunePending clears an expired pending', () => {
  const s = defaultState();
  s.pending = { issuanceId: 'x', codeHmac: 'y', reservedAt: T0 - PENDING_TTL_MS - 1 };
  prunePending(s, T0);
  assert.equal(s.pending, null);
});

test('canSend reports cooldown/hourly against committed sends', () => {
  const s = defaultState();
  assert.equal(canSend(s, T0).ok, true);
  s.lastSendAt = T0; s.sends = [T0];
  assert.equal(canSend(s, T0 + 1).reason, 'cooldown');
});
