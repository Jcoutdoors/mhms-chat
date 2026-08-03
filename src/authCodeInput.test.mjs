// Verification-code normalization tests (Phase 4B). Pure; no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCode, CODE_LENGTH } from './authCodeInput.js';

test('CODE_LENGTH is 6', () => assert.equal(CODE_LENGTH, 6));

test('leading-zero input stays a six-character STRING (never numeric-coerced)', () => {
  assert.strictEqual(normalizeCode('012345'), '012345');
  assert.strictEqual(normalizeCode('000000'), '000000');
  assert.equal(typeof normalizeCode('012345'), 'string');
});

test('non-digits are stripped', () => {
  assert.equal(normalizeCode('12ab34'), '1234');
  assert.equal(normalizeCode(' 1 2-3 '), '123');
  assert.equal(normalizeCode('abcdef'), '');
});

test('more than six digits are truncated to six', () => {
  assert.equal(normalizeCode('1234567890'), '123456');
  assert.equal(normalizeCode('0000001'), '000000'); // keeps the first six (leading zeros)
});

test('nullish / non-string input -> empty string', () => {
  assert.equal(normalizeCode(undefined), '');
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode(12), '12');
});
