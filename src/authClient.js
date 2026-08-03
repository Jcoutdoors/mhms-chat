// Verified-auth client (VIF Phase 4A1).
//
// The ONLY browser module that talks to the auth service. Every call is
// credentialed (credentials:'include') so the __Host session cookie is sent, and
// targets the fixed approved auth origin. It returns small, typed result objects
// and DELIBERATELY never logs the Stream token, verification code, cookie, email,
// or raw server/provider error text. The identity (user_id) comes only from the
// server's /token response — never derived in the browser.
//
// `fetchImpl` is injectable purely so the logic is unit-testable in Node without
// a network; production callers omit it and get globalThis.fetch.
//
// Pure-ish CommonJS: no console output, no localStorage, no React.

'use strict';

// Fixed approved auth origin. Not configurable at runtime — it is a security
// boundary (exact-origin credentialed CORS is enforced server-side).
const AUTH_BASE = 'https://auth.mentalhealthmadesimple.life';

// Parse a Retry-After header (seconds, integer) into milliseconds, or 0.
function parseRetryAfterMs(headers) {
  try {
    const raw = headers && typeof headers.get === 'function' ? headers.get('Retry-After') : null;
    const secs = raw == null ? NaN : parseInt(String(raw), 10);
    return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0;
  } catch {
    return 0;
  }
}

// Internal credentialed POST. Resolves to a normalized envelope; never throws to
// callers and never logs. Network/parse failures surface as error:'network_error'.
async function postJson(path, body, fetchImpl) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  if (typeof f !== 'function') return { httpStatus: 0, ok: false, error: 'network_error', retryAfterMs: 0, data: null };
  let res;
  try {
    res = await f(`${AUTH_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch {
    return { httpStatus: 0, ok: false, error: 'network_error', retryAfterMs: 0, data: null };
  }
  const retryAfterMs = parseRetryAfterMs(res.headers);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  const okFlag = !!(data && data.ok === true);
  // Prefer the server's safe category; fall back generically by status class.
  const error = okFlag
    ? null
    : (data && typeof data.error === 'string' && data.error) || (res.status >= 500 ? 'service_unavailable' : 'unknown');
  return { httpStatus: res.status, ok: okFlag, error, retryAfterMs, data };
}

// POST /verify/request { email } -> { ok:true } | { ok:false, error, retryAfterMs }
async function requestCode(email, opts = {}) {
  const r = await postJson('/verify/request', { email }, opts.fetchImpl);
  return r.ok ? { ok: true } : { ok: false, error: r.error, retryAfterMs: r.retryAfterMs };
}

// POST /verify/submit { email, code } -> { ok:true } | { ok:false, error, status, retryAfterMs }
async function verifyCode(email, code, opts = {}) {
  const r = await postJson('/verify/submit', { email, code }, opts.fetchImpl);
  return r.ok ? { ok: true } : { ok: false, error: r.error, status: r.httpStatus, retryAfterMs: r.retryAfterMs };
}

// POST /token -> { ok:true, token, userId, instructor } | { ok:false, error, status }
// The token is returned to the caller for the Stream connect step but is never
// logged here; callers must not log it either. `instructor` is the SERVER-DERIVED
// claim added in Phase 4A2 (from the auth service's INSTRUCTOR_EMAILS binding); it
// is passed through fail-closed — only a literal `true` is trusted, anything else
// (absent, "true", 1, …) becomes false. It is never derived in the browser.
async function getToken(opts = {}) {
  const r = await postJson('/token', {}, opts.fetchImpl);
  if (r.ok && r.data && typeof r.data.token === 'string' && typeof r.data.user_id === 'string') {
    return { ok: true, token: r.data.token, userId: r.data.user_id, instructor: r.data.instructor === true };
  }
  return { ok: false, error: r.error || 'session_invalid', status: r.httpStatus };
}

// POST /logout -> { ok:true } | { ok:false, error }
async function logout(opts = {}) {
  const r = await postJson('/logout', {}, opts.fetchImpl);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

module.exports = { AUTH_BASE, requestCode, verifyCode, getToken, logout, parseRetryAfterMs };
