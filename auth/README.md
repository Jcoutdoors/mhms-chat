# Collier auth infrastructure (Verified Identity Foundation)

Version-controlled Cloudflare authentication infrastructure. **Phase 2 status:
Durable Object for verification-code state only. NOT deployed. No public auth
routes. Production authentication is unchanged; the raw `user_id` impersonation
path remains open until a later phase. Profile Photos has not begun.**

## Source-control boundary
This lives inside the `mhms-chat` repository under `auth/` (a directory, not a
separate repo) so it is reviewed via the same PR flow as the rest of the platform
and can share the canonical identity contract without cross-repo duplication. The
project boundary stays explicit: `auth/` has its own Wrangler config, package,
and test command, and deploys via **Wrangler to Cloudflare — never** via the chat
app's GitHub Pages pipeline.

> Note: the Phase 0 proof Pages project (`collier-auth-proof`, live at
> `https://auth.mentalhealthmadesimple.life`) currently has its source in an
> un-versioned local folder (`~/dev/collier-auth-proof/`). Phase 2 does not touch
> that live deployment or its proof routes. Reconciling the Pages project source
> into version control is a later-phase task.

## Topology (intended)
```
Browser
  → auth.mentalhealthmadesimple.life         (Cloudflare Pages Functions — Phase 3)
     → VERIFICATION_DO binding               (this Durable Object Worker — Phase 2)
```
The Durable Object Worker exists primarily to export the class and service the
binding. It exposes **no public route** (its own default fetch returns 404).

## `auth/verification-do/` — the Durable Object Worker
- `src/verificationDO.js` — the `VerificationDO` class (classic `fetch` style).
- `src/verificationLogic.js` — pure, unit-tested rules (issue/resend/expire/attempt/consume).
- `src/index.js` — Worker entry: `export { VerificationDO }` + default 404 fetch.
- `wrangler.toml` — DO binding + SQLite migration (free-tier).
- Commands: `npm test` (Node built-in runner; no network/secrets), `npm run validate`
  (`wrangler deploy --dry-run`, no deploy).

### Object key (opaque)
The Pages Function addresses the object by
`idFromName(HMAC-SHA256(normalizedEmail, IDENTITY_KEY_SECRET))`. The Durable
Object only ever sees this opaque key — **never the raw email**.

### Stored state (only)
`codeHmac` (hex), `expiresAt`, `attemptsRemaining`, `sends[]` (rolling hour),
`lastSendAt`, `consumed`. **Never stored:** plaintext code, raw email, session
token, Stream token, Stream secret, Resend key, profile, roles/membership.

### Behavior
6-digit code lifetime 10 min; ≤5 failed attempts (5th locks); one active code per
identity; 60s resend cooldown; ≤3 sends per rolling hour; single-use consume;
expired/reused codes rejected; lazy cleanup of expired code state and of
send timestamps older than one hour (no alarms — not needed by current tests).

### Concurrency
A Durable Object serializes requests per instance (input gate), so the
read-modify-write in each op cannot interleave for the same identity. This is what
prevents cooldown/hourly/attempt/consume races. Tests prove the invariants under
that serialized model (duplicate correct submissions → exactly one success).

## HMAC ownership decision (smallest secure choice)
**The Pages Function computes the code HMAC; the Durable Object stores/compares
HMACs only.** Rationale:
- The plaintext code already exists transiently in the Pages Function (it
  generates it and emails it via Resend), so keeping HMAC computation there means
  the code never reaches the Durable Object — minimizing where the sensitive value
  lives and eliminating its exposure in DO storage/logs.
- `CODE_HMAC_SECRET` then lives in exactly one place (the Pages Function); the DO
  needs **no** code secret at all (no secret duplication).
- The DO compares opaque hex strings (constant-time), which is simple and fully
  testable with deterministic, test-only secrets.

## Pages → Durable Object binding (design; applied in Phase 3, not deployed now)
On the auth Pages project (`collier-auth-proof`), bind the DO Worker:
```toml
# (Pages project wrangler config — Phase 3)
[[durable_objects.bindings]]
name = "VERIFICATION_DO"
class_name = "VerificationDO"
script_name = "collier-verification-do"   # the DO Worker deployed from auth/verification-do/
```

## IP rate limiting decision
- **Preferred: Cloudflare Workers Rate Limiting binding** on the auth Pages
  Functions, keyed by client IP (`CF-Connecting-IP`). Verified to validate in
  Wrangler config (`env.AUTH_IP_LIMITER (ratelimit)`), but wrangler currently
  exposes it under experimental `[[unsafe.bindings]]` ("may change or break"), and
  **account entitlement can only be confirmed by an approved isolated deploy**.
  Ready config (applied on the Pages project in Phase 3):
  ```toml
  [[unsafe.bindings]]
  name = "AUTH_IP_LIMITER"
  type = "ratelimit"
  namespace_id = "1001"
  simple = { limit = 30, period = 60 }
  ```
- **Fallback (if the binding is unavailable/unstable at deploy): a separate
  IP-keyed Durable Object** (same serialization guarantees; `idFromName` = a hash
  of the client IP). Not implemented in Phase 2 (only defined) to keep scope to
  what the verification flow needs.
- **Not used:** KV (eventually consistent — unsafe for security limits); zone-level
  WAF rate-limiting rules (the domain is not a Cloudflare-managed DNS zone —
  authoritative NS is NS1/Squarespace).

## Secrets (names only — never committed; provisioned via `wrangler secret put`)
`IDENTITY_KEY_SECRET`, `CODE_HMAC_SECRET`, `SESSION_SIGNING_SECRET`,
`STREAM_SECRET`, `RESEND_API_KEY` live on the **Pages Function** (Phase 3). The
Durable Object Worker requires **no** secret. Phase 2 provisions no production
secret values; tests use deterministic test-only secrets.

## Deployment
Not in Phase 2. An isolated non-production deploy to prove bindings requires
explicit approval first. Do not alter the live `collier-auth-proof` deployment or
remove its Phase 0 proof routes.
