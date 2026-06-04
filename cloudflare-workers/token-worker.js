// Cloudflare Worker: mhms-chat-token
// URL: https://mhms-chat-token.jonathan-5ad.workers.dev
// Generates a Stream Chat user token (JWT, HS256) on demand.
//
// Environment variables (set in Cloudflare > Worker > Settings > Variables):
//   STREAM_SECRET  (type: Secret)  -- the Stream app SECRET (NOT the public API key)
//
// Usage from the chat app:
//   GET https://mhms-chat-token.jonathan-5ad.workers.dev?user_id=cats-sarah-ab12c
//   -> { "token": "<jwt>" }
//
// The token is a standard Stream user token: HS256 JWT with payload { user_id }
// signed with the Stream app secret. No expiration is set so tokens stay valid.
//
// NOTE: This is a low-security model appropriate for a paywalled cohort. Anyone
// who can reach this URL can mint a token for any user_id. It is acceptable here
// because the chat sits behind the Squarespace paywall and there is no sensitive
// data, but do not reuse this pattern for anything requiring real auth.

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
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

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
