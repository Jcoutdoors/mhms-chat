// ProfileForm initial-values helper (VIF Phase 4B2). Pure, node-testable.
//
// LEGACY-HINT BOUNDARY: the legacy `cats_profile` UI hints are used ONLY to pre-fill a
// genuinely bare / first-time profile (one with no authoritative Stream name yet). For an
// EXISTING Stream profile — anyone who has set up before, i.e. has an authoritative name —
// Stream values are the sole source of truth: legacy hints are ignored entirely, and any
// field absent on the Stream profile stays empty/default. This guarantees that editing an
// existing profile can never resurrect stale local values (name/bio/link/color/image), and
// that a subsequent save writes only Stream-derived values plus the user's edits.

'use strict';

// Split a Stream display name back into first/last for pre-filling the form.
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
}

// Build ProfileForm initial values from the authoritative Stream profile (`user`).
// `legacyHints` (the non-authoritative cats_profile UI hints) is consulted ONLY when the
// profile is bare (no authoritative name) — for an existing profile it is ignored.
function profileFormInitial(user, legacyHints) {
  const u = user || {};
  const existing = !!(u.name && String(u.name).trim()); // has an authoritative Stream profile
  const h = existing ? {} : (legacyHints || {});         // hints ONLY for a bare first-time profile
  const named = splitName(u.name);
  return {
    firstName: named.firstName || h.firstName || '',
    lastName: named.lastName || h.lastName || '',
    // `!= null` keeps an authoritative empty string ('' clears a field) distinct from an
    // absent field; absent + existing -> '' (never a stale hint).
    bio: u.bio != null ? u.bio : (h.bio || ''),
    link: u.link != null ? u.link : (h.link || ''),
    color: u.color || h.color || undefined,
    image: u.image,
  };
}

module.exports = { splitName, profileFormInitial };
