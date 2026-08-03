// Legacy localStorage de-authorization (VIF Phase 4B).
//
// Before verified identity, the app trusted `localStorage.cats_profile` (holding a
// client-derived id, email, and an `instructor` flag) as the identity authority.
// After Phase 4B, localStorage is NEVER an identity/authorization source:
//   - identity (user_id) comes only from POST /token
//   - instructor comes only from the /token claim
//   - profile DATA comes only from Stream
//   - authentication comes only from the __Host session cookie
//
// This module is STRICTLY READ-ONLY. It exposes ONLY non-authoritative UI hints
// from any legacy blob (never id/email/instructor) and an informational check of
// whether legacy identity exists. It NEVER writes to localStorage — the complete
// `cats_profile` record is left byte-for-byte unchanged so that a rollback to the
// current production bundle (which may still require the legacy identity fields)
// remains fully functional. Any actual cleanup is deferred until after the Phase 4
// cutover is stable and is out of scope for Phase 4B.
//
// Pure-ish CommonJS: guarded (never-throwing) localStorage READS only; no writes,
// no network, no React.

'use strict';

const LEGACY_PROFILE_KEY = 'cats_profile';

function safeParse(raw) {
  try { return JSON.parse(raw || 'null'); } catch { return null; }
}
function getStore() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
// Guarded READ: a throwing getItem (e.g. SecurityError in a locked-down or private
// context) must never propagate to application startup or logout.
function safeGet(store, key) {
  try { return store ? store.getItem(key) : null; } catch { return null; }
}

// Read ONLY non-authoritative UI hints from a legacy blob (e.g. a previously chosen
// avatar color or name parts) — NEVER id, email, or instructor. Returns {} if
// absent/malformed/unreadable. These hints may pre-fill the profile-setup form but
// never decide identity, privilege, or new-vs-returning routing. Does not mutate.
function readLegacyUiHints() {
  const blob = safeParse(safeGet(getStore(), LEGACY_PROFILE_KEY));
  if (!blob || typeof blob !== 'object') return {};
  const hints = {};
  if (typeof blob.color === 'string') hints.color = blob.color;
  if (typeof blob.firstName === 'string') hints.firstName = blob.firstName;
  if (typeof blob.lastName === 'string') hints.lastName = blob.lastName;
  if (typeof blob.bio === 'string') hints.bio = blob.bio;
  if (typeof blob.link === 'string') hints.link = blob.link;
  return hints; // deliberately NO id / email / instructor
}

// Informational only: true iff a legacy identity-bearing field is present. Does not
// mutate. Callers must NOT treat this as authority — it exists so diagnostics/UX can
// note that pre-4B data exists; identity/instructor always come from /token.
function hasLegacyIdentity() {
  const blob = safeParse(safeGet(getStore(), LEGACY_PROFILE_KEY));
  return !!(blob && typeof blob === 'object' && (blob.id || blob.email || 'instructor' in blob));
}

module.exports = {
  LEGACY_PROFILE_KEY,
  readLegacyUiHints,
  hasLegacyIdentity,
};
