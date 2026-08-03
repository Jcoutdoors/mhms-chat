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
// completeness classification comes from the SHARED isProfileComplete predicate
test('connectVerified completeness uses shared predicate: version>=1 -> existing', async () => {
  const c = fakeClient({ 'cats-x': { id: 'cats-x', profile_version: 1 } });
  assert.equal((await connectVerified(c, 'cats-x', 'tok')).status, 'existing_profile');
});
test('connectVerified: trimmed non-empty legacy name -> existing; whitespace-only name -> bare', async () => {
  const named = fakeClient({ 'cats-a': { id: 'cats-a', name: 'Alex Rivera' } });
  assert.equal((await connectVerified(named, 'cats-a', 't')).status, 'existing_profile');
  const ws = fakeClient({ 'cats-b': { id: 'cats-b', name: '   ' } });
  assert.equal((await connectVerified(ws, 'cats-b', 't')).status, 'bare_user');
  const none = fakeClient({ 'cats-c': { id: 'cats-c' } });
  assert.equal((await connectVerified(none, 'cats-c', 't')).status, 'bare_user');
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
test('buildProfileUpsert: profile_version:1 numeric; clears present "" but omits absent fields', () => {
  // Matches production: bio/link are clearable via "" (present), image is absent (undefined) -> preserved.
  const p = buildProfileUpsert('cats-x', { name: 'A', color: '#123', bio: '', link: '' /* image, absent */ });
  assert.strictEqual(p.profile_version, 1);
  assert.equal(p.name, 'A'); assert.equal(p.color, '#123');
  assert.strictEqual(p.bio, '');   // intentional clear -> sent as "" (clears existing)
  assert.strictEqual(p.link, '');  // intentional clear -> sent as ""
  assert.equal('image' in p, false); // absent -> omitted (existing image preserved)
});
test('buildProfileUpsert: undefined/null fields are omitted (never erase existing data)', () => {
  const p = buildProfileUpsert('cats-x', { name: 'A', bio: undefined, link: null });
  assert.equal('bio' in p, false);
  assert.equal('link' in p, false);
});
test('buildProfileUpsert: prohibited fields excluded (id from arg only; no user_id/role/token/instructor)', () => {
  const p = buildProfileUpsert('cats-AUTH', { id: 'cats-EVIL', user_id: 'cats-X', role: 'admin', token: 'zzz', instructor: true, name: 'A' });
  assert.equal(p.id, 'cats-AUTH');
  for (const bad of ['user_id', 'role', 'token', 'instructor']) assert.equal(bad in p, false, bad);
  assert.deepEqual(Object.keys(p).sort(), ['id', 'name', 'profile_version']);
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
