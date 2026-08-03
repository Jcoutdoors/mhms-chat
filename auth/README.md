# Collier auth infrastructure (Verified Identity Foundation)

Version-controlled Cloudflare authentication infrastructure. **Phase 3 status:
full server-side auth flow (`auth/pages/`: verify/request, verify/submit, token,
logout + session/cookie/email/rate-limit modules) is DEPLOYED to production and
validated independently** — production routes live at `auth.mentalhealthmadesimple.life`,
Pages → Durable Object binding active, verified Resend sending domain operational,
API validation + production browser matrix complete, and the temporary test harness
removed. **The chat has NOT cut over:** the live chat still uses the legacy token
Worker; that Worker is unchanged and the raw `user_id` impersonation path remains
OPEN until Phase 4/5 (app cutover + old Worker retirement). Phase 4 has not started.
No Stream data changed. Profile Photos has not begun.

## Phase 3 — production auth routes (deployed; no chat cutover)

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
1. **reserve** — an **EXCLUSIVE, short-lived lock**: at most one unexpired pending
   issuance may exist per identity. If a *different* unexpired pending issuance already
   exists, the new reservation is **rejected (`pending`), never superseded**; re-reserving
   the *same* id is idempotent (`accepted:false`, no new delivery). Otherwise it checks
   cooldown/hourly against *committed* sends and records a *pending* issuance (NOT
   submittable). Commits nothing. Only a **newly accepted** reservation (`accepted:true`)
   authorizes an email.
2. **send** — Resend delivery is attempted **only** for a newly accepted reservation.
3. **confirm** (on delivery success) — promotes the matching pending issuance to *active*
   and commits the send/cooldown **exactly once**.
4. **cancel** (on delivery failure) — removes only that pending issuance; **no**
   cooldown/send is consumed, so the user may retry immediately. Cannot cancel a
   newer or already-active issuance.

**One email per identity transaction:** because the pending slot is an exclusive lock and
only a newly accepted reservation sends, concurrent `/verify/request` calls for one identity
authorize **at most one** email; the loser gets the generic `rate_limited` response.

**State (minimal):** active (`codeHmac`/`expiresAt`/`attemptsRemaining`/`consumed`/
`activeIssuanceId`) + `pending` (`{issuanceId, codeHmac, reservedAt}`) + committed
`sends[]`/`lastSendAt`. No raw email, no plaintext code, no secret. Abandoned pending locks
**lazily expire after 2 min**. A pending code is never submittable.

**Ambiguous-timeout policy (conservative):** an explicit Resend rejection **and** an
ambiguous timeout are both treated as failure → cancel locally. In the rare timeout
case the user may receive an unusable code, but is never locked out — they can request
another immediately (no cooldown was committed).

**Concurrency (DO-serialized):** two concurrent requests → exactly one accepted reservation
(one email, one send committed); the pending lock rejects the other rather than superseding
it; a stale/older cancel or confirm cannot affect the accepted issuance; duplicate confirm/
cancel are idempotent; cancel-after-confirm cannot remove the active code; confirm-after-cancel
cannot reactivate. **Identity cooldown and rolling-hour accounting commit only on confirmation.**
- `POST /verify/submit` (`functions/verify/submit.js`) — validate email + 6-digit
  code, HMAC the code, submit HMAC to the DO (constant-time compare, 10-min TTL, 5
  attempts, single-use). On success: derive the deterministic Stream ID, sign a
  session, set the `__Host-` cookie. No cookie on failure. Token never in the body.
- `POST /token` (`functions/token.js`) — read+verify the session cookie, mint a
  Stream token for the session `sub` using `STREAM_SECRET`, return `{ ok, token,
  user_id, instructor }`. The browser never supplies `user_id` or `instructor`.

### Server-derived instructor claim (Phase 4A2)
`/token` returns an additive boolean **`instructor`** derived **server-side** from the
verified session subject — never from the browser, localStorage, client config, or Stream
profile fields. The session stores only `sub` (= `emailToUserId(normalizedEmail)`), so the
service maps each **configured** instructor email through the SAME canonical
normalize+hash (`lib/instructor.js`) and compares the resulting user_ids to `sub`. No
session-format change. **Fail-closed:** missing/blank/malformed config ⇒ `instructor:false`.

- **Config:** `INSTRUCTOR_EMAILS` — a server binding (a plaintext Cloudflare environment
  variable, or a secret if masking is preferred; read as a string either way), a
  separator-delimited (`, ; whitespace`) list of instructor emails. It is authorization
  data: server-side only, never browser-visible, never logged, never returned. The binding
  name is centralized in `AUTH_CONFIG.instructor.bindingName`.
- **Compatibility:** additive only — `token`/`user_id` and all CORS/no-store/credential/
  session/auth behavior are unchanged. The chat app does not yet consume `instructor`
  (that is Phase 4B), so this is backward-compatible.
- **Limitation (NOT hardened here):** this authenticates the *claim*; it does **not** enforce
  Stream roles or channel permissions. Stream still stores a client-writable `instructor`
  custom field on the user object, so Stream-side privilege enforcement remains a separate,
  later modernization initiative. See `TECHNICAL_DEBT.md`.

- `POST /logout` (`functions/logout.js`) — clear the cookie (`Max-Age=0`); idempotent;
  no server-side revocation.

Shared modules in `functions/lib/`: `config.js`, `http.js` (CORS/response), `crypto.js`
(HMAC, CSPRNG code, constant-time), `session.js`, `cookie.js`, `identity.js` (re-exports
the canonical Phase 1 module), `instructor.js` (server-derived instructor claim), `email.js`
(Resend adapter + local capture), `stream.js`, `verificationClient.js` (DO client),
`ratelimit.js`. Files in `functions/lib/` export no `onRequest` handler, so they are
import-only modules, not routes.

### Deploying / rolling back the instructor claim (Phase 4A2)
- **Provision:** set `INSTRUCTOR_EMAILS` on the `collier-auth-proof` Pages project (e.g.
  `wrangler pages secret put INSTRUCTOR_EMAILS`, or a plaintext variable in the dashboard),
  value = the comma-separated instructor emails; then deploy `auth/pages`. No other secret
  changes. Rotate by editing the value and redeploying.
- **Rollback:** redeploy the previous auth Pages version (or unset `INSTRUCTOR_EMAILS` →
  the claim fails closed to `false`). Rollback does not touch the chat app, the legacy token
  Worker, Stream, or any other secret.

### Session
Compact HMAC-SHA256 (JWT-shaped) token; claims `sub`/`iat`/`exp`(=iat+30d)/`ver`.
One `SESSION_SIGNING_SECRET`; no refresh/renewal/sliding/rotation-ring/server store/
revocation. **Emergency rotation of `SESSION_SIGNING_SECRET` invalidates all existing
sessions — users must verify again.** Cookie `__Host-collier_session; Secure; HttpOnly;
SameSite=Lax; Path=/; Max-Age=2592000` (no `Domain`).

### Secret boundary
`auth/pages/` receives `IDENTITY_KEY_SECRET`, `CODE_HMAC_SECRET`, `SESSION_SIGNING_SECRET`,
`STREAM_SECRET`, `RESEND_API_KEY`, and **`IP_RATE_LIMIT_KEY_SECRET`** (provision via
`wrangler pages secret put <NAME>`). `IP_RATE_LIMIT_KEY_SECRET` is **dedicated** to the opaque
IP-rate-limit DO routing name (`HMAC-SHA256(trustedIP, IP_RATE_LIMIT_KEY_SECRET)`) — separate from
`IDENTITY_KEY_SECRET` so the two routing namespaces are cryptographically independent. Generate ≥256
bits (`openssl rand -hex 32`). **Rotation effect:** rotating it changes every IP limiter object
identity, so current IP rate-limit counters reset (a brief loosening) — **no effect** on verified
identity routing, active verification codes, or sessions. `auth/verification-do/` receives **no**
production secret (it stores/compares opaque values only). Values are never committed; tests use
deterministic test-only values.

### Email (branded) — VERIFIED, LIVE
Sender `verification@send.mentalhealthmadesimple.life`. The domain
`send.mentalhealthmadesimple.life` is **verified in Resend and live in production**; the DNS
records at Squarespace/NS1 (SPF TXT on `send`, DKIM `resend._domainkey`, MX
`feedback-smtp…amazonses.com`, optional DMARC) are in place. The auth service uses a **dedicated**
`cats-auth-verification` Resend key (it does **not** fall back to `notifications.nexgenrva.com`).
Real verification email delivery was confirmed during production validation. (Unit tests still use a
mock transport / local capture.)

**Shared single domain (free-plan constraint):** the free Resend plan allows only one domain, so the
same verified `send.mentalhealthmadesimple.life` serves **both** auth verification (`verification@…`)
and the notification Worker (`notifications@…`). The notification Worker's sender migration to this
domain is **complete and deployed** (see `REVIEW_HANDOFF.md` and
`cloudflare-workers/notification-worker.js`); the old `notifications.nexgenrva.com` domain was
removed to free the single slot.

### IP rate limiting (dedicated Durable Object, TRUE ROLLING WINDOWS, FAIL CLOSED)
Both `/verify/request` and `/verify/submit` call `checkIpRateLimit` first. It uses a dedicated
**trailing rolling-window** Durable Object **`IpRateLimitDO`** (exported by the same
`collier-verification-do` Worker; bound to Pages as `IP_RATE_LIMIT_DO`), keyed on the **trusted
`CF-Connecting-IP`** only (never `X-Forwarded-For`, never a JSON/query IP). The DO is addressed by
an **opaque `HMAC-SHA256(clientIP, IP_RATE_LIMIT_KEY_SECRET)`** name (a **dedicated** secret — NOT
`IDENTITY_KEY_SECRET`) and stores **only** per-policy timestamp arrays — never the raw IP.

**Rolling windows, not fixed buckets:** on each hit the DO prunes timestamps older than the
longest window, counts those inside each trailing window relative to `Date.now()`, and rejects if
adding the hit would exceed any threshold (so 5 just before and 1 just after a wall-clock minute
are counted together — no bucket reset). On reject it returns the most conservative `retryAfterMs`
(→ `Retry-After` header on the 429). The public route passes only a **server-defined policy name**
(`verify_request` / `verify_submit`); the browser cannot choose limits or policy values.

**Server-defined policies** (in `ipRateLimitLogic.js`; per-route counters are isolated):
- `verify_request`: **5 / trailing 60s** and **20 / trailing 60m**
- `verify_submit`: **20 / trailing 5m** and **100 / trailing 60m**

These are coarse IP defense-in-depth; the per-identity `VerificationDO` limits (exclusive pending
issuance, 60s resend cooldown, 3 sends/rolling hour, 5 attempts, 10-min expiry, one-time use)
remain the tighter control and are unchanged. **Fail closed:** if `IP_RATE_LIMIT_KEY_SECRET` is
missing, the `IP_RATE_LIMIT_DO` binding is missing, the trusted IP is missing, or the limiter call
errors, the verify routes return `service_unavailable` (503) rather than run unprotected. A
rate-limited request never reaches `VerificationDO`, mints/HMACs no code, sends no email, reserves
no issuance, decrements no attempts, and creates no session/Stream token. The earlier experimental
fail-open `AUTH_IP_LIMITER` (Workers Rate Limiting binding) path was **removed**. Entitlement-
independent (no KV; no public endpoint).

### Local integration proof
`functions/__do-binding-check.js` (Phase 2) has been **removed**. Full-flow local proof uses
`wrangler dev` (DO Worker) + `wrangler pages dev` with `--do` and test-only `--binding` values
incl. `LOCAL_EMAIL_CAPTURE=1` (the email adapter returns the code locally instead of sending).
`harness/browser-auth-harness.html` is a **test-only** browser harness kept OUTSIDE `public/`
(not deployed) and NOT added to the chat app — for local full-flow checks only. The **production
browser matrix is complete**: it was run via a **separate temporary harness served from the chat
origin** (the only approved credentialed-CORS origin), which was **removed immediately after
testing** — both temporary harness URLs now return `404` and **no permanent public harness
exists**. (The exact temporary filename and the add/rename/remove PRs are recorded in
`REVIEW_HANDOFF.md`.)

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

**`auth/verification-do/`** — the Worker exporting `VerificationDO` **and `IpRateLimitDO`**
(trailing rolling-window IP limiter; separate class, same Worker). No public route
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

## Pages → Durable Object binding (active in production)
On the auth Pages project (`collier-auth-proof`), the DO Worker is bound and the binding resolves
in production against the deployed `collier-verification-do` script:
```toml
# (Pages project wrangler config — Phase 3)
[[durable_objects.bindings]]
name = "VERIFICATION_DO"
class_name = "VerificationDO"
script_name = "collier-verification-do"   # the DO Worker deployed from auth/verification-do/
```

## IP rate limiting decision (RESOLVED — dedicated Durable Object, rolling windows, fail closed)
- **Chosen: a dedicated trailing rolling-window Durable Object `IpRateLimitDO`** (exported by
  `collier-verification-do`; Pages binding `IP_RATE_LIMIT_DO`), keyed on the trusted
  `CF-Connecting-IP` via an opaque `HMAC-SHA256(clientIP, IP_RATE_LIMIT_KEY_SECRET)` name
  (dedicated secret, **not** `IDENTITY_KEY_SECRET`). Stores only per-policy timestamp arrays.
  **Server-defined policies:** `verify_request` 5/60s + 20/60m; `verify_submit` 20/5m + 100/60m.
  **Entitlement-independent** (Workers free plan alongside `VerificationDO`) and deployable now.
- **Fail closed:** missing secret / missing binding / missing trusted IP / limiter error →
  `/verify/*` return `service_unavailable` (503). Never runs unprotected. Rate-limited requests do
  no downstream work (no VerificationDO, code, email, issuance, attempt decrement, or session).
- **Removed:** the earlier experimental Cloudflare Workers Rate Limiting binding
  (`AUTH_IP_LIMITER`, `[[unsafe.bindings]]`, fixed-window/fail-open) — its account entitlement was
  unconfirmable without a deploy, so it was replaced by the rolling-window DO limiter above.
- **Not used:** KV (eventually consistent — unsafe for security limits); zone-level
  WAF rate-limiting rules (the domain is not a Cloudflare-managed DNS zone —
  authoritative NS is NS1/Squarespace).

## Secrets (names only — never committed; provisioned via `wrangler secret put`)
`IDENTITY_KEY_SECRET`, `CODE_HMAC_SECRET`, `SESSION_SIGNING_SECRET`,
`STREAM_SECRET`, `RESEND_API_KEY`, `IP_RATE_LIMIT_KEY_SECRET` live on the **Pages Function**
(Phase 3). The Durable Object Worker requires **no** secret. Phase 2 provisions no production
secret values; tests use deterministic test-only secrets.

## Deployment
Not in Phase 2. An isolated non-production deploy to prove bindings requires
explicit approval first. Do not alter the live `collier-auth-proof` deployment or
remove its Phase 0 proof routes.
