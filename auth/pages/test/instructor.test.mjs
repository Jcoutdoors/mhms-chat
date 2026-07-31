// Server-derived instructor claim tests (VIF Phase 4A2). Deterministic; no network.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as tokenRoute from '../functions/token.js';
import { parseAllowlist, deriveInstructorUserIds, isInstructorSub } from '../functions/lib/instructor.js';
import { createSession } from '../functions/lib/session.js';
import { normalizeEmail, emailToUserId } from '../functions/lib/identity.js';
import { AUTH_CONFIG } from '../functions/lib/config.js';

const OK = AUTH_CONFIG.approvedOrigin;
const BAD = 'https://evil.example';
const COOKIE = AUTH_CONFIG.cookieName;
const SESSION_SECRET = 'test-session-secret';
const INSTRUCTOR = 'jonathan@nexgenrva.com';
const STUDENT = 'student@example.com';

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

// ---------------- unit: allowlist parsing + derivation ----------------

test('parseAllowlist splits on comma/semicolon/whitespace; drops blanks; [] for non-string', () => {
  assert.deepEqual(parseAllowlist('a@b.co, c@d.co; e@f.co\n g@h.co'), ['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co']);
  assert.deepEqual(parseAllowlist('   '), []);
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist(null), []);
  assert.deepEqual(parseAllowlist(42), []);
});

test('#5/#6 empty allowlist and missing config -> empty instructor set (fail closed)', async () => {
  assert.equal((await deriveInstructorUserIds(list(''))).size, 0);
  assert.equal((await deriveInstructorUserIds({})).size, 0);
  assert.equal((await deriveInstructorUserIds(undefined)).size, 0);
  assert.equal(await isInstructorSub(list(''), await emailToUserId(INSTRUCTOR)), false);
  assert.equal(await isInstructorSub({}, await emailToUserId(INSTRUCTOR)), false);
});

test('#1 approved normalized instructor email -> instructor set contains its user_id', async () => {
  const ids = await deriveInstructorUserIds(list(INSTRUCTOR));
  assert.equal(ids.has(await emailToUserId(INSTRUCTOR)), true);
  assert.equal(await isInstructorSub(list(INSTRUCTOR), await emailToUserId(INSTRUCTOR)), true);
});

test('#2 mixed-case configured email normalizes to the same user_id', async () => {
  const ids = await deriveInstructorUserIds(list('JONATHAN@NexGenRVA.com'));
  assert.equal(ids.has(await emailToUserId(INSTRUCTOR)), true);
});

test('#3 leading/trailing whitespace in configured email is normalized', async () => {
  const ids = await deriveInstructorUserIds(list('   jonathan@nexgenrva.com   '));
  assert.equal(ids.has(await emailToUserId(INSTRUCTOR)), true);
});

test('#4 a non-instructor verified email is not in the set', async () => {
  assert.equal(await isInstructorSub(list(INSTRUCTOR), await emailToUserId(STUDENT)), false);
});

test('#7 malformed entries are ignored; valid ones still resolve', async () => {
  const ids = await deriveInstructorUserIds(list('not-an-email, @@@, foo@, , jonathan@nexgenrva.com'));
  assert.equal(ids.size, 1);
  assert.equal(ids.has(await emailToUserId(INSTRUCTOR)), true);
  // an allowlist of only malformed entries yields nothing
  assert.equal((await deriveInstructorUserIds(list('nope, @@, x@'))).size, 0);
});

test('#8 duplicate entries are harmless (deduped)', async () => {
  const ids = await deriveInstructorUserIds(list('jonathan@nexgenrva.com, JONATHAN@nexgenrva.com , jonathan@nexgenrva.com'));
  assert.equal(ids.size, 1);
});

test('isInstructorSub fail-closed on bad subject input', async () => {
  assert.equal(await isInstructorSub(list(INSTRUCTOR), ''), false);
  assert.equal(await isInstructorSub(list(INSTRUCTOR), null), false);
  assert.equal(await isInstructorSub(list(INSTRUCTOR), 123), false);
});

// ---------------- route: /token instructor claim ----------------

test('#1 (route) approved instructor session -> instructor:true', async () => {
  const { sub, body } = await callToken(INSTRUCTOR, list(`${INSTRUCTOR}, dr.mark.mayfield@gmail.com`));
  assert.equal(body.ok, true);
  assert.equal(body.instructor, true);
  assert.equal(body.user_id, sub);
});

test('#4 (route) non-instructor session -> instructor:false', async () => {
  const { body } = await callToken(STUDENT, list(INSTRUCTOR));
  assert.equal(body.instructor, false);
});

test('#6 (route) missing instructor config -> instructor:false even for an instructor email', async () => {
  const { body } = await callToken(INSTRUCTOR, {}); // no INSTRUCTOR_EMAILS
  assert.equal(body.instructor, false);
});

test('#9 token and user_id behavior is unchanged (present + correct) regardless of instructor', async () => {
  const inst = await callToken(INSTRUCTOR, list(INSTRUCTOR));
  const stu = await callToken(STUDENT, list(INSTRUCTOR));
  for (const r of [inst, stu]) {
    assert.equal(r.body.token.split('.').length, 3, 'JWT-shaped token');
    assert.equal(r.body.user_id, r.sub);
  }
});

test('#10 response contains exactly {ok, token, user_id, instructor} with a boolean instructor', async () => {
  const { body } = await callToken(INSTRUCTOR, list(INSTRUCTOR));
  assert.deepEqual(Object.keys(body).sort(), ['instructor', 'ok', 'token', 'user_id']);
  assert.equal(typeof body.instructor, 'boolean');
});

test('#11 a client-supplied instructor/user_id in the body is ignored', async () => {
  // A non-instructor session that tries to assert instructor:true in the body stays false.
  const { body } = await callToken(STUDENT, list(INSTRUCTOR), { instructor: true, user_id: await emailToUserId(INSTRUCTOR) });
  assert.equal(body.instructor, false);
  assert.equal(body.user_id, await emailToUserId(STUDENT)); // from session, not body
});

test('#12 instructor is not inferred from any Stream profile field (route reads no profile)', async () => {
  // Even with profile-like fields injected into the request body, the result is
  // driven only by the session subject + server config.
  const { body } = await callToken(STUDENT, list(INSTRUCTOR), { instructor: true, name: 'Dr X', profile: { instructor: true } });
  assert.equal(body.instructor, false);
});

test('#13 no instructor email, allowlist value, or token is logged', async () => {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  let token;
  try {
    const { body } = await callToken(INSTRUCTOR, list(INSTRUCTOR));
    token = body.token;
  } finally { Object.assign(console, orig); }
  const blob = lines.join('\n');
  assert.equal(blob.includes(INSTRUCTOR), false, 'instructor email not logged');
  assert.equal(blob.includes('nexgenrva'), false, 'allowlist value not logged');
  assert.equal(token && blob.includes(token), false, 'token not logged');
});

test('#14 unauthorized behavior unchanged: no cookie -> 401 session_required; bad cookie -> 401 session_invalid', async () => {
  const noCookie = await tokenRoute.onRequestPost({ request: req({ origin: OK }), env: tokenEnv(list(INSTRUCTOR)) });
  assert.equal(noCookie.status, 401);
  assert.equal((await noCookie.json()).error, 'session_required');
  const badCookie = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie: `${COOKIE}=not.a.session` }), env: tokenEnv(list(INSTRUCTOR)) });
  assert.equal(badCookie.status, 401);
  assert.equal((await badCookie.json()).error, 'session_invalid');
});

test('#15 CORS + no-store unchanged: unapproved origin -> 403 no ACAO; approved -> no-store', async () => {
  const bad = await tokenRoute.onRequestPost({ request: req({ origin: BAD }), env: tokenEnv(list(INSTRUCTOR)) });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const { cookie } = await cookieFor(INSTRUCTOR);
  const good = await tokenRoute.onRequestPost({ request: req({ origin: OK, cookie }), env: tokenEnv(list(INSTRUCTOR)) });
  assert.equal(good.headers.get('Cache-Control'), 'no-store');
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), OK);
  assert.equal(good.headers.get('Access-Control-Allow-Credentials'), 'true');
});
