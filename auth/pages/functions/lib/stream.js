// Stream Chat user token minting (Phase 3). HS256 JWT {user_id}, signed with
// STREAM_SECRET. Identical algorithm to the existing token Worker, but the
// user_id comes ONLY from the verified session subject — never from the browser.

import { b64urlFromString, hmacSha256B64url } from './crypto.js';

export async function createStreamToken(userId, secret) {
  const header = b64urlFromString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64urlFromString(JSON.stringify({ user_id: userId }));
  const signingInput = `${header}.${payload}`;
  const sig = await hmacSha256B64url(signingInput, secret);
  return `${signingInput}.${sig}`;
}
