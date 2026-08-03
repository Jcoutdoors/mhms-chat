// POST /token — mint a Stream token from the authenticated session (Phase 3).
// The browser never supplies user_id; identity comes only from the session subject.
import { isApprovedOrigin, rejectOrigin, preflight, jsonApproved, errorApproved } from './lib/http.js';
import { readSessionCookie } from './lib/cookie.js';
import { verifySession } from './lib/session.js';
import { createStreamToken } from './lib/stream.js';
import { resolveInstructor } from './lib/instructor.js';

export function onRequestOptions(context) { return preflight(context.request, 'POST, OPTIONS'); }

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isApprovedOrigin(request)) return rejectOrigin();

  const cookie = readSessionCookie(request);
  if (!cookie) return errorApproved('session_required', 401);

  const session = await verifySession(cookie, env.SESSION_SIGNING_SECRET);
  if (!session.ok) return errorApproved('session_invalid', 401);

  // Stream-token minting is the only route-fatal step: a failure here is a genuine
  // 503. It is kept in its own try/catch so the OPTIONAL instructor claim cannot
  // interrupt a valid token response.
  let token;
  try {
    token = await createStreamToken(session.sub, env.STREAM_SECRET);
  } catch {
    return errorApproved('service_unavailable', 503);
  }

  // Instructor is derived SERVER-SIDE from the verified session subject against a
  // server-controlled allowlist. resolveInstructor ALWAYS returns a literal boolean
  // and never throws — any config/derivation failure fails closed to false without
  // affecting token/user_id. The browser cannot supply or override it.
  const instructor = await resolveInstructor(env, session.sub);
  return jsonApproved({ ok: true, token, user_id: session.sub, instructor });
}
