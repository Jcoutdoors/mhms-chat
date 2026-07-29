// VerificationDO class tests (VIF Phase 2) — exercises the storage glue + the
// internal fetch RPC contract with an in-memory DurableObjectStorage mock, and
// simulates the Durable Object input gate (serialization) for concurrency.
// No network / Stream / Cloudflare / email / real secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { VerificationDO } from '../src/verificationDO.js';

// Minimal in-memory mock of DurableObjectState.storage.
function makeState() {
  const m = new Map();
  return {
    storage: {
      async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
      async put(k, v) { m.set(k, structuredClone(v)); },
      async delete(k) { m.delete(k); },
    },
    _map: m,
  };
}
function post(op, extra = {}) {
  return new Request('https://do.internal/', { method: 'POST', body: JSON.stringify({ op, ...extra }) });
}
async function codeHmac(code, secret = 'phase2-test-secret') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('fetch RPC: requestCode then correct submitCode succeeds; reuse fails; state persisted', async () => {
  const st = makeState();
  const doi = new VerificationDO(st, {});
  const h = await codeHmac('123456');

  const req = await (await doi.fetch(post('requestCode', { codeHmac: h }))).json();
  assert.equal(req.ok, true);
  assert.ok(st._map.get('state').codeHmac === h, 'HMAC persisted to storage');

  const ok = await (await doi.fetch(post('submitCode', { codeHmac: h }))).json();
  assert.equal(ok.ok, true);

  const reuse = await (await doi.fetch(post('submitCode', { codeHmac: h }))).json();
  assert.equal(reuse.ok, false);
  assert.equal(reuse.reason, 'no_active_code');
});

test('fetch RPC: bad body / unknown op / missing codeHmac are rejected', async () => {
  const doi = new VerificationDO(makeState(), {});
  const bad = await doi.fetch(new Request('https://do.internal/', { method: 'POST', body: 'not-json' }));
  assert.equal(bad.status, 400);
  const unk = await (await doi.fetch(post('nope'))).json();
  assert.equal(unk.ok, false);
  const miss = await doi.fetch(post('requestCode'));
  assert.equal(miss.status, 400);
});

test('responses are never cached (Cache-Control: no-store)', async () => {
  const doi = new VerificationDO(makeState(), {});
  const res = await doi.fetch(post('canSend'));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('concurrency via simulated input gate: only one duplicate submit succeeds', async () => {
  const st = makeState();
  const doi = new VerificationDO(st, {});
  const h = await codeHmac('654321');
  await doi.fetch(post('requestCode', { codeHmac: h }));

  // Simulate the DO input gate: serialize fetches through a queue so they cannot
  // interleave (this is the runtime's guarantee for a single object instance).
  let chain = Promise.resolve();
  const serialized = (op, extra) => (chain = chain.then(() => doi.fetch(post(op, extra)).then((r) => r.json())));
  const [a, b] = await Promise.all([serialized('submitCode', { codeHmac: h }), serialized('submitCode', { codeHmac: h })]);
  const successes = [a, b].filter((r) => r.ok).length;
  assert.equal(successes, 1);
});

test('stored blob contains no plaintext code, no email, no secret', async () => {
  const st = makeState();
  const doi = new VerificationDO(st, {});
  await doi.fetch(post('requestCode', { codeHmac: await codeHmac('999000') }));
  const blob = JSON.stringify(st._map.get('state'));
  assert.equal(blob.includes('999000'), false);
  assert.equal(blob.includes('@'), false);
  assert.equal(blob.toLowerCase().includes('secret'), false);
});
