// Verified-auth Stream connection helpers (VIF Phase 4B).
//
// The pre-4B path connected with the FULL client profile object (name, color,
// image, bio, link, instructor). Under verified identity that risks clobbering a
// returning user's server-side profile and treats a client-supplied `instructor`
// as truth. This module enforces the safe pattern:
//
//   1. Connect with the MINIMUM user object — ONLY the canonical `user_id` from
//      /token — so no profile field is sent at connect time.
//   2. Read the EXISTING Stream user after connect (for completeness routing).
//   3. Upsert profile fields ONLY on an intentional profile save, stamping
//      `profile_version: 1`.
//   4. Instructor for UI comes ONLY from the /token claim (never from Stream or
//      localStorage). It may be mirrored onto the Stream user on save for display,
//      but is never read back as the trusted source.
//
// Stream Chat's `connectUser(user, token)` UPSERTS the provided fields and MERGES
// (it does not delete unspecified custom fields), so connecting with `{ id }` only
// preserves existing name/bio/link/color/image. This module guarantees OUR side of
// that contract (we send only the id); a live end-to-end confirmation belongs to
// the Phase 4C cutover validation.
//
// CommonJS; the Stream client is injected so this is unit-testable without a real
// connection. No React, no localStorage.

'use strict';

const { markProfileVersion } = require('./profileCompleteness.js');

// The minimal user object used at connect time: the canonical id and NOTHING else.
function minimalConnectUser(userId) {
  return { id: userId };
}

// Connect the verified user. `client` is a Stream client (injected). `userId` is
// the canonical /token user_id; `token` is the /token Stream token. Returns the
// connected Stream user (with its existing server-side fields preserved).
async function connectVerified(client, userId, token) {
  if (!client || typeof client.connectUser !== 'function') throw new Error('invalid_stream_client');
  if (typeof userId !== 'string' || !userId) throw new Error('invalid_user_id');
  await client.connectUser(minimalConnectUser(userId), token);
  return readStreamProfile(client);
}

// The existing Stream user after connect, used for profile-completeness routing.
function readStreamProfile(client) {
  return client && client.user ? client.user : null;
}

// Fields the app is allowed to write on an intentional profile save. Optional
// fields absent from `profileData` are simply omitted (not nulled), so a partial
// save never wipes an existing value. `profile_version: 1` is always stamped.
// `opts.instructor` (a SERVER-derived boolean from /token) is mirrored for display
// only when explicitly provided — never guessed client-side.
function buildProfileUpsert(profileData, opts = {}) {
  const src = profileData || {};
  const out = { id: src.id };
  for (const f of ['name', 'color', 'image', 'bio', 'link']) {
    if (src[f] !== undefined && src[f] !== null && src[f] !== '') out[f] = src[f];
  }
  if (typeof opts.instructor === 'boolean') out.instructor = opts.instructor;
  return markProfileVersion(out); // -> stamps profile_version: 1
}

// Upsert the profile on intentional save (injected client).
async function saveProfile(client, profileData, opts = {}) {
  if (!client || typeof client.upsertUser !== 'function') throw new Error('invalid_stream_client');
  const payload = buildProfileUpsert(profileData, opts);
  await client.upsertUser(payload);
  return payload;
}

// Disconnect the verified user (logout). Never throws to the caller.
async function disconnectVerified(client) {
  try { if (client && typeof client.disconnectUser === 'function') await client.disconnectUser(); }
  catch { /* best-effort */ }
}

module.exports = {
  minimalConnectUser, connectVerified, readStreamProfile,
  buildProfileUpsert, saveProfile, disconnectVerified,
};
