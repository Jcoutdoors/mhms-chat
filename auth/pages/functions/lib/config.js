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

  // IP-level request limiting (fixed window) enforced by a dedicated Durable
  // Object (IP_RATE_LIMIT_DO). FAIL CLOSED: if the binding is unavailable the
  // verify routes refuse service rather than run unprotected.
  // Reasoning for 5/60s: verification is a deliberate, low-frequency action;
  // ~5 requests per 60s per IP absorbs honest retries/typos across a couple of
  // people behind one NAT while stopping obvious scripted abuse. The per-identity
  // limits (cooldown/hourly) in VerificationDO remain the tighter control.
  ipRateLimit: {
    limit: 5,
    periodSeconds: 60,
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
