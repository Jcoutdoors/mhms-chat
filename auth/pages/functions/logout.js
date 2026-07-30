// POST /logout — clear the session cookie (Phase 3). Idempotent; no server-side
// revocation, no blacklist, no refresh behavior.
import { isApprovedOrigin, rejectOrigin, preflight, jsonApproved } from './lib/http.js';
import { clearSessionCookie } from './lib/cookie.js';

export function onRequestOptions(context) { return preflight(context.request, 'POST, OPTIONS'); }

export async function onRequestPost(context) {
  if (!isApprovedOrigin(context.request)) return rejectOrigin();
  return jsonApproved({ ok: true }, { setCookie: clearSessionCookie() });
}
