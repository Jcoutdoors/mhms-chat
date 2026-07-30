// Phase 0 proof-route source-preservation tests (VIF Phase 2 migration).
// Imports the migrated Pages Functions and exercises their handlers directly
// with a mock context. Proves the migrated source still implements the approved
// Phase 0 contract. No network / Stream / email / secrets. Source-preservation
// only (not the manual browser matrix).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as setFn from '../functions/proof/set.js';
import * as checkFn from '../functions/proof/check.js';
import * as logoutFn from '../functions/proof/logout.js';
import * as doProbe from '../functions/__do-binding-check.js';

const OK = 'https://chat.mentalhealthmadesimple.life';
const BAD = 'https://evil.example';
const COOKIE = '__Host-collier_auth_proof';

function ctx(method, { origin, cookie } = {}) {
  const headers = {};
  if (origin !== undefined) headers.Origin = origin;
  if (cookie !== undefined) headers.Cookie = cookie;
  return { request: new Request('https://auth.local/proof', { method, headers }) };
}

test('POST /proof/set (approved Origin): 200, __Host- cookie with exact attributes, CORS', async () => {
  const res = await setFn.onRequestPost(ctx('POST', { origin: OK }));
  assert.equal(res.status, 200);
  const sc = res.headers.get('Set-Cookie');
  assert.match(sc, new RegExp(`^${COOKIE}=1;`));
  assert.match(sc, /Secure/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Path=\//);
  assert.equal(/Domain=/i.test(sc), false, 'no Domain attribute');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), OK);
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.equal(res.headers.get('Vary'), 'Origin');
  const body = await res.json();
  assert.deepEqual(body, { ok: true, set: true }); // no cookie value disclosed
});

test('POST /proof/set (unapproved Origin): 403, no ACAO, no Set-Cookie', async () => {
  const res = await setFn.onRequestPost(ctx('POST', { origin: BAD }));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('POST /proof/set (missing Origin): 403', async () => {
  const res = await setFn.onRequestPost(ctx('POST'));
  assert.equal(res.status, 403);
});

test('GET /proof/check: boolean only; true iff the cookie is present; never the value', async () => {
  const without = await checkFn.onRequestGet(ctx('GET', { origin: OK }));
  assert.deepEqual(await without.json(), { ok: true, cookiePresent: false });
  const withCookie = await checkFn.onRequestGet(ctx('GET', { origin: OK, cookie: `${COOKIE}=1` }));
  const body = await withCookie.json();
  assert.deepEqual(body, { ok: true, cookiePresent: true });
  assert.equal(JSON.stringify(body).includes('=1'), false); // value not disclosed
  assert.equal(withCookie.headers.get('Access-Control-Allow-Origin'), OK);
});

test('GET /proof/check (unapproved Origin): 403', async () => {
  const res = await checkFn.onRequestGet(ctx('GET', { origin: BAD }));
  assert.equal(res.status, 403);
});

test('POST /proof/logout: expires cookie (Max-Age=0), idempotent', async () => {
  const res = await logoutFn.onRequestPost(ctx('POST', { origin: OK }));
  assert.equal(res.status, 200);
  const sc = res.headers.get('Set-Cookie');
  assert.match(sc, new RegExp(`^${COOKIE}=;`));
  assert.match(sc, /Max-Age=0/);
  assert.match(sc, /Secure/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  assert.equal(/Domain=/i.test(sc), false);
  assert.deepEqual(await res.json(), { ok: true, cleared: true });
});

test('local-only __do-binding-check is GATED: 404 in production (LOCAL_DO_PROOF unset)', async () => {
  const res = await doProbe.onRequest({ env: {}, request: new Request('https://auth.local/__do-binding-check') });
  assert.equal(res.status, 404); // excluded from production behavior; only active when LOCAL_DO_PROOF=1
});

test('OPTIONS preflight: approved -> 204 + CORS; unapproved -> 403 no ACAO', async () => {
  const ok = await setFn.onRequestOptions(ctx('OPTIONS', { origin: OK }));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), OK);
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');
  const bad = await setFn.onRequestOptions(ctx('OPTIONS', { origin: BAD }));
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});
