// Collier auth proof — Cloudflare Pages Function
// Route: POST /proof/set
//
// FEASIBILITY PROOF ONLY. This is NOT production authentication. It sets a
// non-production, value-less proof cookie to verify the __Host- cookie + CORS
// design in the real production topology (auth.* <-> chat.*). No Stream, no
// Resend, no JWT, no user identity, no secrets.

const APPROVED_ORIGIN = 'https://chat.mentalhealthmadesimple.life';
const COOKIE_NAME = '__Host-collier_auth_proof';
// Short lifetime; the value carries no identity or meaning.
const SET_COOKIE =
  `${COOKIE_NAME}=1; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`;

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
  // State-changing route: require the exact approved Origin. Referer is NOT trusted.
  if (origin !== APPROVED_ORIGIN) {
    return new Response(JSON.stringify({ ok: false, error: 'origin_not_allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Vary': 'Origin' },
    });
  }
  return new Response(JSON.stringify({ ok: true, set: true }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Set-Cookie': SET_COOKIE },
  });
}

export function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin');
  if (origin !== APPROVED_ORIGIN) return new Response(null, { status: 403, headers: { 'Vary': 'Origin' } });
  return new Response(null, { status: 204, headers: { ...corsHeaders(), 'Access-Control-Max-Age': '600' } });
}
