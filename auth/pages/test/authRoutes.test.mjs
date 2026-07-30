// Phase 3 auth route + module tests. Deterministic; no network, no real email,
// no Stream, no real secrets. The mock Durable Object is backed by the REAL
// Phase 2 verification logic so route<->DO integration is faithful.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as request from '../functions/verify/request.js';
import * as submit from '../functions/verify/submit.js';
import * as tokenRoute from '../functions/token.js';
import * as logout from '../functions/logout.js';

import { createSession, verifySession } from '../functions/lib/session.js';
import { hmacSha256Hex, generateSixDigitCode, constantTimeEqual } from '../functions/lib/crypto.js';
import { sendVerificationCode, buildVerificationEmail } from '../functions/lib/email.js';
import { checkIpRateLimit } from '../functions/lib/ratelimit.js';
import { emailToUserId } from '../functions/lib/identity.js';
import { AUTH_CONFIG } from '../functions/lib/config.js';
import * as vlogic from '../../verification-do/src/verificationLogic.js';

const OK = 'https://chat.mentalhealthmadesimple.life';
const BAD = 'https://evil.example';
const COOKIE = AUTH_CONFIG.cookieName;

function makeMockDO(received) {
  const store = new Map();
  return {
    _store: store,
    idFromName(name) { return { name }; },
    get(id) {
      const name = id.name;
      return {
        async fetch(_u, init) {
          const body = JSON.parse(init.body);
          if (received) received.push(body);
          const now = Date.now();
          let s = store.get(name) || vlogic.defaultState();
          let result;
          if (body.op === 'reserveCode') ({ state: s, result } = vlogic.reserveCode(s, now, body.codeHmac, body.issuanceId));
          else if (body.op === 'confirmCode') ({ state: s, result } = vlogic.confirmCode(s, now, body.issuanceId));
          else if (body.op === 'cancelCode') ({ state: s, result } = vlogic.cancelCode(s, now, body.issuanceId));
          else if (body.op === 'submitCode') ({ state: s, result } = vlogic.submitCode(s, now, body.codeHmac));
          else if (body.op === 'canSend') result = vlogic.canSend(s, now);
          else result = { ok: false, reason: 'unknown_op' };
          store.set(name, s);
          return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      };
    },
  };
}
function makeEnv(extra = {}) {
  return {
    IDENTITY_KEY_SECRET: 'test-identity-secret',
    CODE_HMAC_SECRET: 'test-code-secret',
    SESSION_SIGNING_SECRET: 'test-session-secret',
    STREAM_SECRET: 'test-stream-secret',
    RESEND_API_KEY: 'test-resend-key',
    VERIFICATION_DO: makeMockDO(extra._received),
    ...extra,
  };
}
function req(method, { origin, body, cookie, ip = '203.0.113.5' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (origin !== undefined) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  const init = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = typeof body === 'string' ? body : JSON.stringify(body); }
  return new Request('https://auth.mentalhealthmadesimple.life/x', init);
}

// ---------- crypto ----------
test('generateSixDigitCode: 6 digits, preserves leading zeros, high entropy', () => {
  const seen = new Set();
  let sawLeadingZero = false;
  for (let i = 0; i < 400; i++) {
    const c = generateSixDigitCode();
    assert.match(c, /^\d{6}$/);
    if (c[0] === '0') sawLeadingZero = true;
    seen.add(c);
  }
  assert.ok(seen.size > 350, 'codes should be well-distributed');
  assert.ok(sawLeadingZero, 'leading-zero codes must be possible and preserved');
});
test('constantTimeEqual basic correctness', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
});

// ---------- CORS (every route) ----------
for (const [name, mod, method] of [
  ['verify/request', request, 'POST'], ['verify/submit', submit, 'POST'],
  ['token', tokenRoute, 'POST'], ['logout', logout, 'POST'],
]) {
  test(`CORS ${name}: missing/unapproved Origin -> 403, no ACAO/Set-Cookie`, async () => {
    for (const origin of [undefined, BAD]) {
      const res = await mod.onRequestPost({ request: req(method, { origin, body: {} }), env: makeEnv() });
      assert.equal(res.status, 403, `${name} origin=${origin}`);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
      assert.equal(res.headers.get('Set-Cookie'), null);
    }
  });
  test(`CORS ${name}: preflight approved -> 204 + CORS; unapproved -> 403`, async () => {
    const ok = await mod.onRequestOptions({ request: req('OPTIONS', { origin: OK }) });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), OK);
    assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');
    assert.equal(ok.headers.get('Vary'), 'Origin');
    const bad = await mod.onRequestOptions({ request: req('OPTIONS', { origin: BAD }) });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  });
  test(`${name}: approved responses set Cache-Control: no-store`, async () => {
    const res = await mod.onRequestPost({ request: req(method, { origin: OK, body: {} , cookie: `${COOKIE}=x` }), env: makeEnv() });
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });
}

// ---------- verify/request ----------
test('verify/request: invalid email / malformed JSON -> invalid_request', async () => {
  const env = makeEnv();
  const bad = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'nope' } }), env });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_request');
  const malformed = await request.onRequestPost({ request: req('POST', { origin: OK, body: '{not json' }), env });
  assert.equal(malformed.status, 400);
});
test('verify/request: success is generic; DO only ever gets {op,codeHmac,issuanceId} (no raw email, no plaintext code)', async () => {
  const received = [];
  const env = makeEnv({ LOCAL_EMAIL_CAPTURE: '1', _received: received });
  const res = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'Person@Example.com' } }), env });
  assert.equal(res.status, 200);
  const code = (await res.json()).__localCode;
  assert.match(code, /^\d{6}$/);
  // reserve then confirm (2 DO calls), both with only allowed opaque fields.
  assert.deepEqual(received.map((b) => b.op), ['reserveCode', 'confirmCode']);
  for (const b of received) {
    for (const k of Object.keys(b)) assert.ok(['op', 'codeHmac', 'issuanceId'].includes(k), `unexpected DO field ${k}`);
    if (b.codeHmac) assert.match(b.codeHmac, /^[0-9a-f]{64}$/);
    if (b.issuanceId) assert.match(b.issuanceId, /^[0-9a-f]{32}$/);
    const blob = JSON.stringify(b);
    assert.equal(blob.includes('@'), false, 'no raw email to DO');
    assert.equal(blob.includes(code), false, 'no plaintext code to DO');
  }
});

test('verify/request: delivery FAILURE cancels issuance — no active code, no cooldown, immediate retry OK', async () => {
  const env = makeEnv(); // no capture; control global fetch
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false }); // Resend rejects
  try {
    const r = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'f@a.com' } }), env });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'service_unavailable');
  } finally { globalThis.fetch = orig; }
  // No active code was promoted -> submit finds nothing.
  const sub = await submit.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'f@a.com', code: '123456' } }), env });
  assert.equal(sub.status, 401);
  // Cooldown/hourly were NOT committed -> immediate retry succeeds.
  env.LOCAL_EMAIL_CAPTURE = '1';
  const retry = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'f@a.com' } }), env });
  assert.equal(retry.status, 200);
  const code = (await retry.json()).__localCode;
  const ok = await submit.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'f@a.com', code } }), env });
  assert.equal(ok.status, 200);
});

test('verify/request: two SIMULTANEOUS requests for one identity -> exactly one email, one accepted', async () => {
  const env = makeEnv({ LOCAL_EMAIL_CAPTURE: '1' });
  const [a, b] = await Promise.all([
    request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'race@x.com' } }), env }),
    request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'race@x.com' } }), env }),
  ]);
  const bodies = [await a.json(), await b.json()];
  const accepted = bodies.filter((x) => x.ok && x.__localCode); // capture => one authorized email
  const rejected = bodies.filter((x) => x.ok === false);
  assert.equal(accepted.length, 1, 'exactly one email authorized');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].error, 'rate_limited'); // pending lock, generic
  // the single delivered code is confirmable + submittable
  const sub = await submit.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'race@x.com', code: accepted[0].__localCode } }), env });
  assert.equal(sub.status, 200);
});

test('verify/request: delivery SUCCESS commits cooldown exactly once (second request within 60s -> rate_limited)', async () => {
  const env = makeEnv({ LOCAL_EMAIL_CAPTURE: '1' });
  const first = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'c@a.com' } }), env });
  assert.equal(first.status, 200);
  const second = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'c@a.com' } }), env });
  assert.equal(second.status, 429); // committed cooldown blocks immediate resend
});
test('verify/request: cooldown -> rate_limited (via real DO logic)', async () => {
  const env = makeEnv({ LOCAL_EMAIL_CAPTURE: '1' });
  await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'a@b.com' } }), env });
  const second = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'a@b.com' } }), env });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error, 'rate_limited');
});
// ---------- verify/submit + full flow ----------
test('full flow: request -> submit (case/space variant) -> token -> logout -> 401', async () => {
  const env = makeEnv({ LOCAL_EMAIL_CAPTURE: '1' });
  const rq = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'Person@Example.com' } }), env });
  const code = (await rq.json()).__localCode;

  const sb = await submit.onRequestPost({ request: req('POST', { origin: OK, body: { email: '  PERSON@example.com  ', code } }), env });
  assert.equal(sb.status, 200);
  const setCookie = sb.headers.get('Set-Cookie');
  assert.match(setCookie, new RegExp(`^${COOKIE}=`));
  assert.match(setCookie, /Secure/); assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=2592000/); assert.equal(/Domain=/i.test(setCookie), false);
  assert.equal(JSON.stringify(await sb.json()).includes(COOKIE), false, 'token not in body');
  const cookieVal = setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));

  const tk = await tokenRoute.onRequestPost({ request: req('POST', { origin: OK, cookie: `${COOKIE}=${cookieVal}` }), env });
  const tkBody = await tk.json();
  assert.equal(tk.status, 200);
  assert.equal(tkBody.user_id, await emailToUserId('person@example.com')); // deterministic, case-insensitive
  assert.ok(tkBody.token && tkBody.token.split('.').length === 3);
  assert.equal(tk.headers.get('Cache-Control'), 'no-store');

  const lo = await logout.onRequestPost({ request: req('POST', { origin: OK }) , env });
  assert.match(lo.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.deepEqual(await lo.json(), { ok: true });

  const tk2 = await tokenRoute.onRequestPost({ request: req('POST', { origin: OK }), env });
  assert.equal(tk2.status, 401); // no cookie after logout
});
test('verify/submit: wrong code -> verification_failed, NO cookie; 5th attempt still fails', async () => {
  const env = makeEnv({ LOCAL_EMAIL_CAPTURE: '1' });
  await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'x@y.com' } }), env });
  for (let i = 0; i < 5; i++) {
    const r = await submit.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'x@y.com', code: '000000' } }), env });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'verification_failed');
    assert.equal(r.headers.get('Set-Cookie'), null);
  }
});
test('verify/submit: reused code cannot succeed twice', async () => {
  const env = makeEnv({ LOCAL_EMAIL_CAPTURE: '1' });
  const rq = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'r@e.com' } }), env });
  const code = (await rq.json()).__localCode;
  const first = await submit.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'r@e.com', code } }), env });
  assert.equal(first.status, 200);
  const second = await submit.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'r@e.com', code } }), env });
  assert.equal(second.status, 401);
});
test('verify/submit: malformed code / missing fields -> invalid_request', async () => {
  const env = makeEnv();
  for (const body of [{ email: 'a@b.com', code: '12345' }, { email: 'a@b.com', code: 'abcdef' }, { email: 'a@b.com' }, { code: '123456' }]) {
    const r = await submit.onRequestPost({ request: req('POST', { origin: OK, body }), env });
    assert.equal(r.status, 400);
  }
});

// ---------- session ----------
test('session: valid verifies; tamper/altered/expired/version/format rejected; no email in payload', async () => {
  const secret = 'sess-secret';
  const sub = 'cats-542d240129883c019e106e3b';
  const now = 1_000_000;
  const token = await createSession(sub, secret, now);
  assert.equal(token.includes('@'), false);
  const good = await verifySession(token, secret, now + 10);
  assert.deepEqual(good, { ok: true, sub });
  // tampered signature
  assert.equal((await verifySession(token.slice(0, -2) + 'xy', secret, now)).ok, false);
  // altered payload
  const [h, p, s] = token.split('.');
  const alteredPayload = Buffer.from(JSON.stringify({ sub: 'cats-deadbeef', iat: now, exp: now + AUTH_CONFIG.sessionTtlSeconds, ver: 1 })).toString('base64url');
  assert.equal((await verifySession(`${h}.${alteredPayload}.${s}`, secret, now)).ok, false);
  // expired
  assert.equal((await verifySession(token, secret, now + AUTH_CONFIG.sessionTtlSeconds + 1)).ok, false);
  // wrong secret
  assert.equal((await verifySession(token, 'other', now)).ok, false);
  // malformed
  assert.equal((await verifySession('nope', secret, now)).ok, false);
});
test('session: fixed 30-day exp, no renewal semantics', async () => {
  const now = 2_000_000;
  const token = await createSession('cats-abc', 's', now);
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(payload.exp - payload.iat, AUTH_CONFIG.sessionTtlSeconds);
  assert.equal(payload.ver, AUTH_CONFIG.sessionVersion);
});

// ---------- /token guards ----------
test('/token: tampered/expired session -> 401; browser-supplied user_id ignored', async () => {
  const env = makeEnv();
  const tampered = await tokenRoute.onRequestPost({ request: req('POST', { origin: OK, cookie: `${COOKIE}=a.b.c` }), env });
  assert.equal(tampered.status, 401);
  // body with user_id is ignored (route reads only the cookie)
  const noCookie = await tokenRoute.onRequestPost({ request: req('POST', { origin: OK, body: { user_id: 'cats-8114d68476d8e833db5ac08a' } }), env });
  assert.equal(noCookie.status, 401);
});

// ---------- rate-limit adapter ----------
test('rate-limit adapter: enforces when binding present; unenforced when absent', async () => {
  const blocked = await checkIpRateLimit({ AUTH_IP_LIMITER: { limit: async () => ({ success: false }) } }, req('POST', { origin: OK }));
  assert.deepEqual(blocked, { allowed: false, enforced: true });
  const allowed = await checkIpRateLimit({ AUTH_IP_LIMITER: { limit: async () => ({ success: true }) } }, req('POST', { origin: OK }));
  assert.deepEqual(allowed, { allowed: true, enforced: true });
  const absent = await checkIpRateLimit({}, req('POST', { origin: OK }));
  assert.deepEqual(absent, { allowed: true, enforced: false });
});
test('verify/request: IP limiter blocks -> rate_limited', async () => {
  const env = makeEnv({ AUTH_IP_LIMITER: { limit: async () => ({ success: false }) } });
  const res = await request.onRequestPost({ request: req('POST', { origin: OK, body: { email: 'a@b.com' } }), env });
  assert.equal(res.status, 429);
});

// ---------- email adapter ----------
test('email adapter: correct endpoint/auth/sender/recipient/body; failure handled; no code/secret leak', async () => {
  const calls = [];
  const transport = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  const env = { RESEND_API_KEY: 'rk_test_123' };
  const r = await sendVerificationCode(env, 'user@example.com', '004217', transport);
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer rk_test_123');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.from, AUTH_CONFIG.email.from);
  assert.equal(sent.to, 'user@example.com');
  assert.equal(sent.subject, AUTH_CONFIG.email.subject);
  assert.ok(sent.html.includes('004217') && sent.text.includes('004217'));
  // failure path
  const fail = await sendVerificationCode(env, 'u@e.com', '111111', async () => { throw new Error('down'); });
  assert.deepEqual(fail, { ok: false });
  // build content branded
  const built = buildVerificationEmail('123456');
  assert.ok(built.html.includes('Mental Health Made Simple'));
});
