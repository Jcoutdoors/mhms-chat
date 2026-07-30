// IP rate-limit adapter (Phase 3). Preferred: Cloudflare Workers Rate Limiting
// binding (configurable name). Uses the TRUSTED CF-Connecting-IP, never a
// user-supplied X-Forwarded-For. If the binding is absent, returns unenforced
// (documented) — the deterministic fallback is an IP-keyed Durable Object wired
// at deploy if entitlement is unavailable (see auth/README.md). Per-identity
// limits in VerificationDO remain the tighter, always-on control.

import { AUTH_CONFIG } from './config.js';

// Returns { allowed:boolean, enforced:boolean }.
export async function checkIpRateLimit(env, request) {
  const binding = env && env[AUTH_CONFIG.ipRateLimit.bindingName];
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (binding && typeof binding.limit === 'function') {
    try {
      const { success } = await binding.limit({ key: ip });
      return { allowed: !!success, enforced: true };
    } catch {
      // Fail-open on limiter error, but mark unenforced (per-identity DO limits still apply).
      return { allowed: true, enforced: false };
    }
  }
  return { allowed: true, enforced: false };
}
