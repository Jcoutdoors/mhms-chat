// authErrors tests (Phase 4A1). Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError, roundedWaitLabel, cooldownSeconds, COPY } from './authErrors.js';

test('known categories map to safe kinds and copy', () => {
  assert.equal(describeError({ error: 'verification_failed' }).kind, 'code_bad');
  assert.equal(describeError({ error: 'verification_expired' }).kind, 'code_expired');
  assert.equal(describeError({ error: 'invalid_request' }).kind, 'invalid');
  assert.equal(describeError({ error: 'service_unavailable' }).kind, 'service');
  assert.equal(describeError({ error: 'session_required' }).kind, 'session');
  assert.equal(describeError({ error: 'session_invalid' }).kind, 'session');
  assert.equal(describeError({ error: 'network_error' }).kind, 'network');
});

test('unknown / missing category => generic unknown, never throws', () => {
  assert.equal(describeError({ error: 'weird_internal_thing' }).kind, 'unknown');
  assert.equal(describeError({}).kind, 'unknown');
  assert.equal(describeError(null).kind, 'unknown');
  assert.equal(describeError({}).message, COPY.unknown);
});

test('rate_limited surfaces a friendly wait using Retry-After, not internals', () => {
  const d = describeError({ error: 'rate_limited', retryAfterMs: 45000 });
  assert.equal(d.kind, 'cooldown');
  assert.equal(d.isCooldown, true);
  assert.equal(d.canResend, false);
  assert.equal(d.cooldownSeconds, 45);
  assert.ok(d.message.includes('45 seconds'));
  // No leakage of thresholds, limiter names, DO ids, etc.
  assert.equal(/durable|IpRateLimit|policy|HMAC|secret/i.test(d.message), false);
});

test('copy never reveals which specific code failure occurred', () => {
  const d = describeError({ error: 'verification_failed' });
  assert.equal(/locked|used|attempts remaining|too many wrong/i.test(d.message), false);
  assert.ok(d.canResend);
});

test('roundedWaitLabel rounds sensibly', () => {
  assert.equal(roundedWaitLabel(0), 'a moment');
  assert.equal(roundedWaitLabel(1000), '1 second');
  assert.equal(roundedWaitLabel(45000), '45 seconds');
  assert.equal(roundedWaitLabel(120000), '2 minutes');
  assert.equal(roundedWaitLabel(90000), '2 minutes'); // >=90s rounds to minutes
});

test('cooldownSeconds is never negative and ceils', () => {
  assert.equal(cooldownSeconds(1500), 2);
  assert.equal(cooldownSeconds(-5), 0);
  assert.equal(cooldownSeconds('x'), 0);
});
