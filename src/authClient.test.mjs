// authClient tests (Phase 4A1). Injected fetch; no real network. Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_BASE, requestCode, verifyCode, getToken, logout, parseRetryAfterMs } from './authClient.js';

// Build a fake fetch that records calls and returns a queued response.
// Each response: { status, body, headers? } or { throw:true }.
function fakeFetch(queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next || next.throw) throw new Error('network down');
    const entries = Object.entries(next.headers || {});
    return {
      status: next.status,
      headers: { get: (k) => { const hit = entries.find(([h]) => h.toLowerCase() === String(k).toLowerCase()); return hit ? hit[1] : null; } },
      json: async () => next.body,
    };
  };
  return { fn, calls };
}

test('every call is credentialed, JSON, POST, and targets the approved auth origin', async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
  await requestCode('jonathan@h2leadership.com', { fetchImpl: fn });
  const c = calls[0];
  assert.equal(c.url, `${AUTH_BASE}/verify/request`);
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.credentials, 'include');
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(c.init.body), { email: 'jonathan@h2leadership.com' });
});

test('requestCode success -> {ok:true}', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { ok: true } }]);
  assert.deepEqual(await requestCode('a@b.co', { fetchImpl: fn }), { ok: true });
});

test('requestCode rate-limited surfaces error + Retry-After ms', async () => {
  const { fn } = fakeFetch([{ status: 429, body: { ok: false, error: 'rate_limited' }, headers: { 'Retry-After': '42' } }]);
  const r = await requestCode('a@b.co', { fetchImpl: fn });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'rate_limited');
  assert.equal(r.retryAfterMs, 42000);
});

test('verifyCode success and failure map correctly', async () => {
  const ok = fakeFetch([{ status: 200, body: { ok: true } }]);
  assert.deepEqual(await verifyCode('a@b.co', '028621', { fetchImpl: ok.fn }), { ok: true });
  assert.deepEqual(JSON.parse(ok.calls[0].init.body), { email: 'a@b.co', code: '028621' });

  const bad = fakeFetch([{ status: 401, body: { ok: false, error: 'verification_failed' } }]);
  const r = await verifyCode('a@b.co', '000000', { fetchImpl: bad.fn });
  assert.deepEqual(r, { ok: false, error: 'verification_failed', status: 401, retryAfterMs: 0 });
});

test('getToken returns token + userId on success, error on 401', async () => {
  const ok = fakeFetch([{ status: 200, body: { ok: true, token: 'JWT.header.sig', user_id: 'cats-abc123' } }]);
  const r = await getToken({ fetchImpl: ok.fn });
  assert.equal(r.ok, true);
  assert.equal(r.token, 'JWT.header.sig');
  assert.equal(r.userId, 'cats-abc123');

  const no = fakeFetch([{ status: 401, body: { ok: false, error: 'session_required' } }]);
  assert.deepEqual(await getToken({ fetchImpl: no.fn }), { ok: false, error: 'session_required', status: 401 });
});

test('logout success', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { ok: true } }]);
  assert.deepEqual(await logout({ fetchImpl: fn }), { ok: true });
});

test('network failure => {ok:false, error:network_error}, never throws', async () => {
  const { fn } = fakeFetch([{ throw: true }]);
  assert.deepEqual(await requestCode('a@b.co', { fetchImpl: fn }), { ok: false, error: 'network_error', retryAfterMs: 0 });
});

test('5xx with no body maps to service_unavailable', async () => {
  const { fn } = fakeFetch([{ status: 503, body: null }]);
  assert.equal((await getToken({ fetchImpl: fn })).error, 'service_unavailable');
});

test('SECURITY: the client never logs token, code, email, or cookie', async () => {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    const { fn } = fakeFetch([
      { status: 200, body: { ok: true } },                                              // requestCode
      { status: 200, body: { ok: true } },                                              // verifyCode
      { status: 200, body: { ok: true, token: 'SECRET.JWT.VALUE', user_id: 'cats-x' } }, // getToken
      { status: 200, body: { ok: true } },                                              // logout
    ]);
    await requestCode('secret-email@example.com', { fetchImpl: fn });
    await verifyCode('secret-email@example.com', '028621', { fetchImpl: fn });
    await getToken({ fetchImpl: fn });
    await logout({ fetchImpl: fn });
  } finally {
    Object.assign(console, orig);
  }
  const blob = lines.join('\n');
  assert.equal(blob.includes('SECRET.JWT.VALUE'), false);
  assert.equal(blob.includes('secret-email@example.com'), false);
  assert.equal(blob.includes('028621'), false);
});

test('parseRetryAfterMs handles seconds, junk, and missing', () => {
  const mk = (v) => ({ get: () => v });
  assert.equal(parseRetryAfterMs(mk('30')), 30000);
  assert.equal(parseRetryAfterMs(mk('0')), 0);
  assert.equal(parseRetryAfterMs(mk('abc')), 0);
  assert.equal(parseRetryAfterMs(mk(null)), 0);
  assert.equal(parseRetryAfterMs(undefined), 0);
});
