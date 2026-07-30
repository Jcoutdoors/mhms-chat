// Collier auth proof — Cloudflare Pages Function
// Route: GET /proof/check
//
// FEASIBILITY PROOF ONLY. Reports ONLY whether the proof cookie was received
// on this request. Never returns the cookie value. No identity, no secrets.

const APPROVED_ORIGIN = 'https://chat.mentalhealthmadesimple.life';
const COOKIE_NAME = '__Host-collier_auth_proof';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': APPROVED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get('Origin');
  if (origin !== APPROVED_ORIGIN) {
    return new Response(JSON.stringify({ ok: false, error: 'origin_not_allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Vary': 'Origin' },
    });
  }
  const cookie = context.request.headers.get('Cookie') || '';
  const cookiePresent = cookie.split(/;\s*/).some((c) => c.startsWith(COOKIE_NAME + '='));
  // Boolean only — the value is never read out or returned.
  return new Response(JSON.stringify({ ok: true, cookiePresent }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin');
  if (origin !== APPROVED_ORIGIN) return new Response(null, { status: 403, headers: { 'Vary': 'Origin' } });
  return new Response(null, { status: 204, headers: { ...corsHeaders(), 'Access-Control-Max-Age': '600' } });
}
