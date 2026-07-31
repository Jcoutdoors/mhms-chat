// POST /token — mint a Stream token from the authenticated session (Phase 3).
// The browser never supplies user_id; identity comes only from the session subject.
import { isApprovedOrigin, rejectOrigin, preflight, jsonApproved, errorApproved } from './lib/http.js';
import { readSessionCookie } from './lib/cookie.js';
import { verifySession } from './lib/session.js';
import { createStreamToken } from './lib/stream.js';
import { isInstructorSub } from './lib/instructor.js';

export function onRequestOptions(context) { return preflight(context.request, 'POST, OPTIONS'); }

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isApprovedOrigin(request)) return rejectOrigin();

  const cookie = readSessionCookie(request);
  if (!cookie) return errorApproved('session_required', 401);

  const session = await verifySession(cookie, env.SESSION_SIGNING_SECRET);
  if (!session.ok) return errorApproved('session_invalid', 401);

  try {
    const token = await createStreamToken(session.sub, env.STREAM_SECRET);
    // Instructor is derived SERVER-SIDE from the verified session subject against a
    // server-controlled allowlist. The browser cannot supply or override it, and it
    // fails closed to false. Additive field; token/user_id behavior is unchanged.
    const instructor = await isInstructorSub(env, session.sub);
    return jsonApproved({ ok: true, token, user_id: session.sub, instructor });
  } catch {
    return errorApproved('service_unavailable', 503);
  }
}
