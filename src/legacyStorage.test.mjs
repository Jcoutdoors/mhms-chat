// legacyStorage tests (Phase 4B, final). Read-only, non-mutating. Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_PROFILE_KEY, readLegacyUiHints, hasLegacyIdentity } from './legacyStorage.js';

// A recording storage mock. `writes` counts any setItem/removeItem attempts so we can
// prove the Phase 4B helper NEVER writes. Getters can be made to throw a SecurityError.
function makeStorage({ getThrows = false } = {}) {
  const m = new Map();
  const writes = [];
  const store = {
    _map: m, writes,
    getItem(k) { if (getThrows) { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; throw e; } return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { writes.push(['set', k]); m.set(k, String(v)); },
    removeItem(k) { writes.push(['remove', k]); m.delete(k); },
  };
  globalThis.localStorage = store;
  return store;
}
function seed(obj) { const s = makeStorage(); s._map.set(LEGACY_PROFILE_KEY, JSON.stringify(obj)); return s; }
test.afterEach(() => { delete globalThis.localStorage; });

const LEGACY = {
  id: 'cats-legacyid000000000000', email: 'someone@example.com', instructor: true,
  firstName: 'Sam', lastName: 'Rivera', color: '#3b73d8', bio: 'hi', link: 'x.com', welcomed: true,
};

test('readLegacyUiHints returns ONLY UI hints; never id/email/instructor', () => {
  seed(LEGACY);
  const h = readLegacyUiHints();
  for (const k of ['id', 'email', 'instructor']) assert.equal(k in h, false, k);
  assert.deepEqual(h, { color: '#3b73d8', firstName: 'Sam', lastName: 'Rivera', bio: 'hi', link: 'x.com' });
});

test('reads NEVER mutate storage; the full legacy blob is byte-for-byte unchanged', () => {
  const s = seed(LEGACY);
  const before = s._map.get(LEGACY_PROFILE_KEY);
  readLegacyUiHints(); hasLegacyIdentity(); readLegacyUiHints();
  assert.equal(s._map.get(LEGACY_PROFILE_KEY), before, 'stored blob unchanged');
  assert.deepEqual(s.writes, [], 'no setItem/removeItem attempted'); // rollback data intact
});

test('hasLegacyIdentity is informational (present vs absent), non-mutating', () => {
  const s = seed(LEGACY);
  assert.equal(hasLegacyIdentity(), true);
  assert.deepEqual(s.writes, []);
  seed({ color: '#123' });
  assert.equal(hasLegacyIdentity(), false);
});

test('absent / malformed record -> {} / false, no writes', () => {
  const s = makeStorage();
  assert.deepEqual(readLegacyUiHints(), {});
  assert.equal(hasLegacyIdentity(), false);
  s._map.set(LEGACY_PROFILE_KEY, '{not json');
  assert.deepEqual(readLegacyUiHints(), {});
  assert.deepEqual(s.writes, []);
});

test('SecurityError from getItem -> safe defaults; nothing propagates; no writes', () => {
  const s = makeStorage({ getThrows: true });
  assert.doesNotThrow(() => { assert.deepEqual(readLegacyUiHints(), {}); });
  assert.doesNotThrow(() => { assert.equal(hasLegacyIdentity(), false); });
  assert.deepEqual(s.writes, []);
});

test('unavailable localStorage -> safe defaults, no throw', () => {
  delete globalThis.localStorage;
  assert.deepEqual(readLegacyUiHints(), {});
  assert.equal(hasLegacyIdentity(), false);
});
