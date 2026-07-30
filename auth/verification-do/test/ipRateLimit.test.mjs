// IpRateLimitDO tests (VIF Phase 3) — pure fixed-window logic + class via an
// in-memory storage mock. Deterministic; no network / secrets / PII.

import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWindow, hit } from '../src/ipRateLimitLogic.js';
import { IpRateLimitDO } from '../src/ipRateLimitDO.js';

const T0 = 1_000_000_000_000;
const PERIOD = 60_000;
const LIMIT = 5;

test('logic: first LIMIT requests allowed, the next denied within the window', () => {
  let s = defaultWindow();
  for (let i = 1; i <= LIMIT; i++) {
    const r = hit(s, T0 + i, LIMIT, PERIOD); s = r.state;
    assert.equal(r.allowed, true, `hit ${i}`);
  }
  const over = hit(s, T0 + LIMIT + 1, LIMIT, PERIOD);
  assert.equal(over.allowed, false);
});

test('logic: window resets after the period (a new window counts as 1)', () => {
  let s = defaultWindow();
  for (let i = 0; i < LIMIT; i++) s = hit(s, T0 + i, LIMIT, PERIOD).state;
  assert.equal(hit(s, T0 + 10, LIMIT, PERIOD).allowed, false); // still in window
  const fresh = hit(s, T0 + PERIOD, LIMIT, PERIOD); // window elapsed
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.state.count, 1);
});

// In-memory DurableObjectStorage mock.
function makeState() {
  const m = new Map();
  return { storage: { async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; }, async put(k, v) { m.set(k, structuredClone(v)); } }, _map: m };
}
function hitReq(limit = LIMIT, periodMs = PERIOD) {
  return new Request('https://ip.internal/', { method: 'POST', body: JSON.stringify({ op: 'hit', limit, periodMs }) });
}

test('class: enforces the limit via storage; bad op / bad params rejected', async () => {
  const st = makeState();
  const doi = new IpRateLimitDO(st, {});
  for (let i = 0; i < LIMIT; i++) assert.equal((await (await doi.fetch(hitReq())).json()).allowed, true);
  assert.equal((await (await doi.fetch(hitReq())).json()).allowed, false);
  assert.equal((await doi.fetch(new Request('https://ip.internal/', { method: 'POST', body: 'x' }))).status, 400);
  assert.equal((await doi.fetch(new Request('https://ip.internal/', { method: 'POST', body: JSON.stringify({ op: 'nope' }) }))).status, 400);
  assert.equal((await doi.fetch(new Request('https://ip.internal/', { method: 'POST', body: JSON.stringify({ op: 'hit', limit: 0, periodMs: PERIOD }) }))).status, 400);
});

test('class: response is no-store; stored state holds ONLY window fields (no IP/PII)', async () => {
  const st = makeState();
  const doi = new IpRateLimitDO(st, {});
  const res = await doi.fetch(hitReq());
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const keys = Object.keys(st._map.get('w')).sort();
  assert.deepEqual(keys, ['count', 'windowStart']);
});

test('class concurrency (simulated input gate): exactly LIMIT of many concurrent hits are allowed', async () => {
  const st = makeState();
  const doi = new IpRateLimitDO(st, {});
  let chain = Promise.resolve();
  const serialized = () => (chain = chain.then(() => doi.fetch(hitReq()).then((r) => r.json())));
  const results = await Promise.all(Array.from({ length: LIMIT + 3 }, serialized));
  assert.equal(results.filter((r) => r.allowed).length, LIMIT);
});
