// Signed platform session (Phase 3). Compact HMAC-SHA256 token, JWT-shaped.
// Claims: sub (deterministic Stream user ID), iat, exp (iat+30d), ver.
// One active SESSION_SIGNING_SECRET. No refresh, no renewal, no server-side
// store, no revocation. Emergency rotation of the secret invalidates all
// existing sessions (users must verify again) — documented in auth/README.md.

import { AUTH_CONFIG } from './config.js';
import { hmacSha256B64url, b64urlFromString, stringFromB64url, constantTimeEqual } from './crypto.js';

const HEADER = { alg: 'HS256', typ: 'CS' };

export async function createSession(sub, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = {
    sub,
    iat: nowSeconds,
    exp: nowSeconds + AUTH_CONFIG.sessionTtlSeconds,
    ver: AUTH_CONFIG.sessionVersion,
  };
  const signingInput = `${b64urlFromString(JSON.stringify(HEADER))}.${b64urlFromString(JSON.stringify(payload))}`;
  const sig = await hmacSha256B64url(signingInput, secret);
  return `${signingInput}.${sig}`;
}

// Returns { ok:true, sub } or { ok:false, reason }.
export async function verifySession(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return { ok: false, reason: 'session_invalid' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'session_invalid' };
  const [encHeader, encPayload, sig] = parts;

  const expected = await hmacSha256B64url(`${encHeader}.${encPayload}`, secret);
  if (!constantTimeEqual(sig, expected)) return { ok: false, reason: 'session_invalid' };

  let payload;
  try {
    payload = JSON.parse(stringFromB64url(encPayload));
  } catch {
    return { ok: false, reason: 'session_invalid' };
  }
  if (!payload || payload.ver !== AUTH_CONFIG.sessionVersion) return { ok: false, reason: 'session_invalid' };
  if (typeof payload.sub !== 'string' || !payload.sub.startsWith('cats-')) return { ok: false, reason: 'session_invalid' };
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return { ok: false, reason: 'session_invalid' };
  // Reject implausible timestamps (clock-skew guard: iat not meaningfully in the future).
  if (payload.iat > nowSeconds + 300) return { ok: false, reason: 'session_invalid' };
  // Fixed lifetime, no renewal: exp must equal iat + configured TTL.
  if (payload.exp !== payload.iat + AUTH_CONFIG.sessionTtlSeconds) return { ok: false, reason: 'session_invalid' };
  if (nowSeconds >= payload.exp) return { ok: false, reason: 'session_invalid' };

  return { ok: true, sub: payload.sub };
}
