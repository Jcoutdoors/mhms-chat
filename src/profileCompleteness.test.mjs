// profileCompleteness tests (Phase 4A1). Deterministic; no network/DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_VERSION, isProfileComplete, markProfileVersion, hasNonEmptyName } from './profileCompleteness.js';

test('profile_version >= 1 => complete (regardless of name)', () => {
  assert.equal(isProfileComplete({ profile_version: 1 }), true);
  assert.equal(isProfileComplete({ profile_version: 2, name: '' }), true);
});

test('legacy user with non-empty trimmed name => complete', () => {
  assert.equal(isProfileComplete({ name: 'Alex Rivera' }), true);
  assert.equal(isProfileComplete({ name: '  Sam  ' }), true);
});

test('missing/empty/whitespace name and no version => incomplete (route to setup)', () => {
  assert.equal(isProfileComplete({ name: '' }), false);
  assert.equal(isProfileComplete({ name: '   ' }), false);
  assert.equal(isProfileComplete({ bio: 'hi', link: 'x', color: '#fff' }), false); // no name
  assert.equal(isProfileComplete({}), false);
});

test('partial profile (name present, optional fields missing) => complete', () => {
  assert.equal(isProfileComplete({ name: 'Jo' }), true); // no bio/link/image/color
});

test('malformed / non-object user => incomplete (fail closed)', () => {
  for (const bad of [null, undefined, 42, 'nope', [], { name: 123 }, { profile_version: 'x' }]) {
    assert.equal(isProfileComplete(bad), false, `malformed: ${JSON.stringify(bad)}`);
  }
});

test('profile_version below 1 falls through to name inference', () => {
  assert.equal(isProfileComplete({ profile_version: 0, name: 'Has Name' }), true);
  assert.equal(isProfileComplete({ profile_version: 0, name: '' }), false);
});

test('markProfileVersion stamps version 1 without mutating input', () => {
  const input = { name: 'Jo', bio: 'x' };
  const out = markProfileVersion(input);
  assert.equal(out.profile_version, PROFILE_VERSION);
  assert.equal(out.name, 'Jo');
  assert.equal('profile_version' in input, false, 'input not mutated');
});

test('hasNonEmptyName helper', () => {
  assert.equal(hasNonEmptyName('a'), true);
  assert.equal(hasNonEmptyName('   '), false);
  assert.equal(hasNonEmptyName(0), false);
  assert.equal(PROFILE_VERSION, 1);
});
