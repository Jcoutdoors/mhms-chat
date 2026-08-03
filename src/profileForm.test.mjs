// profileForm tests (Phase 4B2). Pure, deterministic — proves the legacy-hint boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitName, profileFormInitial } from './profileForm.js';

const HINTS = { firstName: 'Legacy', lastName: 'Hint', bio: 'old bio', link: 'old.link', color: '#ff0000' };

test('splitName splits a display name into first/last', () => {
  assert.deepEqual(splitName('Sarah Johnson'), { firstName: 'Sarah', lastName: 'Johnson' });
  assert.deepEqual(splitName('Sarah De La Cruz'), { firstName: 'Sarah', lastName: 'De La Cruz' });
  assert.deepEqual(splitName('  Cher '), { firstName: 'Cher', lastName: '' });
  assert.deepEqual(splitName(''), { firstName: '', lastName: '' });
  assert.deepEqual(splitName(null), { firstName: '', lastName: '' });
});

test('EXISTING Stream profile uses Stream values ONLY — no legacy fallback for any field', () => {
  // Name present -> existing profile. bio/link/color/image ABSENT on Stream, hints present.
  const out = profileFormInitial({ id: 'cats-x', name: 'Alex Kim' }, HINTS);
  assert.equal(out.firstName, 'Alex');
  assert.equal(out.lastName, 'Kim');
  assert.equal(out.bio, '', 'absent Stream bio stays empty (no legacy bio)');
  assert.equal(out.link, '', 'absent Stream link stays empty (no legacy link)');
  assert.equal(out.color, undefined, 'absent Stream color stays default (no legacy color)');
  assert.equal(out.image, undefined, 'absent Stream image stays default (no legacy image)');
});

test('EXISTING profile keeps authoritative Stream field values (incl. an intentional empty string)', () => {
  const out = profileFormInitial({ id: 'cats-x', name: 'Alex Kim', bio: 'current bio', link: 'me.dev', color: '#123456', image: 'a.png' }, HINTS);
  assert.equal(out.bio, 'current bio');
  assert.equal(out.link, 'me.dev');
  assert.equal(out.color, '#123456');
  assert.equal(out.image, 'a.png');
  // An authoritative empty string is a real value (field cleared), NOT replaced by a hint.
  const cleared = profileFormInitial({ id: 'cats-x', name: 'Alex Kim', bio: '', link: '' }, HINTS);
  assert.equal(cleared.bio, '');
  assert.equal(cleared.link, '');
});

test('BARE first-time profile (no authoritative name) may pre-fill from legacy hints', () => {
  const out = profileFormInitial({ id: 'cats-x' }, HINTS);
  assert.equal(out.firstName, 'Legacy');
  assert.equal(out.lastName, 'Hint');
  assert.equal(out.bio, 'old bio');
  assert.equal(out.link, 'old.link');
  assert.equal(out.color, '#ff0000');
  assert.equal(out.image, undefined);
});

test('BARE profile with no hints -> everything empty/default', () => {
  const out = profileFormInitial({ id: 'cats-x' }, null);
  assert.deepEqual(out, { firstName: '', lastName: '', bio: '', link: '', color: undefined, image: undefined });
});

test('a whitespace-only name is treated as bare (hints allowed), not existing', () => {
  const out = profileFormInitial({ id: 'cats-x', name: '   ' }, HINTS);
  assert.equal(out.firstName, 'Legacy', 'whitespace name is not an authoritative profile');
});

test('saving cannot resurrect stale local values: existing edit yields no hint-derived fields', () => {
  // Simulate the render path: user edits an existing profile; the form is seeded here.
  const seed = profileFormInitial({ id: 'cats-x', name: 'Dana Lee' }, HINTS);
  // None of the legacy hint values leak into what the form would submit.
  for (const v of ['Legacy', 'Hint', 'old bio', 'old.link', '#ff0000']) {
    assert.equal(JSON.stringify(seed).includes(v), false, `stale hint "${v}" must not appear`);
  }
});
