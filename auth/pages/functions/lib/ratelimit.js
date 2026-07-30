// IP rate-limit adapter (Phase 3) — trailing rolling-window Durable Object.
//
// FAIL CLOSED: if IP_RATE_LIMIT_KEY_SECRET is missing, the IP_RATE_LIMIT_DO
// binding is missing, the trusted client IP is missing, or the limiter call
// errors, the verify routes REFUSE service. Uses ONLY the trusted
// `CF-Connecting-IP` — never X-Forwarded-For, never a JSON/query IP. The Durable
// Object is addressed by an OPAQUE `HMAC-SHA256(clientIP, IP_RATE_LIMIT_KEY_SECRET)`
// name (dedicated secret, NOT IDENTITY_KEY_SECRET), so the raw IP is never a
// routing key or stored. The caller sends only a server-defined policy name.

import { AUTH_CONFIG } from './config.js';
import { hmacSha256Hex } from './crypto.js';

// policyName: 'verify_request' | 'verify_submit' (server-chosen; never from the browser).
// Returns { allowed, reason: 'ok'|'rate_limited'|'unavailable', retryAfterMs }.
export async function checkIpRateLimit(env, request, policyName) {
  if (!env || !env.IP_RATE_LIMIT_KEY_SECRET) {
    return { allowed: false, reason: 'unavailable' }; // dedicated secret missing -> fail closed
  }
  const ns = env[AUTH_CONFIG.ipRateLimit.bindingName];
  if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') {
    return { allowed: false, reason: 'unavailable' }; // binding missing -> fail closed
  }
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) {
    return { allowed: false, reason: 'unavailable' }; // no trusted IP -> fail closed
  }
  try {
    const name = await hmacSha256Hex(ip, env.IP_RATE_LIMIT_KEY_SECRET);
    const stub = ns.get(ns.idFromName(name));
    const res = await stub.fetch('https://ip.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'hit', policy: policyName }),
    });
    if (!res || !res.ok) return { allowed: false, reason: 'unavailable' };
    const out = await res.json();
    if (out && out.allowed) return { allowed: true, reason: 'ok' };
    return { allowed: false, reason: 'rate_limited', retryAfterMs: (out && out.retryAfterMs) || 0 };
  } catch {
    return { allowed: false, reason: 'unavailable' }; // limiter error -> fail closed
  }
}
