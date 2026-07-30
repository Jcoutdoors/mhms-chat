// IP rate-limit adapter (Phase 3) — dedicated fixed-window Durable Object.
//
// FAIL CLOSED: if the IP_RATE_LIMIT_DO binding is unavailable, or the trusted
// client IP is missing, or the limiter call errors, the verify routes REFUSE
// service (never run unprotected). Uses ONLY the trusted `CF-Connecting-IP`
// (never a user-supplied X-Forwarded-For). The Durable Object is addressed by an
// OPAQUE HMAC-derived name so the raw IP is never used as a routing key or stored.

import { AUTH_CONFIG } from './config.js';
import { hmacSha256Hex } from './crypto.js';

// Returns { allowed: boolean, reason: 'ok' | 'rate_limited' | 'unavailable' }.
export async function checkIpRateLimit(env, request) {
  const ns = env && env[AUTH_CONFIG.ipRateLimit.bindingName];
  if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') {
    return { allowed: false, reason: 'unavailable' }; // binding not bound -> fail closed
  }
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) {
    return { allowed: false, reason: 'unavailable' }; // no trusted IP -> fail closed
  }
  try {
    // Opaque IP-derived object name (keyed by IDENTITY_KEY_SECRET); raw IP never stored.
    const name = await hmacSha256Hex(ip, env.IDENTITY_KEY_SECRET);
    const stub = ns.get(ns.idFromName(name));
    const res = await stub.fetch('https://ip.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'hit',
        limit: AUTH_CONFIG.ipRateLimit.limit,
        periodMs: AUTH_CONFIG.ipRateLimit.periodSeconds * 1000,
      }),
    });
    if (!res || !res.ok) return { allowed: false, reason: 'unavailable' };
    const out = await res.json();
    return out && out.allowed ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'rate_limited' };
  } catch {
    return { allowed: false, reason: 'unavailable' }; // limiter error -> fail closed
  }
}
