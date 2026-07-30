// POST /verify/request — issue a verification code (Phase 3).
import { isApprovedOrigin, rejectOrigin, preflight, readJson, jsonApproved, errorApproved } from '../lib/http.js';
import { normalizeEmail } from '../lib/identity.js';
import { generateSixDigitCode, hmacSha256Hex } from '../lib/crypto.js';
import { deriveObjectName, requestCode } from '../lib/verificationClient.js';
import { sendVerificationCode } from '../lib/email.js';
import { checkIpRateLimit } from '../lib/ratelimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function onRequestOptions(context) { return preflight(context.request, 'POST, OPTIONS'); }

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isApprovedOrigin(request)) return rejectOrigin();

  const rl = await checkIpRateLimit(env, request);
  if (!rl.allowed) return errorApproved('rate_limited', 429);

  const body = await readJson(request);
  if (!body || typeof body.email !== 'string') return errorApproved('invalid_request', 400);
  const norm = normalizeEmail(body.email);
  if (!EMAIL_RE.test(norm)) return errorApproved('invalid_request', 400);

  try {
    const objectName = await deriveObjectName(env, norm);
    const code = generateSixDigitCode();
    const codeHmac = await hmacSha256Hex(code, env.CODE_HMAC_SECRET);
    // DO authorizes issuance (one active code, cooldown, hourly limit) BEFORE we email.
    const issue = await requestCode(env, objectName, codeHmac);
    if (!issue.ok) return errorApproved('rate_limited', 429); // cooldown / hourly_limit

    const sent = await sendVerificationCode(env, norm, code);
    if (!sent.ok) return errorApproved('service_unavailable', 503);

    // Generic response (open enrollment: no existence disclosure).
    const out = { ok: true };
    if (sent.captured) out.__localCode = sent.code; // gated: LOCAL_EMAIL_CAPTURE only
    return jsonApproved(out);
  } catch (e) {
    const cat = e && e.message === 'verification_unavailable' ? 'verification_unavailable' : 'service_unavailable';
    return errorApproved(cat, 503);
  }
}
