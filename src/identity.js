// Canonical deterministic Stream identity specification (VIF Phase 1).
//
// This is the SINGLE SOURCE OF TRUTH for how an email becomes a Stream user ID.
// The chat application (browser), the future authentication service (Cloudflare
// Workers/Pages Functions), and the tests must all follow exactly this behavior.
//
// The algorithm is INTENTIONALLY minimal and must not change — any change forks
// every existing identity away from its current Stream user ID, profile, and
// message history. The golden vectors in ./identityVectors.js are a release
// invariant that locks this behavior (including Mark's live production ID).
//
// Deliberately NOT performed (would change existing identities):
//   - Gmail dot removal
//   - plus-address ("+tag") stripping
//   - Unicode normalization beyond what is already present (none)
//   - provider-specific canonicalization / alias consolidation
//   - domain-specific behavior
//
// One physical CommonJS module (like channelConfig.js / featuredUpdates.js),
// imported unchanged by every intended environment (all demonstrated by the
// cross-runtime tests + a local esbuild bundle proof — see PROJECT_KNOWLEDGE.md):
//   - Node's test runner        via require()                  [src/identity.test.js]
//   - the webpack app           via `import { ... }`           (babel-loader CJS interop)
//   - Cloudflare Pages Functions / Workers via `import { ... }` — wrangler bundles them
//        with esbuild, which resolves the CJS named exports    (NOT raw-CJS at runtime)
//   - Node's native ESM loader  via `import { ... }`           [src/identity.esm.test.mjs]
// The runtime primitives used (`crypto.subtle`, `TextEncoder`) are globals in
// browsers, Cloudflare Workers, and Node 20+, so no per-environment code path is
// needed. This module's exports and algorithm are identical across all of them.

'use strict';

// Step 1-3: coerce falsy to empty string, trim surrounding whitespace, lowercase.
// Preserved byte-for-byte from the production implementation (src/index.jsx).
function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

// Steps 4-8: UTF-8 encode -> SHA-256 -> lowercase hex -> first 24 chars -> prefix.
// Async because Web Crypto's digest is Promise-based in every target runtime.
async function emailToUserId(email) {
  const norm = normalizeEmail(email);
  const bytes = new TextEncoder().encode(norm);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return 'cats-' + hex.slice(0, 24);
}

module.exports = { normalizeEmail, emailToUserId };
