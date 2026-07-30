// Re-export the CANONICAL identity implementation from Phase 1 (src/identity.js).
// One physical module; esbuild inlines it into the Functions bundle at build/deploy.
// The server derives Stream IDs byte-identically to the app, preserving all
// existing Stream history for returning users.
export { normalizeEmail, emailToUserId } from '../../../../src/identity.js';
