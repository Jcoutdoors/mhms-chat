// MHMS Verified Identity Foundation — auth service configuration (Phase 3).
// Small config object rather than scattered strings. No secrets here (secrets
// arrive via env bindings). Branding is MHMS-specific but centralized so a future
// tenant could swap it without touching route logic.

export const AUTH_CONFIG = {
  // Exact approved browser origin (the chat app). No wildcards, ever.
  approvedOrigin: 'https://chat.mentalhealthmadesimple.life',

  // Host-only session cookie.
  cookieName: '__Host-collier_session',
  sessionTtlSeconds: 2592000, // fixed 30 days
  sessionVersion: 1, // `ver` claim; bump only on a breaking session-format change

  // Verification code rules (must match VerificationDO business rules).
  code: {
    length: 6,
    ttlSeconds: 600, // 10 minutes
    resendCooldownSeconds: 60,
    maxSendsPerHour: 3,
    maxAttempts: 5,
  },

  // IP-level request limiting: trailing rolling windows enforced by a dedicated
  // Durable Object (IP_RATE_LIMIT_DO), keyed by an opaque HMAC of the trusted IP
  // using the dedicated IP_RATE_LIMIT_KEY_SECRET. FAIL CLOSED if unavailable.
  // The thresholds are SERVER-DEFINED in the DO (see ipRateLimitLogic POLICIES:
  // verify_request 5/60s + 20/60m; verify_submit 20/5m + 100/60m). The browser
  // never supplies limits/policy values. These are coarse defense-in-depth; the
  // per-identity limits in VerificationDO remain the tighter control.
  ipRateLimit: {
    bindingName: 'IP_RATE_LIMIT_DO',
  },

  // Branded verification email (MHMS). from-domain must be verified in Resend
  // before production (see auth/README.md). Not organization-agnostic by design.
  email: {
    appName: 'Mental Health Made Simple',
    from: 'Mental Health Made Simple <verification@send.mentalhealthmadesimple.life>',
    fromDomain: 'send.mentalhealthmadesimple.life',
    subject: 'Your Mental Health Made Simple verification code',
  },
};
