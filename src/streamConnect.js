// Verified-auth Stream connection helpers (VIF Phase 4B).
//
// The pre-4B path connected with the FULL client profile object (name, color,
// image, bio, link, instructor). Under verified identity that risks clobbering a
// returning user's server-side profile and treats a client-supplied `instructor`
// as truth. This module enforces the safe pattern:
//
//   1. Connect with the MINIMUM user object — ONLY the canonical `user_id` from
//      /token — so no profile field is sent at connect time.
//   2. Read the EXISTING Stream user after connect (for completeness routing),
//      distinguishing a bare user, an existing profile, a connection failure, and
//      a profile-read/access failure with TYPED results (never silently null).
//   3. Upsert profile fields ONLY on an intentional profile save, using the
//      AUTHORITATIVE user_id passed separately from the form data, stamping
//      `profile_version: 1`. `instructor` is NEVER written by this path.
//   4. Instructor for UI comes ONLY from the /token claim (in memory). This module
//      never reads Stream `instructor` as trusted and never writes it.
//
// Stream Chat's `connectUser(user, token)` UPSERTS the provided fields and is
// understood to MERGE (not delete unspecified custom fields). This module
// guarantees OUR side of that contract (we send only the id). The MERGE/no-clobber
// behavior of the live Stream backend is NOT proven by this module or its mock and
// remains a Phase 4B2 real-Stream validation requirement.
//
// CommonJS; the Stream client is injected so this is unit-testable without a real
// connection. No React, no localStorage, no token logging/persistence.

'use strict';

const { markProfileVersion } = require('./profileCompleteness.js');

// The minimal user object used at connect time: the canonical id and NOTHING else.
function minimalConnectUser(userId) {
  return { id: userId };
}

// Validate a canonical user id: a non-empty string. NOT derived or transformed
// here (identity derivation is server-side only). Whitespace-only is invalid.
function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') throw new Error('invalid_user_id');
  return userId;
}

// Connect the verified user and classify the outcome with a TYPED result — never
// a silent null. Distinguishes:
//   { ok:true, status:'existing_profile', user }  — connected, has a usable profile
//   { ok:true, status:'bare_user', user }         — connected, minimal/new user
//   { ok:false, error:'connect_failed' }          — connectUser threw
//   { ok:false, error:'profile_read_failed' }     — connected but reading the user threw / absent
// The 4B2 layer must route connect_failed/profile_read_failed to a service/retry
// state (NEVER to profile setup); only a genuine bare_user routes to setup.
async function connectVerified(client, userId, token) {
  if (!client || typeof client.connectUser !== 'function') throw new Error('invalid_stream_client');
  requireUserId(userId);
  try {
    await client.connectUser(minimalConnectUser(userId), token);
  } catch {
    return { ok: false, error: 'connect_failed' };
  }
  let user;
  try {
    user = readStreamProfile(client);
  } catch {
    return { ok: false, error: 'profile_read_failed' };
  }
  if (!user || typeof user !== 'object') {
    // Connected but the SDK exposed no user object — an access failure, not "new user".
    return { ok: false, error: 'profile_read_failed' };
  }
  const hasProfile = typeof user.name === 'string' && user.name.trim() !== '';
  const versioned = typeof user.profile_version === 'number' && user.profile_version >= 1;
  return { ok: true, status: hasProfile || versioned ? 'existing_profile' : 'bare_user', user };
}

// The connected Stream user, or throws only if the client itself is broken. Callers
// in connectVerified wrap this; direct callers get the raw value/exception.
function readStreamProfile(client) {
  return client && client.user ? client.user : null;
}

// Build the upsert payload for an intentional profile save. The AUTHORITATIVE
// `userId` is the ONLY source of `id` — `profileData.id` / `profileData.user_id`
// are ignored, so no form-controlled field can override the authenticated identity.
// Optional fields absent/empty are omitted (never null-wipe an existing value).
// `profile_version: 1` is always stamped. `instructor` is NEVER written by this path.
function buildProfileUpsert(userId, profileData) {
  requireUserId(userId);
  const src = profileData || {};
  const out = { id: userId }; // authoritative id only; src.id / src.user_id ignored
  for (const f of ['name', 'color', 'image', 'bio', 'link']) {
    if (src[f] !== undefined && src[f] !== null && src[f] !== '') out[f] = src[f];
  }
  // Deliberately NO instructor: it is not authoritative here and is never transmitted
  // by the verified-auth save path. Existing Stream instructor fields are left as-is
  // (not deleted/cleared) for rollback compatibility.
  return markProfileVersion(out); // -> stamps profile_version: 1
}

// Upsert the profile on intentional save using the authoritative user id (injected client).
async function saveProfile(client, userId, profileData) {
  if (!client || typeof client.upsertUser !== 'function') throw new Error('invalid_stream_client');
  const payload = buildProfileUpsert(userId, profileData);
  await client.upsertUser(payload);
  return payload;
}

// Disconnect the verified user (logout). Never throws to the caller.
async function disconnectVerified(client) {
  try { if (client && typeof client.disconnectUser === 'function') await client.disconnectUser(); }
  catch { /* best-effort */ }
}

module.exports = {
  minimalConnectUser, requireUserId, connectVerified, readStreamProfile,
  buildProfileUpsert, saveProfile, disconnectVerified,
};
