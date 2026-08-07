# Technical Debt

## v63 — ATLAS hero images are unoptimized for their display size

`atlas-hero-transparent.png` (1024x1024, ~1.6MB) and `atlas-hero-white.png` (1254x1254,
~1.2MB) are the original files as provided, used unaltered per explicit instruction not to
crop, recompress, resize, or otherwise modify the artwork without approval. Only the
transparent version is currently wired into the Welcome Back dialog, displayed at 188px on
desktop and 132px on mobile.

This means a user downloads a 1.6MB image to show something rendered at well under 200px.
It's a real page-weight cost, particularly on mobile.

**Fix, when approved:** generate a properly-sized (e.g. 384x384 or smaller, covering 188px at
2x), compressed version for actual use in the dialog, keeping the original file(s) as the
source of truth elsewhere if needed. This is a compression/resize task, not a redraw — the
artwork itself should not change.

## v63 — no dev/sandbox Stream app, so QA runs against production

There is no separate development or sandbox Stream application for this project, so all
browser QA connects to the real production Stream backend. This directly caused the
2026-07-22 incident in which two real production channels were truncated during QA (see
`PROJECT_KNOWLEDGE.md`).

The current mitigation is procedural, not structural: QA must use isolated test-only channels
(prefixed `cats-v63-testonly-`), cleanup scripts must carry a hard prefix guard, `truncate()`
is prohibited, and `APP_CONFIG.channelGroups` is temporarily pointed at a test-only list for
local QA builds. That works, but it depends on discipline every single time.

**Fix, when approved:** provision a separate Stream application for development/QA and point
local builds at its API key, so QA physically cannot reach production data. This is the real
structural fix; the prefix guards are a stopgap.

## QA Safety Guardrails implemented — debt REDUCED, not resolved

The v63 truncation incident is now addressed by enforced tooling rather than convention:
`src/channelConfig.js` as the single production channel source of truth, a production
denylist derived from it, fixed QA fixture users and channels, create-and-validate-only
bootstraps that fail closed, and a shared mutation guard that is the only sanctioned write
path for repository-managed QA scripts. Destructive operations are unreachable by
construction — the Stream adapter exposes no method that could perform them — and a static
inspection script enforces the SDK boundary.

**This debt is NOT resolved.** The following risks are accepted and remain open:

1. **Future unguarded one-off scripts.** The guard only protects code that uses it. Nothing
   at the Stream level stops someone writing a new script that imports the SDK directly and
   truncates a production channel. `staticInspect.js` catches this only inside `qa-tools/`,
   and only when someone runs it. It is not wired into CI.

2. **Unrestricted token-worker `user_id` minting.** `cloudflare-workers/token-worker.js`
   still issues a token for any supplied `user_id` without proving the caller owns that
   identity. **Still OPEN.** The Verified Identity Foundation is closing it: Phase 3
   (`auth/pages/` + `auth/verification-do/`) implemented the authenticated replacement
   (`/verify/*`, `/token`, `/logout`; session-derived Stream ID) and it is now **deployed to
   production and validated independently** (auth service at `auth.mentalhealthmadesimple.life`;
   full browser matrix passed — see `PROJECT_KNOWLEDGE.md`). **However the chat app has NOT cut
   over**, so the old Worker remains live and this vulnerability is **NOT resolved**. It closes
   only when the app cuts over to the authenticated `/token` (Phase 4) and the old Worker is
   retired (Phase 5).

3. **Declared QA actor IDs are not authentication.** Following from (2), the QA actor is an
   operational convention enforced by the tooling. It must never be described as an
   authenticated QA user.

4. **QA fixture invisibility depends on config exclusion and membership discipline**, not on
   a Stream-level access boundary. If a real cohort user were ever added to a QA channel, the
   client-wide notification listeners could surface QA activity to them.

5. **One Stream application still serves both production and QA fixtures.** This remains the
   single largest structural gap. A separate Stream application was considered and rejected as
   disproportionate at current scale; that trade-off should be revisited if QA volume grows or
   if more people start running QA tooling.

6. **Exceptional cleanup remains manual.** There is intentionally no reset or teardown
   utility. Removing anything requires product-owner approval and a human acting directly in
   the Stream dashboard.

**Fix, when the trade-off changes:** provision a separate Stream application for QA and point
local builds at its API key, which converts items 1, 4 and 5 from policy enforcement into a
credential boundary that cannot be bypassed by a careless script.

## VIF Phase 3 — logout is not server-side session revocation (stateless sessions)

The Phase 3 session is a **stateless signed token** (`__Host-collier_session`, HMAC-SHA256,
`sub`/`iat`/`exp=iat+30d`/`ver`). There is no server-side session store or revocation list.
`/logout` clears the browser cookie (`Max-Age=0`) and, once cleared, subsequent `/token` calls
return `401` — but a **previously captured pre-logout token remains valid until its fixed 30-day
expiry**, because the server only checks the signature and `exp`. This was explicitly observed
during production validation (re-presenting a captured pre-logout cookie still returned `200`).

**Risk is reduced by the cookie attributes:** `HttpOnly` prevents JavaScript, including typical XSS,
from directly reading the cookie value; `Secure` restricts transmission to HTTPS; and `SameSite=Lax`
limits cross-site sending. These controls reduce cookie-exfiltration and replay risk but do not
eliminate session abuse. A compromised browser or device, malicious extension, exposed browser
profile, debugging access, or another cookie-capture path could still obtain or use a valid session.
The fixed 30-day replay window is the accepted trade-off for the current phase.

**Fix, if the trade-off changes (do NOT change the architecture without review):** options include
a server-side revocation list / session-version check in the DO, shorter token lifetime with
refresh, or a rotating `ver` claim. Any change is a separately reviewed decision, not part of the
current deployment.

## VIF Phase 4A2 — instructor CLAIM is server-derived, but Stream enforcement is not hardened

`/token` now returns a **server-derived** `instructor` boolean (from the `INSTRUCTOR_EMAILS`
allowlist, matched against the verified session subject — see `auth/README.md`). This removes the
browser as the *source of truth* for the claim. However it does **not** enforce privilege at
Stream: the chat app still writes a client-writable `instructor` custom field onto the Stream user
at connect time, and announcement/@everyone gating is **client-side UI only** — Stream itself does
not restrict who may post. So a determined verified user could still set `instructor:true` on their
own Stream user via the SDK. Impact is low for a closed cohort, and the app does not yet consume the
new server claim (Phase 4B).

**Fix, when prioritized (separate initiative):** enforce instructor/privileged actions server-side
via Stream roles / channel permissions (server SDK role assignment or channel-level permission
policies), and have the app trust only the server-derived `/token` claim. Out of scope for Phase 4A2
(which is authentication/identity, not authorization enforcement).

## VIF Phase 4B2 — current-user instructor is server-sourced, but peer/Stream instructor remains legacy debt

The Phase 4B2 App wiring (`phase4b2-app-wiring`, PR #22 — branch-only, not merged/deployed) now gates
the **current user's** instructor UI (Announcements posting, `@everyone`) **only** on the in-memory
`/token` claim — never `localStorage`, never Stream's current-user `instructor`, never email-derived
logic. The verified-auth connect uses `{ id }` only and the save path never writes `instructor`, so
the new source no longer *originates* a client instructor value for the signed-in user.

Two related items remain **unchanged legacy debt** (not regressions, and not fixed by 4B2):
- **Peer-message instructor:** rendering still reads `msg.user.instructor` from Stream for *other*
  users (e.g. to style/authorize a peer's `@everyone`). That field is client-writable and **not**
  server-verified, so a determined user could influence how their own messages are treated by other
  clients. This is the same class of issue as 4A2 above.
- **Stream permissions are not server-enforced.** Announcement/`@everyone` gating is **client-side UI
  only**; Stream does not restrict who may post. This is **not** claimed to be server-enforced
  authorization anywhere in the app.

**Fix, when prioritized:** same as 4A2 — enforce privileged actions via Stream server-side roles /
channel permissions, and stop trusting any client-writable `instructor` field (current user *or*
peer). Tracked for the post-cutover hardening initiative, after Phase 4C.

## VIF Phase 4C — production cutover open items (stabilization backlog)

The verified-auth bundle was cut over to production on 2026-08-04 (merge
`4fa562f2fec6718bbdadb93f948d2065104e34fb`, live bundle
`9c7fbc64ccbc10c72396079ff7ccc9b103ee417d7402e7afaa20e6127d2b703b`, rollback bundle
`09380247098d05875d891aeb25c64311f460192ae48d00234d6e056f3a039961`). *(The `9c7fbc64…` bundle was
later superseded on 2026-08-05 by the Stage 1 bundle `f1b3ee48…`; see the Stage 1 section below.)*
Supervised live validation
passed (verified-auth, real-Stream no-clobber, session restoration, routing, Stream-only Edit
Profile, community/channels/history, instructor gating, truthful logout-failure + retry, listener
no-duplication, desktop/mobile ATLAS, and the authenticated + logged-out Squarespace iframe). The
following are **non-blocking** open items carried into the stabilization window.

**Production Improvements (UX; no behavior change shipped):**
- **Sign-out control discoverability.** Sign out is a small icon in the sidebar footer next to the
  profile control; it is easy to miss. Consider a clearer label/menu affordance.
- **Missing Edit-Profile cancel control.** `ProfileForm` (in the verified-auth flow) offers only
  "Save Profile" — an editing user can exit only by saving, signing out, or refreshing. Add a Cancel
  that returns to community without saving.

**Deferred hardening:**
- **Session-expiry runtime trigger.** The controller has a tested `sessionExpired()` capability and a
  truthful `sessionExpired` screen, but no runtime trigger decides when to declare a live session
  expired from Stream signals (a speculative trigger could false-positive-kick on a transient drop).
  Wire a conservative trigger during post-cutover hardening.

**Device matrix:**
- **Safari.** Not validated during cutover (unavailable in the validation environment). Validate
  Safari (desktop + iOS) during the stabilization window as a device-matrix item.

**Stabilization constraints (in force 48–72 h from 2026-08-04):** the legacy Worker
(`mhms-chat-token`) remains live, the rollback bundle remains recoverable, and rollback artifacts are
retained. **Do not** retire the legacy Worker, remove the prior bundle, retire legacy identity code,
or begin profile-photo development until stabilization completes and is separately reviewed.

## Stage 1 (Platform Navigation & Home Foundation) — pre-existing items surfaced during closeout

Stage 1 extracted the persistent connected runtime into `usePlatformRuntime` and is live
(bundle `f1b3ee48…`; see `PROJECT_KNOWLEDGE.md` → "Stage 1"). It shipped **no behavior change**.
The following are **not Stage 1 regressions**; they were observed or confirmed during Stage 1
closeout and are carried forward.

### Welcome Back can reappear mid-session on new thread activity (pre-existing)

While connected, when new activity arrives in a thread the user participates in, the "Welcome
Back" digest can re-appear during an active session (observed re-showing on each incoming
thread reply, and re-showing immediately after dismissal while unacknowledged activity
persisted).

- **Pre-existing:** the Welcome Back eligibility logic predates Stage 1 (v63 Welcome Back /
  phase4b2 era). Stage 1 only relocated a `useState`/debug line with logic unchanged. **Not a
  Stage 1 regression.**
- **Impact:** non-blocking; a returning-visit digest can resurface mid-session and require an
  extra dismissal. No data effect.
- **Likely cause:** the eligibility effect in `src/index.jsx` re-qualifies because its
  dependencies include the live `threadNotes`/`featuredItems`, so `recapHasNewActivity`
  recomputes true on new activity.
- **Fix, when prioritized (isolated to Welcome Back eligibility):** gate the digest to
  once-per-session, or acknowledge thread activity on show. Out of scope for Stage 1.

### `window.__catsWBTrace` debug global ships in the production bundle (pre-existing)

The bundle includes `window.__catsWBTrace`, a `showWelcomeBack`-transition trace (booleans +
timestamps only).

- **Pre-existing**, non-sensitive (no PII), and **not part of Stage 1**.
- **Fix, when convenient:** remove the debug global in a narrow cleanup. (Deliberately NOT
  removed during Stage 1 closeout.)

### No safe connected fault-injection / trusted preview environment

There is no trusted preview or safe fault-injection environment to exercise, without risk to
production sessions/data:
- the live `connection.recovered` event (connection-recovery path),
- the forced thread-jump failure path,
- automated cross-origin iframe (Squarespace embed) validation.

These remained **unperformed** during Stage 1 connected validation and are **not** represented
as passed. **This is a validation-capability gap, not a current release blocker.** A dedicated
safe fault-injection / preview capability would close it; related to the absence of a
dev/sandbox Stream app noted above.

## Stage 2 — destination-change focus management and aria-live announcements (deferred; scheduled for closure in Stage 3's global shell/navigation slice)

`platformShell.jsx` explicitly deferred destination-change focus management and
aria-live announcements during Stage 2 Slice 5 ("a later, separately scoped concern").
This is accepted, intentional debt at the time it was written — the shell had exactly
two destinations and no collapsible sidebar.

Stage 3's global shell/navigation work is scoped to close this gap, not defer it to a
separate later hardening pass. Remove this entry once that slice ships and tests cover
destination-change focus management and aria-live behavior. Do not leave a stale
resolved entry behind.
