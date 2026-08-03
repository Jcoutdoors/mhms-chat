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
// This module centralizes that boundary: it exposes ONLY non-authoritative UI
// hints from any legacy blob, never id/email/instructor, and provides a lazy,
// non-destructive cleanup of the identity-bearing fields. It does not delete the
// whole record (rollback compatibility): the pre-Phase-4B app may still read it.
//
// Pure-ish CommonJS: guarded localStorage access; no network, no React.

'use strict';

const LEGACY_PROFILE_KEY = 'cats_profile';
// Fields that were identity/authorization-bearing and must be ignored post-4B.
const NON_AUTHORITATIVE_STRIP = ['id', 'email', 'instructor'];

function safeParse(raw) {
  try { return JSON.parse(raw || 'null'); } catch { return null; }
}
function getStore() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

// Read ONLY non-authoritative UI hints from a legacy blob (e.g. a previously
// chosen avatar color) — NEVER id, email, or instructor. Returns {} if absent.
// These hints may pre-fill the profile-setup form but never decide identity,
// privilege, or new-vs-returning routing.
function readLegacyUiHints() {
  const store = getStore();
  const blob = store ? safeParse(store.getItem(LEGACY_PROFILE_KEY)) : null;
  if (!blob || typeof blob !== 'object') return {};
  const hints = {};
  if (typeof blob.color === 'string') hints.color = blob.color;
  if (typeof blob.firstName === 'string') hints.firstName = blob.firstName;
  if (typeof blob.lastName === 'string') hints.lastName = blob.lastName;
  if (typeof blob.bio === 'string') hints.bio = blob.bio;
  if (typeof blob.link === 'string') hints.link = blob.link;
  return hints; // deliberately NO id / email / instructor
}

// True iff a legacy identity-bearing field is present (informational only).
function hasLegacyIdentity() {
  const store = getStore();
  const blob = store ? safeParse(store.getItem(LEGACY_PROFILE_KEY)) : null;
  return !!(blob && typeof blob === 'object' && (blob.id || blob.email || 'instructor' in blob));
}

// Lazily strip the identity/authorization-bearing fields from the legacy blob,
// preserving any non-authoritative UI hints. NON-destructive: keeps the record
// (minus id/email/instructor) so nothing important is lost and rollback is safe.
// Never throws.
function clearLegacyIdentity() {
  const store = getStore();
  if (!store) return { cleared: false };
  const blob = safeParse(store.getItem(LEGACY_PROFILE_KEY));
  if (!blob || typeof blob !== 'object') return { cleared: false };
  let changed = false;
  for (const f of NON_AUTHORITATIVE_STRIP) {
    if (f in blob) { delete blob[f]; changed = true; }
  }
  if (changed) { try { store.setItem(LEGACY_PROFILE_KEY, JSON.stringify(blob)); } catch { /* ignore */ } }
  return { cleared: changed };
}

module.exports = {
  LEGACY_PROFILE_KEY,
  NON_AUTHORITATIVE_STRIP,
  readLegacyUiHints,
  hasLegacyIdentity,
  clearLegacyIdentity,
};
