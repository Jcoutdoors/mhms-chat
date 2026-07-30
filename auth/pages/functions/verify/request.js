// POST /verify/request — issue a verification code (Phase 3).
import { isApprovedOrigin, rejectOrigin, preflight, readJson, jsonApproved, errorApproved } from '../lib/http.js';
import { normalizeEmail } from '../lib/identity.js';
import { generateSixDigitCode, generateIssuanceId, hmacSha256Hex } from '../lib/crypto.js';
import { deriveObjectName, reserveCode, confirmCode, cancelCode } from '../lib/verificationClient.js';
import { sendVerificationCode } from '../lib/email.js';
import { checkIpRateLimit } from '../lib/ratelimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function onRequestOptions(context) { return preflight(context.request, 'POST, OPTIONS'); }

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isApprovedOrigin(request)) return rejectOrigin();

  const rl = await checkIpRateLimit(env, request);
  if (!rl.allowed) {
    // Fail closed: 'unavailable' -> service_unavailable; over-limit -> rate_limited.
    return rl.reason === 'unavailable' ? errorApproved('service_unavailable', 503) : errorApproved('rate_limited', 429);
  }

  const body = await readJson(request);
  if (!body || typeof body.email !== 'string') return errorApproved('invalid_request', 400);
  const norm = normalizeEmail(body.email);
  if (!EMAIL_RE.test(norm)) return errorApproved('invalid_request', 400);

  try {
    const objectName = await deriveObjectName(env, norm);
    const code = generateSixDigitCode();
    const codeHmac = await hmacSha256Hex(code, env.CODE_HMAC_SECRET);
    const issuanceId = generateIssuanceId();

    // 1) RESERVE: exclusive pending lock. Rejects if another pending issuance
    //    exists ('pending') or cooldown/hourly not satisfied — all mapped to the
    //    generic rate_limited response (no pending-vs-cooldown disclosure). Commits
    //    nothing and does not make the code submittable.
    const reserved = await reserveCode(env, objectName, codeHmac, issuanceId);
    if (!reserved.ok) return errorApproved('rate_limited', 429); // pending / cooldown / hourly_limit
    if (!reserved.accepted) {
      // Idempotent re-reservation of the same id: do NOT authorize another email.
      return jsonApproved({ ok: true });
    }

    // 2) DELIVER: send the code only for a NEWLY ACCEPTED reservation.
    const sent = await sendVerificationCode(env, norm, code);

    if (!sent.ok) {
      // 3a) FAILURE (explicit rejection OR ambiguous timeout — both treated as
      //     failure, conservatively): cancel ONLY this issuance. No send/cooldown
      //     is committed, so the user may immediately request another code.
      try { await cancelCode(env, objectName, issuanceId); } catch { /* best-effort; nothing committed */ }
      return errorApproved('service_unavailable', 503);
    }

    // 3b) SUCCESS: confirm — promotes this issuance to active and commits the
    //     send/cooldown exactly once. Only the matching pending issuance promotes.
    await confirmCode(env, objectName, issuanceId);

    // Generic response (open enrollment: no existence disclosure).
    const out = { ok: true };
    if (sent.captured) out.__localCode = sent.code; // gated: LOCAL_EMAIL_CAPTURE only
    return jsonApproved(out);
  } catch (e) {
    const cat = e && e.message === 'verification_unavailable' ? 'verification_unavailable' : 'service_unavailable';
    return errorApproved(cat, 503);
  }
}
