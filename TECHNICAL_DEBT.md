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
