// streamConnect tests (Phase 4B, corrected). Injected fake Stream client; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minimalConnectUser, requireUserId, connectVerified, readStreamProfile,
  buildProfileUpsert, saveProfile, disconnectVerified,
} from './streamConnect.js';

// Fake client simulating Stream MERGE semantics; records connect/upsert args.
function fakeClient(seedUsers = {}, opts = {}) {
  const store = { ...seedUsers };
  return {
    user: null,
    connectCalls: [], upsertCalls: [], disconnected: false,
    async connectUser(user, token) {
      if (opts.connectThrows) throw new Error('connect boom');
      this.connectCalls.push({ user, token });
      if (opts.leaveUserNull) { this.user = null; return; } // connected but no user object
      const existing = store[user.id] || { id: user.id };
      store[user.id] = { ...existing, ...user }; // merge (unspecified fields preserved)
      this.user = store[user.id];
    },
    async upsertUser(payload) { if (opts.upsertThrows) throw new Error('upsert boom'); this.upsertCalls.push(payload); store[payload.id] = { ...(store[payload.id] || {}), ...payload }; this.user = store[payload.id]; },
    async disconnectUser() { if (opts.disconnectThrows) throw new Error('disc boom'); this.disconnected = true; this.user = null; },
  };
}

test('minimalConnectUser returns ONLY the id', () => {
  assert.deepEqual(minimalConnectUser('cats-x'), { id: 'cats-x' });
});

test('requireUserId: non-empty string only', () => {
  assert.equal(requireUserId('cats-x'), 'cats-x');
  for (const v of ['', '   ', null, undefined, 42, {}]) assert.throws(() => requireUserId(v), /invalid_user_id/);
});

// ---- connectVerified typed outcomes (the 4 conditions) ----
test('connectVerified: existing profile -> {ok:true, existing_profile}; sends only {id}; no clobber', async () => {
  const c = fakeClient({ 'cats-x': { id: 'cats-x', name: 'Existing Name', bio: 'hi', profile_version: 1 } });
  const r = await connectVerified(c, 'cats-x', 'tok');
  assert.deepEqual(c.connectCalls[0].user, { id: 'cats-x' });
  assert.equal(r.ok, true); assert.equal(r.status, 'existing_profile');
  assert.equal(r.user.name, 'Existing Name'); assert.equal(r.user.bio, 'hi'); // preserved
});
test('connectVerified: bare user -> {ok:true, bare_user}', async () => {
  const c = fakeClient();
  const r = await connectVerified(c, 'cats-new', 'tok');
  assert.equal(r.ok, true); assert.equal(r.status, 'bare_user');
});
test('connectVerified: version>=1 with no name still counts as existing_profile', async () => {
  const c = fakeClient({ 'cats-x': { id: 'cats-x', profile_version: 1 } });
  assert.equal((await connectVerified(c, 'cats-x', 'tok')).status, 'existing_profile');
});
test('connectVerified: connection failure -> {ok:false, connect_failed} (NOT setup)', async () => {
  const c = fakeClient({}, { connectThrows: true });
  const r = await connectVerified(c, 'cats-x', 'tok');
  assert.deepEqual(r, { ok: false, error: 'connect_failed' });
});
test('connectVerified: connected but no readable user -> {ok:false, profile_read_failed}', async () => {
  const c = fakeClient({}, { leaveUserNull: true });
  const r = await connectVerified(c, 'cats-x', 'tok');
  assert.deepEqual(r, { ok: false, error: 'profile_read_failed' });
});
test('connectVerified: reading the user throws -> {ok:false, profile_read_failed}', async () => {
  const c = { connectCalls: [], async connectUser(u) { this.connectCalls.push({ u }); }, get user() { throw new Error('read boom'); } };
  const r = await connectVerified(c, 'cats-x', 'tok');
  assert.deepEqual(r, { ok: false, error: 'profile_read_failed' });
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

// ---- buildProfileUpsert: authoritative id, no instructor ----
test('buildProfileUpsert: authenticated userId is the ONLY source of id', () => {
  const p = buildProfileUpsert('cats-AUTH', { id: 'cats-EVIL', user_id: 'cats-EVIL2', name: 'A' });
  assert.equal(p.id, 'cats-AUTH');       // form-supplied id/user_id ignored
});
test('buildProfileUpsert: profileData.user_id cannot override', () => {
  assert.equal(buildProfileUpsert('cats-AUTH', { user_id: 'cats-X' }).id, 'cats-AUTH');
});
test('buildProfileUpsert: missing/empty userId rejected', () => {
  assert.throws(() => buildProfileUpsert('', { name: 'A' }), /invalid_user_id/);
  assert.throws(() => buildProfileUpsert(undefined, { name: 'A' }), /invalid_user_id/);
});
test('buildProfileUpsert: profile_version:1 (numeric); empty optionals omitted', () => {
  const p = buildProfileUpsert('cats-x', { name: 'A', color: '#123', bio: '', link: undefined, image: null });
  assert.strictEqual(p.profile_version, 1);
  assert.equal(p.name, 'A'); assert.equal(p.color, '#123');
  for (const f of ['bio', 'link', 'image']) assert.equal(f in p, false);
});
test('buildProfileUpsert: NO instructor key is ever produced (form or otherwise)', () => {
  const p = buildProfileUpsert('cats-x', { name: 'A', instructor: true });
  assert.equal('instructor' in p, false);         // profileData.instructor ignored
  assert.deepEqual(Object.keys(p).sort(), ['color', 'id', 'name', 'profile_version'].filter((k) => k in p).sort());
  assert.equal('instructor' in buildProfileUpsert('cats-x', {}), false);
});

test('saveProfile: upserts the authoritative versioned payload, no instructor', async () => {
  const c = fakeClient({ 'cats-x': { id: 'cats-x', name: 'Old', instructor: true } });
  const payload = await saveProfile(c, 'cats-x', { id: 'cats-EVIL', name: 'New Name', instructor: true });
  assert.equal(c.upsertCalls.length, 1);
  assert.equal(payload.id, 'cats-x');
  assert.equal('instructor' in payload, false);   // not transmitted
  assert.equal('instructor' in c.upsertCalls[0], false);
  assert.equal(payload.profile_version, 1);
  // existing Stream instructor field is left as-is (not deleted by our upsert merge)
  assert.equal(c.user.instructor, true);
});
test('saveProfile rejects invalid client / userId', async () => {
  await assert.rejects(() => saveProfile({}, 'cats-x', {}), /invalid_stream_client/);
  await assert.rejects(() => saveProfile(fakeClient(), '', {}), /invalid_user_id/);
});

test('disconnectVerified disconnects and never throws (even on failure)', async () => {
  const c = fakeClient(); await connectVerified(c, 'cats-x', 't');
  await disconnectVerified(c); assert.equal(c.disconnected, true);
  await disconnectVerified(fakeClient({}, { disconnectThrows: true })); // no throw
  await disconnectVerified(null); await disconnectVerified({});
});
