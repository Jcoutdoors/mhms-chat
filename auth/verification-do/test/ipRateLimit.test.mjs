// IpRateLimitDO tests (VIF Phase 3) — TRUE trailing rolling-window logic +
// route policies + class via an in-memory storage mock. Deterministic; clock
// injected into the pure logic. No network / secrets / PII.

import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICIES, isKnownPolicy, defaultState, hit } from '../src/ipRateLimitLogic.js';
import { IpRateLimitDO } from '../src/ipRateLimitDO.js';

const T0 = 1_000_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;

// Apply `n` hits at fixed times; returns { state, results }.
function burst(state, policy, times) {
  const results = [];
  for (const now of times) {
    const r = hit(state, now, policy);
    state = r.state;
    results.push(r);
  }
  return { state, results };
}

test('policies: server-defined thresholds are exactly as approved', () => {
  assert.deepEqual(POLICIES.verify_request, [{ maxHits: 5, windowMs: 60_000 }, { maxHits: 20, windowMs: 3_600_000 }]);
  assert.deepEqual(POLICIES.verify_submit, [{ maxHits: 20, windowMs: 300_000 }, { maxHits: 100, windowMs: 3_600_000 }]);
  assert.equal(isKnownPolicy('verify_request'), true);
  assert.equal(isKnownPolicy('verify_submit'), true);
  assert.equal(isKnownPolicy('nope'), false);
});

test('verify_request: exactly 5 allowed in trailing 60s; 6th rejected', () => {
  let s = defaultState();
  const times = [0, 1, 2, 3, 4].map((i) => T0 + i * 1000); // 5 within 5s
  let r = burst(s, 'verify_request', times);
  assert.equal(r.results.every((x) => x.allowed), true);
  s = r.state;
  const sixth = hit(s, T0 + 5000, 'verify_request');
  assert.equal(sixth.allowed, false);
  assert.ok(sixth.retryAfterMs > 0);
});

test('NO fixed-window reset: 5 just before a minute boundary + 1 just after are counted together', () => {
  let s = defaultState();
  // 5 hits at t = 55.0s .. 55.4s
  ({ state: s } = burst(s, 'verify_request', [55000, 55100, 55200, 55300, 55400].map((x) => T0 + x)));
  // one at t = 61s: a fixed 60s bucket would have reset; a trailing window has not
  const across = hit(s, T0 + 61000, 'verify_request');
  assert.equal(across.allowed, false, 'trailing window still counts the recent 5');
});

test('oldest timestamp expires precisely; short-window recovery', () => {
  let s = defaultState();
  ({ state: s } = burst(s, 'verify_request', [0, 1, 2, 3, 4].map((i) => T0 + i)));
  // still blocked at just under 60s after the oldest (T0)
  assert.equal(hit(s, T0 + MIN - 1, 'verify_request').allowed, false);
  // at exactly 60s after the oldest, the oldest (T0) leaves the trailing window -> allowed
  const rec = hit(s, T0 + MIN, 'verify_request');
  assert.equal(rec.allowed, true);
});

test('retryAfterMs reflects the oldest blocking timestamp', () => {
  let s = defaultState();
  ({ state: s } = burst(s, 'verify_request', [0, 1, 2, 3, 4].map((i) => T0 + i)));
  const blocked = hit(s, T0 + 10_000, 'verify_request'); // 10s in
  // oldest is T0; it expires at T0+60s; retryAfter ≈ 50s
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, T0 + MIN - (T0 + 10_000));
});

test('verify_request hourly cap: 20 within the hour allowed, 21st blocked; recovers after the window', () => {
  let s = defaultState();
  // 20s apart: never trips the 5/60s sub-limit (<=3 per 60s), and all 20 stay
  // clustered inside the trailing hour.
  const STEP = 20_000;
  const times = Array.from({ length: 20 }, (_, i) => T0 + i * STEP);
  const r = burst(s, 'verify_request', times);
  assert.equal(r.results.every((x) => x.allowed), true, 'first 20 allowed');
  s = r.state;
  const twentyFirst = hit(s, T0 + 20 * STEP, 'verify_request'); // 400s in; all 20 within the hour
  assert.equal(twentyFirst.allowed, false); // blocked by the 20/60m window
  assert.ok(twentyFirst.retryAfterMs > 0);
  // full recovery once the whole cluster ages out of the 60m window
  assert.equal(hit(s, T0 + 2 * HOUR, 'verify_request').allowed, true);
});

test('verify_submit uses its own policy (20 / trailing 5m)', () => {
  let s = defaultState();
  const times = Array.from({ length: 20 }, (_, i) => T0 + i * 1000); // 20 within 20s
  let r = burst(s, 'verify_submit', times);
  assert.equal(r.results.every((x) => x.allowed), true);
  s = r.state;
  assert.equal(hit(s, T0 + 20_000, 'verify_submit').allowed, false); // 21st within 5m
  assert.equal(hit(s, T0 + 5 * MIN, 'verify_submit').allowed, true); // oldest ages out of 5m
});

test('counter isolation: request and submit policies do not consume each other', () => {
  let s = defaultState();
  // exhaust verify_request 60s window (5)
  ({ state: s } = burst(s, 'verify_request', [0, 1, 2, 3, 4].map((i) => T0 + i)));
  assert.equal(hit(s, T0 + 5, 'verify_request').allowed, false);
  // verify_submit is still fully available at the same instant
  assert.equal(hit(s, T0 + 5, 'verify_submit').allowed, true);
});

test('pruning removes obsolete timestamps beyond the longest window', () => {
  let s = defaultState();
  ({ state: s } = burst(s, 'verify_request', [T0]));
  // a hit an hour+ later prunes T0 (older than the 60m longest window)
  const r = hit(s, T0 + HOUR + 10, 'verify_request');
  assert.equal(r.allowed, true);
  assert.deepEqual(r.state.verify_request, [T0 + HOUR + 10]); // only the new one remains
});

test('unknown policy is rejected by the pure logic', () => {
  const r = hit(defaultState(), T0, 'evil_policy');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'bad_policy');
});

// ---------- class (storage mock) ----------
function makeState() {
  const m = new Map();
  return { storage: { async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; }, async put(k, v) { m.set(k, structuredClone(v)); } }, _map: m };
}
function hitReq(policy) {
  return new Request('https://ip.internal/', { method: 'POST', body: JSON.stringify({ op: 'hit', policy }) });
}

test('class: state persists across separate calls; no-store; only timestamp arrays stored (no IP/PII)', async () => {
  const st = makeState();
  const doi = new IpRateLimitDO(st, {});
  const res = await doi.fetch(hitReq('verify_request'));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  await doi.fetch(hitReq('verify_request'));
  const stored = st._map.get('w');
  assert.deepEqual(Object.keys(stored), ['verify_request']);
  assert.equal(Array.isArray(stored.verify_request), true);
  assert.equal(stored.verify_request.length, 2); // persisted across two calls
  const blob = JSON.stringify(stored);
  assert.equal(blob.includes('@'), false);
  assert.equal(/\d+\.\d+\.\d+\.\d+/.test(blob), false, 'no raw IP');
});

test('class: bad op / missing policy / unknown policy -> 400', async () => {
  const doi = new IpRateLimitDO(makeState(), {});
  assert.equal((await doi.fetch(new Request('https://ip.internal/', { method: 'POST', body: 'x' }))).status, 400);
  assert.equal((await doi.fetch(new Request('https://ip.internal/', { method: 'POST', body: JSON.stringify({ op: 'nope', policy: 'verify_request' }) }))).status, 400);
  assert.equal((await doi.fetch(new Request('https://ip.internal/', { method: 'POST', body: JSON.stringify({ op: 'hit' }) }))).status, 400);
  assert.equal((await doi.fetch(hitReq('evil'))).status, 400);
});

test('class concurrency (simulated input gate): exactly the permitted number allowed, excess rejected', async () => {
  const st = makeState();
  const doi = new IpRateLimitDO(st, {});
  let chain = Promise.resolve();
  const serialized = () => (chain = chain.then(() => doi.fetch(hitReq('verify_request')).then((r) => r.json())));
  const results = await Promise.all(Array.from({ length: 8 }, serialized)); // limit is 5/60s
  assert.equal(results.filter((r) => r.allowed).length, 5);
  assert.equal(results.filter((r) => !r.allowed).length, 3);
});
