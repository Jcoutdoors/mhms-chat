// Cloudflare Worker: mhms-chat-token
// URL: https://mhms-chat-token.jonathan-5ad.workers.dev
// Generates a Stream Chat user token (JWT, HS256) on demand.
//
// Environment variables (set in Cloudflare > Worker > Settings > Variables):
//   STREAM_SECRET  (type: Secret)  -- the Stream app SECRET (NOT the public API key)
//
// Usage from the chat app:
//   GET https://mhms-chat-token.jonathan-5ad.workers.dev?user_id=cats-...
//   -> { "token": "<jwt>" }
//
// CORS: this worker is called from the browser, so it must return an
// Access-Control-Allow-Origin header that matches the calling page's origin.
// Because the chat can be served from more than one origin (the custom
// subdomain, the GitHub Pages address, and embedded in Squarespace), we keep
// an allow-list and echo back whichever origin matches the request.
//
// ARCHITECTURAL DEBT (intentional, documented, not changed in v61):
//   1. Any request that supplies a user_id can mint a token for that user_id.
//      There is no verification that the caller is actually that person.
//   2. An Origin that is not on ALLOWED_ORIGINS does not get rejected; it
//      silently falls back to ALLOWED_ORIGINS[0] and still receives a token.
//   Both are acceptable for a paywalled cohort chat with no sensitive data,
//   but this is a low-security model and should not be reused for anything
//   requiring real auth. See PROJECT_KNOWLEDGE.md for the full rationale.

const ALLOWED_ORIGINS = [
  'https://chat.mentalhealthmadesimple.life',
  'https://jcoutdoors.github.io',
  'https://www.mentalhealthmadesimple.life',
  'https://mentalhealthmadesimple.life',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  // Echo the origin if it's on the allow-list; otherwise fall back to the subdomain.
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function base64url(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlString(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function createStreamToken(userId, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { user_id: userId };

  const encHeader = base64urlString(JSON.stringify(header));
  const encPayload = base64urlString(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const encSignature = base64url(signature);

  return `${data}.${encSignature}`;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    try {
      const token = await createStreamToken(userId, env.STREAM_SECRET);
      return new Response(JSON.stringify({ token }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
  }
};
