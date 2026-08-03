// Server-derived instructor claim tests (VIF Phase 4A2). Deterministic; no network.
// Uses example-domain fixtures only; the real allowlist lives only in the binding.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as tokenRoute from '../functions/token.js';
import {
  parseAllowlist, deriveInstructorUserIds, isInstructorSub, resolveInstructor,
  MAX_ALLOWLIST_RAW_LENGTH, MAX_ALLOWLIST_ENTRIES,
} from '../functions/lib/instructor.js';
import { createSession } from '../functions/lib/session.js';
import { normalizeEmail, emailToUserId } from '../functions/lib/identity.js';
import { AUTH_CONFIG } from '../functions/lib/config.js';

const OK = AUTH_CONFIG.approvedOrigin;
const BAD = 'https://evil.example';
const COOKIE = AUTH_CONFIG.cookieName;
const SESSION_SECRET = 'test-session-secret';
const INSTRUCTOR = 'instructor@example.com';
const INSTRUCTOR2 = 'lead@example.org';
const STUDENT = 'student@example.net';
const THROWS = () => { throw new Error('canonical derivation failed'); };

function tokenEnv(extra = {}) {
  return { SESSION_SIGNING_SECRET: SESSION_SECRET, STREAM_SECRET: 'test-stream-secret', ...extra };
}
function req({ origin = OK, cookie, body } = {}) {
  const headers = {};
  if (origin !== undefined) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  const init = { method: 'POST', headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = typeof body === 'string' ? body : JSON.stringify(body); }
  return new Request('https://auth.mentalhealthmadesimple.life/token', init);
}
async function cookieFor(email) {
  const sub = await emailToUserId(normalizeEmail(email));
  const token = await createSession(sub, SESSION_SECRET);
  return { sub, cookie: `${COOKIE}=${token}` };
}
async function callToken(email, envExtra, bodyOverride) {
  const { sub, cookie } = await cookieFor(email);
  const res = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie, body: bodyOverride }), env: tokenEnv(envExtra) });
  return { sub, res, body: await res.json() };
}
const list = (s) => ({ [AUTH_CONFIG.instructor.bindingName]: s });

// ---------------- unit: allowlist parsing + bounds ----------------

test('parseAllowlist splits on comma/semicolon/whitespace; drops blanks; [] for non-string', () => {
  assert.deepEqual(parseAllowlist('a@b.co, c@d.co; e@f.co\n g@h.co'), ['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co']);
  assert.deepEqual(parseAllowlist('   '), []);
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist(null), []);
  assert.deepEqual(parseAllowlist(42), []);
});

test('bounds: oversized raw length -> [] (no partial apply)', () => {
  const huge = INSTRUCTOR + ',' + 'x@y.co,'.repeat(MAX_ALLOWLIST_RAW_LENGTH); // well past 16 KB
  assert.ok(huge.length > MAX_ALLOWLIST_RAW_LENGTH);
  assert.deepEqual(parseAllowlist(huge), []);
});

test('bounds: too many entries -> [] (no partial apply)', () => {
  const many = [INSTRUCTOR, ...Array(MAX_ALLOWLIST_ENTRIES).fill('x@y.co')].join(','); // 101 entries, < 16 KB
  assert.ok(many.length <= MAX_ALLOWLIST_RAW_LENGTH);
  assert.deepEqual(parseAllowlist(many), []);
});

test('separator-only config (commas/semicolons/whitespace) -> []', () => {
  for (const s of [',,,', ' ; ; ', ',; , ;', '\t\n  ']) assert.deepEqual(parseAllowlist(s), []);
});

// ---------------- unit: derivation ----------------

test('#5/#6 empty allowlist and missing config -> empty set (fail closed)', async () => {
  assert.equal((await deriveInstructorUserIds(list(''))).size, 0);
  assert.equal((await deriveInstructorUserIds({})).size, 0);
  assert.equal(await isInstructorSub(list(''), await emailToUserId(INSTRUCTOR)), false);
});

test('#13(unit) approved normalized instructor email -> id in the set', async () => {
  const ids = await deriveInstructorUserIds(list(INSTRUCTOR));
  assert.equal(ids.has(await emailToUserId(INSTRUCTOR)), true);
  assert.equal(await isInstructorSub(list(INSTRUCTOR), await emailToUserId(INSTRUCTOR)), true);
});

test('mixed-case + whitespace configured email normalizes to the same user_id', async () => {
  assert.equal((await deriveInstructorUserIds(list('INSTRUCTOR@Example.COM'))).has(await emailToUserId(INSTRUCTOR)), true);
  assert.equal((await deriveInstructorUserIds(list('   instructor@example.com   '))).has(await emailToUserId(INSTRUCTOR)), true);
});

test('#14(unit) non-instructor verified email not in the set', async () => {
  assert.equal(await isInstructorSub(list(INSTRUCTOR), await emailToUserId(STUDENT)), false);
});

test('malformed entries ignored; duplicates deduped; comparison is by canonical user_id', async () => {
  const ids = await deriveInstructorUserIds(list('not-an-email, @@@, foo@, , instructor@example.com, INSTRUCTOR@example.com'));
  assert.equal(ids.size, 1); // one canonical id despite malformed + case-dup
  assert.equal(ids.has(await emailToUserId(INSTRUCTOR)), true);
});

test('oversized/too-many config -> isInstructorSub false even for a listed instructor', async () => {
  const huge = INSTRUCTOR + ',' + 'x@y.co,'.repeat(MAX_ALLOWLIST_RAW_LENGTH);
  const many = [INSTRUCTOR, ...Array(MAX_ALLOWLIST_ENTRIES).fill('x@y.co')].join(',');
  const sub = await emailToUserId(INSTRUCTOR);
  assert.equal(await isInstructorSub(list(huge), sub), false);
  assert.equal(await isInstructorSub(list(many), sub), false);
});

test('Unicode-whitespace separator splits safely (NBSP between two emails)', async () => {
  const ids = await deriveInstructorUserIds(list(`${INSTRUCTOR} ${INSTRUCTOR2}`));
  assert.equal(ids.has(await emailToUserId(INSTRUCTOR)), true);
  assert.equal(ids.has(await emailToUserId(INSTRUCTOR2)), true);
});

// ---------------- unit: resolveInstructor isolation + boolean ----------------

test('resolveInstructor always returns a LITERAL boolean', async () => {
  const inst = await resolveInstructor(list(INSTRUCTOR), await emailToUserId(INSTRUCTOR));
  const stu = await resolveInstructor(list(INSTRUCTOR), await emailToUserId(STUDENT));
  assert.strictEqual(inst, true);
  assert.strictEqual(stu, false);
});

test('resolveInstructor fails CLOSED to false when canonical derivation throws', async () => {
  const env = { ...list(INSTRUCTOR), __instructorToUserId: THROWS };
  const r = await resolveInstructor(env, await emailToUserId(INSTRUCTOR));
  assert.strictEqual(r, false);
});

test('resolveInstructor fail-closed on bad subject input', async () => {
  assert.strictEqual(await resolveInstructor(list(INSTRUCTOR), ''), false);
  assert.strictEqual(await resolveInstructor(list(INSTRUCTOR), null), false);
  assert.strictEqual(await resolveInstructor(list(INSTRUCTOR), 123), false);
});

// ---------------- route: /token instructor claim ----------------

test('#13 (route) approved instructor session -> instructor:true', async () => {
  const { sub, body } = await callToken(INSTRUCTOR, list(`${INSTRUCTOR}, ${INSTRUCTOR2}`));
  assert.equal(body.ok, true);
  assert.strictEqual(body.instructor, true);
  assert.equal(body.user_id, sub);
});

test('#14 (route) non-instructor session -> instructor:false', async () => {
  const { body } = await callToken(STUDENT, list(INSTRUCTOR));
  assert.strictEqual(body.instructor, false);
});

test('(route) missing instructor config -> instructor:false even for an instructor email', async () => {
  const { body } = await callToken(INSTRUCTOR, {});
  assert.strictEqual(body.instructor, false);
});

test('#7 (route) config longer than the approved maximum -> false', async () => {
  const huge = INSTRUCTOR + ',' + 'x@y.co,'.repeat(MAX_ALLOWLIST_RAW_LENGTH);
  const { body } = await callToken(INSTRUCTOR, list(huge));
  assert.strictEqual(body.instructor, false);
});

test('#8/#9 (route) more than the approved entry maximum -> false (not partially applied)', async () => {
  const many = [INSTRUCTOR, ...Array(MAX_ALLOWLIST_ENTRIES).fill('x@y.co')].join(','); // instructor is present but list is over-cap
  const { body } = await callToken(INSTRUCTOR, list(many));
  assert.strictEqual(body.instructor, false);
});

test('#10 (route) separator-only config -> false', async () => {
  const { body } = await callToken(INSTRUCTOR, list(',; , ;'));
  assert.strictEqual(body.instructor, false);
});

test('#11 (route) Unicode-whitespace-separated config is handled safely', async () => {
  const { body } = await callToken(INSTRUCTOR, list(`${INSTRUCTOR} ${INSTRUCTOR2}`));
  assert.strictEqual(body.instructor, true);
});

// ---------------- route: failure isolation (the core Hold fix) ----------------

test('#1/#2/#3/#4 canonical derivation throws -> /token still 200 with instructor:false; token+user_id unchanged', async () => {
  const { sub, cookie } = await cookieFor(INSTRUCTOR);
  // baseline (no throw): capture the deterministic token for the same session.
  const okRes = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie }), env: tokenEnv(list(INSTRUCTOR)) });
  const okBody = await okRes.json();
  // failing derivation via the test seam:
  const failRes = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie }), env: tokenEnv({ ...list(INSTRUCTOR), __instructorToUserId: THROWS }) });
  const failBody = await failRes.json();
  assert.equal(failRes.status, 200);                 // #1 still 200
  assert.equal(failBody.ok, true);
  assert.strictEqual(failBody.instructor, false);    // #2 fail-closed false
  assert.equal(failBody.token, okBody.token);        // #3 token unchanged (deterministic)
  assert.equal(failBody.token.split('.').length, 3);
  assert.equal(failBody.user_id, sub);               // #4 user_id unchanged
});

test('#5 no exception details returned on the failure path (keys only, no error/stack)', async () => {
  const { cookie } = await cookieFor(INSTRUCTOR);
  const res = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie }), env: tokenEnv({ ...list(INSTRUCTOR), __instructorToUserId: THROWS }) });
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['instructor', 'ok', 'token', 'user_id']);
  assert.equal('error' in body, false);
  assert.equal(JSON.stringify(body).toLowerCase().includes('derivation'), false);
});

test('#6 no exception/email/token/config logged on the failure path', async () => {
  const { cookie } = await cookieFor(INSTRUCTOR);
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  let body;
  try {
    const res = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie }), env: tokenEnv({ ...list(INSTRUCTOR), __instructorToUserId: THROWS }) });
    body = await res.json();
  } finally { Object.assign(console, orig); }
  const blob = lines.join('\n');
  assert.equal(blob, '', 'nothing should be logged');
  assert.equal(blob.includes(INSTRUCTOR), false);
  assert.equal(body.token && blob.includes(body.token), false);
});

// ---------------- route: unchanged contract + security ----------------

test('token and user_id present/correct regardless of instructor; response has exactly 4 keys', async () => {
  const inst = await callToken(INSTRUCTOR, list(INSTRUCTOR));
  const stu = await callToken(STUDENT, list(INSTRUCTOR));
  for (const r of [inst, stu]) {
    assert.equal(r.body.token.split('.').length, 3);
    assert.equal(r.body.user_id, r.sub);
    assert.deepEqual(Object.keys(r.body).sort(), ['instructor', 'ok', 'token', 'user_id']);
    assert.equal(typeof r.body.instructor, 'boolean');
  }
});

test('a client-supplied instructor/user_id/profile in the body is ignored', async () => {
  const { body } = await callToken(STUDENT, list(INSTRUCTOR), { instructor: true, user_id: await emailToUserId(INSTRUCTOR), profile: { instructor: true } });
  assert.strictEqual(body.instructor, false);
  assert.equal(body.user_id, await emailToUserId(STUDENT));
});

test('no instructor email, allowlist value, or token is logged (success path)', async () => {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  let token;
  try { token = (await callToken(INSTRUCTOR, list(INSTRUCTOR))).body.token; } finally { Object.assign(console, orig); }
  const blob = lines.join('\n');
  assert.equal(blob.includes(INSTRUCTOR), false);
  assert.equal(blob.includes('example.com'), false);
  assert.equal(token && blob.includes(token), false);
});

test('#15 unauthorized/CORS/no-store unchanged', async () => {
  const noCookie = await tokenRoute.onRequestPost({ request: req({ origin: OK }), env: tokenEnv(list(INSTRUCTOR)) });
  assert.equal(noCookie.status, 401);
  assert.equal((await noCookie.json()).error, 'session_required');
  const badCookie = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie: `${COOKIE}=not.a.session` }), env: tokenEnv(list(INSTRUCTOR)) });
  assert.equal(badCookie.status, 401);
  assert.equal((await badCookie.json()).error, 'session_invalid');
  const bad = await tokenRoute.onRequestPost({ request: req({ origin: BAD }), env: tokenEnv(list(INSTRUCTOR)) });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const { cookie } = await cookieFor(INSTRUCTOR);
  const good = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie }), env: tokenEnv(list(INSTRUCTOR)) });
  assert.equal(good.headers.get('Cache-Control'), 'no-store');
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), OK);
  assert.equal(good.headers.get('Access-Control-Allow-Credentials'), 'true');
});
