// Deterministic identity tests (VIF Phase 1). Node built-in test runner only.
// No network, no Stream, no Cloudflare, no email, no secrets. Run with:
//   node --test src/identity.test.js
// Exits nonzero on any failure (suitable for CI).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, emailToUserId } = require('./identity.js');
const vectors = require('./identityVectors.js');

// Independent full SHA-256 over the normalized UTF-8 bytes, so the test does not
// merely trust the module — it recomputes the digest and proves the ID is
// exactly `cats-` + first 24 hex chars of that digest.
async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

test('every golden vector: normalization, full digest, and Stream user ID', async () => {
  for (const v of vectors) {
    assert.equal(normalizeEmail(v.input), v.normalized, `normalize: ${v.label}`);

    const digest = await sha256Hex(v.normalized);
    assert.equal(digest, v.sha256, `full sha256: ${v.label}`);

    const id = await emailToUserId(v.input);
    assert.equal(id, v.userId, `user id: ${v.label}`);

    // Proves ONLY the first 24 hex chars are used, and the prefix is exactly `cats-`.
    assert.equal(id, 'cats-' + digest.slice(0, 24), `id == cats- + first24(digest): ${v.label}`);
    assert.ok(id.startsWith('cats-'), `cats- prefix: ${v.label}`);
    assert.equal(id.length, 5 + 24, `id length = len('cats-') + 24: ${v.label}`);
  }
});

test('case and whitespace variants collapse to the SAME id', async () => {
  const variants = ['person@example.com', 'PERSON@EXAMPLE.COM', '  person@example.com  ', 'Person@Example.Com'];
  const ids = await Promise.all(variants.map(emailToUserId));
  for (const id of ids) {
    assert.equal(id, 'cats-542d240129883c019e106e3b');
  }
});

test('plus-address is a DISTINCT identity from the base address', async () => {
  const base = await emailToUserId('person@example.com');
  const plus = await emailToUserId('person+tag@example.com');
  assert.notEqual(plus, base);
  assert.equal(plus, 'cats-656278d7f8246848775c3a62');
});

test('subdomain is a DISTINCT identity from the base address', async () => {
  const base = await emailToUserId('person@example.com');
  const sub = await emailToUserId('person@mail.example.com');
  assert.notEqual(sub, base);
  assert.equal(sub, 'cats-db581e8d2a95531ff2dcd06c');
});

test("Mark's documented production Stream ID is unchanged", async () => {
  assert.equal(await emailToUserId('dr.mark.mayfield@gmail.com'), 'cats-8114d68476d8e833db5ac08a');
});

test('normalizeEmail handles empty / nullish input as empty string', () => {
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
});
