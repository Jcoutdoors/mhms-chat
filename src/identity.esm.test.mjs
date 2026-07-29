// Cross-runtime compatibility test (VIF Phase 1).
//
// Proves the canonical CommonJS module (src/identity.js) is consumable via ESM
// *named imports* — the interop that webpack (babel-loader), Cloudflare's esbuild
// bundler (used by wrangler for Pages Functions and Workers), and Node's native
// ESM loader all rely on. Complements src/identity.test.js (CJS require path).
//
// No network / Stream / Cloudflare / email / secrets. Run via `node --test`
// (included in the `test:identity` command). Exits nonzero on failure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, emailToUserId } from './identity.js'; // named imports from CJS
import vectors from './identityVectors.js'; // default import of CJS module.exports (the array)

test('[esm] named imports resolve to functions', () => {
  assert.equal(typeof normalizeEmail, 'function');
  assert.equal(typeof emailToUserId, 'function');
});

test('[esm] consumer reproduces every golden vector identically', async () => {
  for (const v of vectors) {
    assert.equal(normalizeEmail(v.input), v.normalized, `normalize: ${v.label}`);
    assert.equal(await emailToUserId(v.input), v.userId, `user id: ${v.label}`);
  }
});

test("[esm] Mark's documented production id via ESM named import", async () => {
  assert.equal(await emailToUserId('dr.mark.mayfield@gmail.com'), 'cats-8114d68476d8e833db5ac08a');
});
