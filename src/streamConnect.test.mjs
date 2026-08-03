// streamConnect tests (Phase 4B). Injected fake Stream client; no real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minimalConnectUser, connectVerified, readStreamProfile,
  buildProfileUpsert, saveProfile, disconnectVerified,
} from './streamConnect.js';

// Fake Stream client that simulates Stream's MERGE semantics: connectUser(user)
// merges the provided fields onto the stored server user for that id (unspecified
// fields preserved). Records the exact args it was called with.
function fakeClient(seedUsers = {}) {
  const store = { ...seedUsers };
  return {
    user: null,
    connectCalls: [],
    upsertCalls: [],
    disconnected: false,
    async connectUser(user, token) {
      this.connectCalls.push({ user, token });
      const existing = store[user.id] || { id: user.id };
      store[user.id] = { ...existing, ...user }; // merge (Stream does not delete unspecified fields)
      this.user = store[user.id];
    },
    async upsertUser(payload) { this.upsertCalls.push(payload); store[payload.id] = { ...(store[payload.id] || {}), ...payload }; this.user = store[payload.id]; },
    async disconnectUser() { this.disconnected = true; this.user = null; },
  };
}

test('minimalConnectUser returns ONLY the id (no profile fields)', () => {
  assert.deepEqual(minimalConnectUser('cats-x'), { id: 'cats-x' });
});

test('connectVerified sends only {id} and does NOT clobber an existing profile', async () => {
  // Returning user already has a rich server profile.
  const c = fakeClient({ 'cats-x': { id: 'cats-x', name: 'Existing Name', bio: 'hi', link: 'x.com', color: '#123', image: 'img', profile_version: 1, instructor: true } });
  const u = await connectVerified(c, 'cats-x', 'tok');
  // We sent ONLY the id:
  assert.deepEqual(c.connectCalls[0].user, { id: 'cats-x' });
  assert.equal(c.connectCalls[0].token, 'tok');
  // Existing custom fields are preserved (merge), proving no clobber from our side:
  assert.equal(u.name, 'Existing Name');
  assert.equal(u.bio, 'hi');
  assert.equal(u.profile_version, 1);
});

test('connectVerified for a brand-new id yields a bare user (routes to setup)', async () => {
  const c = fakeClient();
  const u = await connectVerified(c, 'cats-new', 'tok');
  assert.deepEqual(c.connectCalls[0].user, { id: 'cats-new' });
  assert.equal(u.name, undefined);
});

test('connectVerified rejects invalid client / user_id', async () => {
  await assert.rejects(() => connectVerified({}, 'cats-x', 't'), /invalid_stream_client/);
  await assert.rejects(() => connectVerified(fakeClient(), '', 't'), /invalid_user_id/);
});

test('readStreamProfile returns the connected user or null', async () => {
  const c = fakeClient();
  assert.equal(readStreamProfile(c), null);
  await connectVerified(c, 'cats-x', 't');
  assert.equal(readStreamProfile(c).id, 'cats-x');
});

test('buildProfileUpsert stamps profile_version:1, omits empty optionals, mirrors server instructor only when boolean', () => {
  const p = buildProfileUpsert({ id: 'cats-x', name: 'A', color: '#123', bio: '', link: undefined, image: null });
  assert.equal(p.profile_version, 1);
  assert.equal(p.name, 'A');
  assert.equal(p.color, '#123');
  assert.equal('bio' in p, false);   // empty string omitted (never wipes an existing value)
  assert.equal('link' in p, false);
  assert.equal('image' in p, false);
  assert.equal('instructor' in p, false); // not provided -> omitted
  const withInstr = buildProfileUpsert({ id: 'cats-x', name: 'A' }, { instructor: true });
  assert.equal(withInstr.instructor, true);
  const guessed = buildProfileUpsert({ id: 'cats-x', name: 'A' }, { instructor: 'true' });
  assert.equal('instructor' in guessed, false); // non-boolean server value ignored
});

test('saveProfile upserts the versioned payload on intentional save', async () => {
  const c = fakeClient({ 'cats-x': { id: 'cats-x', name: 'Old' } });
  const payload = await saveProfile(c, { id: 'cats-x', name: 'New Name', color: '#abc' });
  assert.equal(c.upsertCalls.length, 1);
  assert.equal(payload.profile_version, 1);
  assert.equal(c.user.name, 'New Name');
  assert.equal(c.user.color, '#abc');
});

test('disconnectVerified disconnects and never throws', async () => {
  const c = fakeClient(); await connectVerified(c, 'cats-x', 't');
  await disconnectVerified(c);
  assert.equal(c.disconnected, true);
  await disconnectVerified(null); // no throw
  await disconnectVerified({});   // no disconnectUser -> no throw
});
