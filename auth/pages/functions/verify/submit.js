// POST /verify/submit — verify a code, create a session (Phase 3).
import { isApprovedOrigin, rejectOrigin, preflight, readJson, jsonApproved, errorApproved } from '../lib/http.js';
import { normalizeEmail, emailToUserId } from '../lib/identity.js';
import { hmacSha256Hex } from '../lib/crypto.js';
import { deriveObjectName, submitCode } from '../lib/verificationClient.js';
import { createSession } from '../lib/session.js';
import { setSessionCookie } from '../lib/cookie.js';
import { checkIpRateLimit } from '../lib/ratelimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

export function onRequestOptions(context) { return preflight(context.request, 'POST, OPTIONS'); }

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isApprovedOrigin(request)) return rejectOrigin();

  const rl = await checkIpRateLimit(env, request, 'verify_submit'); // fail closed
  if (!rl.allowed) {
    // No VerificationDO call, no code HMAC, no attempt decrement beyond this point.
    return rl.reason === 'unavailable'
      ? errorApproved('service_unavailable', 503)
      : errorApproved('rate_limited', 429, { retryAfterMs: rl.retryAfterMs });
  }

  const body = await readJson(request);
  if (!body || typeof body.email !== 'string' || typeof body.code !== 'string') {
    return errorApproved('invalid_request', 400);
  }
  const norm = normalizeEmail(body.email);
  if (!EMAIL_RE.test(norm) || !CODE_RE.test(body.code)) return errorApproved('invalid_request', 400);

  try {
    const objectName = await deriveObjectName(env, norm);
    const codeHmac = await hmacSha256Hex(body.code, env.CODE_HMAC_SECRET);
    const result = await submitCode(env, objectName, codeHmac); // constant-time HMAC compare in the DO

    if (!result.ok) {
      if (result.reason === 'expired') return errorApproved('verification_expired', 410);
      return errorApproved('verification_failed', 401); // invalid / no_active_code / locked (generic)
    }

    // Success: derive the deterministic Stream ID, sign a session, set the cookie.
    const sub = await emailToUserId(norm);
    const token = await createSession(sub, env.SESSION_SIGNING_SECRET);
    return jsonApproved({ ok: true }, { setCookie: setSessionCookie(token) }); // token NOT in body
  } catch (e) {
    const cat = e && e.message === 'verification_unavailable' ? 'verification_unavailable' : 'service_unavailable';
    return errorApproved(cat, 503);
  }
}
