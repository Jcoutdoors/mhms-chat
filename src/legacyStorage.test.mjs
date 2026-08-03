// legacyStorage tests (Phase 4B). Mocks globalThis.localStorage; deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_PROFILE_KEY, readLegacyUiHints, hasLegacyIdentity, clearLegacyIdentity,
} from './legacyStorage.js';

function mockStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
  return globalThis.localStorage;
}
function seedProfile(obj) { return mockStorage({ [LEGACY_PROFILE_KEY]: JSON.stringify(obj) }); }
test.afterEach(() => { delete globalThis.localStorage; });

const LEGACY = {
  id: 'cats-legacyid000000000000', email: 'someone@example.com', instructor: true,
  firstName: 'Sam', lastName: 'Rivera', color: '#3b73d8', bio: 'hi', link: 'x.com', welcomed: true,
};

test('readLegacyUiHints NEVER returns id/email/instructor; only UI hints', () => {
  seedProfile(LEGACY);
  const hints = readLegacyUiHints();
  assert.equal('id' in hints, false);
  assert.equal('email' in hints, false);
  assert.equal('instructor' in hints, false);
  assert.deepEqual(hints, { color: '#3b73d8', firstName: 'Sam', lastName: 'Rivera', bio: 'hi', link: 'x.com' });
});

test('readLegacyUiHints returns {} when absent or malformed', () => {
  mockStorage({});
  assert.deepEqual(readLegacyUiHints(), {});
  mockStorage({ [LEGACY_PROFILE_KEY]: '{not json' });
  assert.deepEqual(readLegacyUiHints(), {});
});

test('hasLegacyIdentity reports id/email/instructor presence (informational only)', () => {
  seedProfile(LEGACY);
  assert.equal(hasLegacyIdentity(), true);
  seedProfile({ color: '#123' });
  assert.equal(hasLegacyIdentity(), false);
});

test('clearLegacyIdentity strips id/email/instructor but PRESERVES ui hints (non-destructive)', () => {
  const store = seedProfile(LEGACY);
  const res = clearLegacyIdentity();
  assert.equal(res.cleared, true);
  const after = JSON.parse(store._map.get(LEGACY_PROFILE_KEY));
  assert.equal('id' in after, false);
  assert.equal('email' in after, false);
  assert.equal('instructor' in after, false);
  // UI-preference fields and the whole record are preserved (rollback-safe):
  assert.equal(after.color, '#3b73d8');
  assert.equal(after.firstName, 'Sam');
  assert.equal(after.welcomed, true);
});

test('clearLegacyIdentity is a no-op when nothing to strip / storage absent', () => {
  seedProfile({ color: '#123' });
  assert.equal(clearLegacyIdentity().cleared, false);
  delete globalThis.localStorage;
  assert.equal(clearLegacyIdentity().cleared, false); // no throw without localStorage
  assert.deepEqual(readLegacyUiHints(), {});
});
