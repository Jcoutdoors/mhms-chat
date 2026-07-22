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
   identity. Unchanged by this work, and deliberately out of scope.

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
