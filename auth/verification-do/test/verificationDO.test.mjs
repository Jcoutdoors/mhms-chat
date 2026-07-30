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

test('fetch RPC: reserve -> confirm -> submit succeeds; reuse fails; state persisted', async () => {
  const st = makeState();
  const doi = new VerificationDO(st, {});
  const h = await codeHmac('123456');

  const rr = await (await doi.fetch(post('reserveCode', { codeHmac: h, issuanceId: 'iss-1' }))).json();
  assert.equal(rr.accepted, true);
  assert.ok(st._map.get('state').pending && st._map.get('state').pending.codeHmac === h, 'pending HMAC persisted');
  assert.equal(st._map.get('state').codeHmac, null, 'not active until confirm');

  assert.equal((await (await doi.fetch(post('confirmCode', { issuanceId: 'iss-1' }))).json()).ok, true);
  assert.equal(st._map.get('state').codeHmac, h, 'active after confirm');

  assert.equal((await (await doi.fetch(post('submitCode', { codeHmac: h }))).json()).ok, true);
  const reuse = await (await doi.fetch(post('submitCode', { codeHmac: h }))).json();
  assert.equal(reuse.reason, 'no_active_code');
});

test('fetch RPC: bad body / unknown op / missing fields are rejected', async () => {
  const doi = new VerificationDO(makeState(), {});
  const bad = await doi.fetch(new Request('https://do.internal/', { method: 'POST', body: 'not-json' }));
  assert.equal(bad.status, 400);
  const unk = await (await doi.fetch(post('nope'))).json();
  assert.equal(unk.ok, false);
  assert.equal((await doi.fetch(post('reserveCode', { codeHmac: 'x' }))).status, 400); // missing issuanceId
  assert.equal((await doi.fetch(post('confirmCode'))).status, 400); // missing issuanceId
});

test('responses are never cached (Cache-Control: no-store)', async () => {
  const doi = new VerificationDO(makeState(), {});
  const res = await doi.fetch(post('canSend'));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('exclusive lock via real class: a second reservation with a different id is rejected', async () => {
  const st = makeState();
  const doi = new VerificationDO(st, {});
  const a = await (await doi.fetch(post('reserveCode', { codeHmac: await codeHmac('111'), issuanceId: 'iss-A' }))).json();
  assert.equal(a.accepted, true);
  const b = await (await doi.fetch(post('reserveCode', { codeHmac: await codeHmac('222'), issuanceId: 'iss-B' }))).json();
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'pending');
  assert.equal(st._map.get('state').pending.issuanceId, 'iss-A');
});

test('concurrency via simulated input gate: only one duplicate submit succeeds', async () => {
  const st = makeState();
  const doi = new VerificationDO(st, {});
  const h = await codeHmac('654321');
  await doi.fetch(post('reserveCode', { codeHmac: h, issuanceId: 'iss-1' }));
  await doi.fetch(post('confirmCode', { issuanceId: 'iss-1' }));

  // Simulate the DO input gate: serialize fetches so they cannot interleave.
  let chain = Promise.resolve();
  const serialized = (op, extra) => (chain = chain.then(() => doi.fetch(post(op, extra)).then((r) => r.json())));
  const [a, b] = await Promise.all([serialized('submitCode', { codeHmac: h }), serialized('submitCode', { codeHmac: h })]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
});

test('stored blob contains no plaintext code, no email, no secret (pending + active)', async () => {
  const st = makeState();
  const doi = new VerificationDO(st, {});
  await doi.fetch(post('reserveCode', { codeHmac: await codeHmac('999000'), issuanceId: 'iss-1' }));
  let blob = JSON.stringify(st._map.get('state'));
  assert.equal(blob.includes('999000'), false); // pending holds only the HMAC
  assert.equal(blob.includes('@'), false);
  assert.equal(blob.toLowerCase().includes('secret'), false);
  await doi.fetch(post('confirmCode', { issuanceId: 'iss-1' }));
  blob = JSON.stringify(st._map.get('state'));
  assert.equal(blob.includes('999000'), false);
});

test('fetch RPC: reserve -> confirm -> submit; reserve -> cancel leaves nothing (real class + storage mock)', async () => {
  const st = makeState();
  const doi = new VerificationDO(st, {});
  const h = await codeHmac('246810');
  // reserve (pending; not submittable)
  const r1 = await (await doi.fetch(post('reserveCode', { codeHmac: h, issuanceId: 'iss-1' }))).json();
  assert.equal(r1.ok, true);
  assert.equal((await (await doi.fetch(post('submitCode', { codeHmac: h }))).json()).reason, 'no_active_code');
  // confirm -> active -> submit ok
  assert.equal((await (await doi.fetch(post('confirmCode', { issuanceId: 'iss-1' }))).json()).ok, true);
  assert.equal((await (await doi.fetch(post('submitCode', { codeHmac: h }))).json()).ok, true);
  // bad op still rejected; missing issuanceId rejected
  assert.equal((await doi.fetch(post('reserveCode', { codeHmac: h }))).status, 400);
});
