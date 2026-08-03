// cooldown tests (Phase 4B2). Pure, deterministic (injected clock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COOLDOWN_MS, deadlineFromRetryAfter, remainingSeconds, canResend } from './cooldown.js';

test('remainingSeconds: ceil of future ms; 0 for past/invalid', () => {
  assert.equal(remainingSeconds(10_000, 4_500), 6);   // 5.5s -> ceil 6
  assert.equal(remainingSeconds(10_000, 10_000), 0);
  assert.equal(remainingSeconds(10_000, 12_000), 0);  // past
  assert.equal(remainingSeconds(null), 0);
  assert.equal(remainingSeconds(undefined), 0);
  assert.equal(remainingSeconds(NaN), 0);
});

test('deadlineFromRetryAfter: uses Retry-After ms, else the default cooldown', () => {
  assert.equal(deadlineFromRetryAfter(5000, 1000), 6000);
  assert.equal(deadlineFromRetryAfter(undefined, 1000), 1000 + DEFAULT_COOLDOWN_MS);
  assert.equal(deadlineFromRetryAfter(0, 1000), 1000 + DEFAULT_COOLDOWN_MS);
  assert.equal(deadlineFromRetryAfter(-5, 1000), 1000 + DEFAULT_COOLDOWN_MS);
});

test('canResend: true only when no time remains (deadline-based, no drift)', () => {
  const d = deadlineFromRetryAfter(3000, 0); // deadline 3000
  assert.equal(canResend(d, 0), false);
  assert.equal(canResend(d, 2999), false);
  assert.equal(canResend(d, 3000), true);
  assert.equal(canResend(null), true);
});
