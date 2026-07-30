// Collier auth proof — Cloudflare Pages Function
// Route: POST /proof/logout
//
// FEASIBILITY PROOF ONLY. Expires the proof cookie. Idempotent: succeeds even
// if the cookie is already absent. No identity, no secrets.

const APPROVED_ORIGIN = 'https://chat.mentalhealthmadesimple.life';
const COOKIE_NAME = '__Host-collier_auth_proof';
// Same attributes as when set, Max-Age=0 to expire immediately.
const CLEAR_COOKIE =
  `${COOKIE_NAME}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': APPROVED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get('Origin');
  if (origin !== APPROVED_ORIGIN) {
    return new Response(JSON.stringify({ ok: false, error: 'origin_not_allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Vary': 'Origin' },
    });
  }
  // Idempotent expiry — always 200 regardless of whether a cookie was present.
  return new Response(JSON.stringify({ ok: true, cleared: true }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Set-Cookie': CLEAR_COOKIE },
  });
}

export function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin');
  if (origin !== APPROVED_ORIGIN) return new Response(null, { status: 403, headers: { 'Vary': 'Origin' } });
  return new Response(null, { status: 204, headers: { ...corsHeaders(), 'Access-Control-Max-Age': '600' } });
}
