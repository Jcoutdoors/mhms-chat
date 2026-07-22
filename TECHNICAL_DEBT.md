# Technical Debt

## v63 — ATLAS hero images are unoptimized for their display size

`atlas-hero-transparent.png` (1024x1024, ~1.6MB) and `atlas-hero-white.png` (1254x1254,
~1.2MB) are the original files as provided, used unaltered per explicit instruction not to
crop, recompress, resize, or otherwise modify the artwork without approval. Only the
transparent version is currently wired into the Welcome Back dialog, displayed at roughly
56-64px.

This means a user downloads a 1.6MB image to show something rendered at a few dozen pixels.
It's a real page-weight cost, particularly on mobile.

**Fix, when approved:** generate a properly-sized (e.g. 256x256 or smaller), compressed
version for actual use in the dialog, keeping the original file(s) as the source of truth
elsewhere if needed. This is a compression/resize task, not a redraw — the artwork itself
should not change.
