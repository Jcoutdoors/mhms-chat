// Profile-completeness predicate (VIF Phase 4A1).
//
// Decides whether a verified Stream identity already has a usable profile, so
// the onboarding flow can route a verified user into the community vs. into
// profile setup — WITHOUT relying on localStorage or any browser-supplied state.
// The input is the Stream user object returned by the server after connecting
// with { id } (never client-authored routing state).
//
// Product-owner rule (Phase 4):
//   - profile_version >= 1                         => complete
//   - otherwise a legacy user with non-empty name  => complete (no migration)
//   - missing/empty name                           => incomplete (route to setup)
//   - missing optional bio/link/image/color        => does NOT make it incomplete
//   - malformed / non-object user                  => incomplete (fail closed)
//
// `profile_version: 1` is written ONLY during an intentional profile save
// (see markProfileVersion). No bulk migration; legacy users are inferred.
//
// CommonJS like identity.js / channelConfig.js so Node's test runner (require or
// ESM named import) and webpack (babel-loader CJS interop) all consume it
// unchanged. Pure: no I/O, no globals, no React.

'use strict';

// Current explicit profile marker. A profile saved by Phase 4 carries this.
const PROFILE_VERSION = 1;

// True iff `value` is a non-empty string once trimmed.
function hasNonEmptyName(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Coerce an unknown profile_version to a finite number, else NaN.
function readVersion(user) {
  const v = user.profile_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

// Reliable completeness decision. Never throws for malformed input.
function isProfileComplete(user) {
  if (!user || typeof user !== 'object') return false; // malformed -> fail closed
  const version = readVersion(user);
  if (!Number.isNaN(version) && version >= PROFILE_VERSION) return true; // explicit marker
  return hasNonEmptyName(user.name); // legacy compatibility inference
}

// Returns a shallow copy of `profileData` stamped with the current profile
// version. Used at intentional save time; callers persist the result to Stream.
// Does not mutate the input.
function markProfileVersion(profileData) {
  return Object.assign({}, profileData, { profile_version: PROFILE_VERSION });
}

module.exports = { PROFILE_VERSION, isProfileComplete, markProfileVersion, hasNonEmptyName };
