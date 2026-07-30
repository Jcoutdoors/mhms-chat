# Collier auth infrastructure (Verified Identity Foundation)

Version-controlled Cloudflare authentication infrastructure. **Phase 3 status:
full server-side auth flow implemented in `auth/pages/` (verify/request, verify/
submit, token, logout) + session/cookie/email/rate-limit modules. NOT deployed.
The live chat still uses the old token Worker; that Worker is unchanged and the
raw `user_id` impersonation path remains OPEN until Phase 4/5 (app cutover + old
Worker retirement). No Stream data changed. Profile Photos has not begun.**

## Phase 3 — production auth routes (implemented, not deployed)

Routes (all `POST`, exact-origin credentialed CORS, `Cache-Control: no-store`):
- `POST /verify/request` (`functions/verify/request.js`) — validate+normalize email,
  derive opaque DO name `HMAC-SHA256(normalizedEmail, IDENTITY_KEY_SECRET)`, generate
  a CSPRNG 6-digit code + opaque issuance id, HMAC the code with `CODE_HMAC_SECRET`,
  then run the **issuance transaction** (reserve → send → confirm/cancel; see below).
  Generic response (open enrollment; no existence disclosure). IP rate limit applied.
  Never persists/logs the plaintext code.

### Issuance transaction (delivery-safe)
**Invariant:** a code is never submittable unless its delivery was accepted, and an
email never carries a code the service can't validate. The Durable Object exposes
`reserveCode` / `confirmCode` / `cancelCode` keyed by an **opaque, 128-bit random
issuance id** (`generateIssuanceId`), never disclosed to the client:
1. **reserve** — checks cooldown/hourly against *committed* sends, records a *pending*
   issuance (NOT submittable), commits nothing.
2. **send** — Resend delivery is attempted only after the reservation persists.
3. **confirm** (on delivery success) — promotes the pending issuance to *active* and
   commits the send/cooldown **exactly once**. Only the matching pending id promotes.
4. **cancel** (on delivery failure) — removes only that pending issuance; **no**
   cooldown/send is consumed, so the user may retry immediately. Cannot cancel a
   newer or already-active issuance.

**State (minimal):** active (`codeHmac`/`expiresAt`/`attemptsRemaining`/`consumed`/
`activeIssuanceId`) + `pending` (`{issuanceId, codeHmac, reservedAt}`) + committed
`sends[]`/`lastSendAt`. No raw email, no plaintext code, no secret. Pending issuances
lazily expire after 2 min. A pending code is never submittable.

**Ambiguous-timeout policy (conservative):** an explicit Resend rejection **and** an
ambiguous timeout are both treated as failure → cancel locally. In the rare timeout
case the user may receive an unusable code, but is never locked out — they can request
another immediately (no cooldown was committed).

**Concurrency (DO-serialized):** two concurrent requests → only the latest confirmed
issuance becomes active (one send committed); a stale/older cancel or confirm cannot
affect a newer issuance; duplicate confirm/cancel are idempotent; cancel-after-confirm
cannot remove the active code; confirm-after-cancel cannot reactivate.
- `POST /verify/submit` (`functions/verify/submit.js`) — validate email + 6-digit
  code, HMAC the code, submit HMAC to the DO (constant-time compare, 10-min TTL, 5
  attempts, single-use). On success: derive the deterministic Stream ID, sign a
  session, set the `__Host-` cookie. No cookie on failure. Token never in the body.
- `POST /token` (`functions/token.js`) — read+verify the session cookie, mint a
  Stream token for the session `sub` using `STREAM_SECRET`, return `{ ok, token,
  user_id }`. The browser never supplies `user_id`.
- `POST /logout` (`functions/logout.js`) — clear the cookie (`Max-Age=0`); idempotent;
  no server-side revocation.

Shared modules in `functions/lib/`: `config.js`, `http.js` (CORS/response), `crypto.js`
(HMAC, CSPRNG code, constant-time), `session.js`, `cookie.js`, `identity.js` (re-exports
the canonical Phase 1 module), `email.js` (Resend adapter + local capture), `stream.js`,
`verificationClient.js` (DO client), `ratelimit.js`. Files in `functions/lib/` export no
`onRequest` handler, so they are import-only modules, not routes.

### Session
Compact HMAC-SHA256 (JWT-shaped) token; claims `sub`/`iat`/`exp`(=iat+30d)/`ver`.
One `SESSION_SIGNING_SECRET`; no refresh/renewal/sliding/rotation-ring/server store/
revocation. **Emergency rotation of `SESSION_SIGNING_SECRET` invalidates all existing
sessions — users must verify again.** Cookie `__Host-collier_session; Secure; HttpOnly;
SameSite=Lax; Path=/; Max-Age=2592000` (no `Domain`).

### Secret boundary
`auth/pages/` receives `IDENTITY_KEY_SECRET`, `CODE_HMAC_SECRET`, `SESSION_SIGNING_SECRET`,
`STREAM_SECRET`, `RESEND_API_KEY` (provision via `wrangler pages secret put <NAME>`).
`auth/verification-do/` receives **no** production secret (it stores/compares HMACs only).
Values are never committed; tests use deterministic test-only values.

### Email (branded) — DEPLOY BLOCKER until verified
Preferred sender `verification@send.mentalhealthmadesimple.life`. As of implementation the
domain `send.mentalhealthmadesimple.life` is **NOT verified in Resend** (no DNS records).
Before deploy, Jonathan must: (1) add `send.mentalhealthmadesimple.life` as a domain in the
**auth Resend account**, (2) add the Resend-provided DNS records at Squarespace/NS1 (SPF TXT
on `send`, DKIM `resend._domainkey`, MX `feedback-smtp…amazonses.com`, optional DMARC),
(3) create an **auth-specific** `RESEND_API_KEY`. Do NOT silently fall back to
`notifications.nexgenrva.com`. Email is tested here only with a mock transport / local capture.

### IP rate limiting
Adapter is binding-first (`AUTH_IP_LIMITER`, Workers Rate Limiting) keyed on the trusted
`CF-Connecting-IP` (never `X-Forwarded-For`); limit 5/60s (coarse defense-in-depth; the DO
per-identity cooldown/hourly limits are the tighter control). The binding config validated in
Wrangler but **account entitlement is unconfirmed without a deploy**; if unavailable at deploy,
wire the deterministic IP-keyed Durable Object fallback (do not use KV; no public endpoint).

### Local integration proof
`functions/__do-binding-check.js` (Phase 2) has been **removed**. Full-flow local proof uses
`wrangler dev` (DO Worker) + `wrangler pages dev` with `--do` and test-only `--binding` values
incl. `LOCAL_EMAIL_CAPTURE=1` (the email adapter returns the code locally instead of sending).
`harness/browser-auth-harness.html` is a **test-only** browser harness kept OUTSIDE `public/`
(not deployed) and NOT added to the chat app; serve it from the chat origin for a future
approved browser matrix.

## Source-control boundary
This lives inside the `mhms-chat` repository under `auth/` (a directory, not a
separate repo) so it is reviewed via the same PR flow as the rest of the platform
and can share the canonical identity contract without cross-repo duplication. The
project boundary stays explicit: `auth/` has its own Wrangler config, package,
and test command, and deploys via **Wrangler to Cloudflare — never** via the chat
app's GitHub Pages pipeline.

> The Phase 0 proof Pages project source (previously an un-versioned local folder
> `~/dev/collier-auth-proof/`) is now version-controlled under `auth/pages/`
> (migrated byte-identical; verified to match the live deployed route behavior).
> Phase 2 does not deploy or alter the live deployment or its proof routes.

## Directory boundary

**`auth/pages/`** — the Cloudflare **Pages** project for `auth.mentalhealthmadesimple.life`.
- `public/` — placeholder static asset (Pages build output dir).
- `functions/proof/{set,check,logout}.js` — the preserved Phase 0 proof routes.
- `functions/__do-binding-check.js` — LOCAL-ONLY, env-gated (`LOCAL_DO_PROOF=1`)
  proof of the Pages→Durable Object binding; returns 404 whenever `LOCAL_DO_PROOF`
  is not explicitly set (production never sets it). **Must be removed or excluded
  before the first approved production deployment from `auth/pages/`.**
- `wrangler.toml` — Pages config (`pages_build_output_dir`, compatibility date) +
  the external Durable Object binding (`VERIFICATION_DO` → class `VerificationDO`,
  `script_name = "collier-verification-do"`).
- `test/proofRoutes.test.mjs` — source-preservation + gate tests (`npm test`).
- Future Phase 3 routes (`/verify/request`, `/verify/submit`, `/token`, `/logout`)
  will live here. **Not implemented.**

**`auth/verification-do/`** — the Worker exporting `VerificationDO`. No public route
(default fetch 404). The Durable Object implementation + tests.

### Local validation / proof commands (no deploy)
```
# DO Worker tests + config dry-run
cd auth/verification-do && npm test && npm run validate

# Pages proof-route source-preservation + gate tests + Functions build
cd auth/pages && npm test && npm run build

# Runtime Pages→DO integration proof (two local workerd processes):
#   term 1:
cd auth/verification-do && npx wrangler dev --port 8799 --local
#   term 2:
cd auth/pages && npx wrangler pages dev public --port 8788 \
  --do VERIFICATION_DO=VerificationDO@collier-verification-do --binding LOCAL_DO_PROOF=1
#   then drive the gated probe (state persists; concurrent ops serialize):
curl "http://127.0.0.1:8788/__do-binding-check?id=x&op=requestCode&codeHmac=<hex>"
```

### Deployment debt — GitHub Pages source exposure (NOT changed in Phase 2)
The chat app's GitHub Pages root deployment already serves repository source
publicly at `https://chat.mentalhealthmadesimple.life/` (`src/`, `qa-tools/`, docs
all return 200), and after merge it may likewise serve `auth/`. **No secrets or
production credentials are committed** in `auth/` (or elsewhere), and backend source
visibility is **not** a security control. Phase 2 deliberately does **not** change
the GitHub Pages publication model — that is a live hosting-boundary change that
must be validated (full generated output vs current live output) and **reviewed
separately**. Future deployment-hygiene work should publish only the intended static
app output (`index.html`, `chat.bundle.js`, `*.chunk.js`, icons/images, `CNAME`) and
exclude source/infra. Tracked as deployment debt.

### Future deployment (requires explicit approval; NOT done in Phase 2)
```
cd auth/verification-do && npx wrangler deploy          # deploy the DO Worker first
cd auth/pages && npx wrangler pages deploy public       # then the Pages project (with the DO binding)
```
Deploy order matters: the DO Worker (`collier-verification-do`) must exist before
the Pages project's `script_name` binding can resolve.

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
