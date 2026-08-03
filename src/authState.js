// Onboarding / verified-auth state machine (VIF Phase 4A1).
//
// A PURE, framework-free description of the onboarding flow. It has no React
// dependency and performs no I/O — the UI layer (Phase 4B) drives it by sending
// events and rendering the current state. Modeling it here keeps the transitions
// reviewable and unit-testable in isolation from rendering.
//
// The machine stores NO payload — only a state string. It never holds an email
// or a verification code; those live in the UI layer, which must clear them on
// LOGOUT (a Phase 4B responsibility). This boundary is intentional.
//
// GLOBAL SAFETY EVENTS + PRECEDENCE:
//   - LOGOUT is accepted from EVERY state except `booting` and always returns
//     `entryChoice`.
//   - SESSION_EXPIRED is accepted from every state where a verified/authenticated
//     session may exist (authenticating, loadingProfile, profileSetup,
//     savingProfile, community) and returns `sessionExpired`.
//   Global safety events are evaluated BEFORE the per-state table: a state can
//   neither override nor suppress LOGOUT/SESSION_EXPIRED. This guarantees that a
//   logout (or expiry) issued during any transient state — verifying,
//   authenticating, savingProfile — cannot be "outrun" by a late async success
//   event, because after LOGOUT the machine is in `entryChoice`, from which
//   stale success events (VERIFY_OK/TOKEN_OK/SAVE_OK/PROFILE_COMPLETE) are no-ops.
//
// Invalid transitions are explicit and non-throwing: an event not valid for the
// current state leaves the state unchanged and reports changed:false.
//
// Pure CommonJS: consumed by Node tests and (Phase 4B) webpack unchanged.

'use strict';

const INITIAL_STATE = 'booting';

const STATES = Object.freeze({
  BOOTING: 'booting',
  CHECKING_SESSION: 'checkingSession',
  ENTRY_CHOICE: 'entryChoice',
  EMAIL_ENTRY: 'emailEntry',
  REQUESTING_CODE: 'requestingCode',
  CODE_ENTRY: 'codeEntry',
  VERIFYING: 'verifying',
  AUTHENTICATING: 'authenticating',
  LOADING_PROFILE: 'loadingProfile',
  PROFILE_SETUP: 'profileSetup',
  SAVING_PROFILE: 'savingProfile',
  COMMUNITY: 'community',
  SESSION_EXPIRED: 'sessionExpired',
  SERVICE_ERROR: 'serviceError',
  // Truthful logout (Phase 4B2): logout is an async operation. `signingOut` is the
  // transient state while /logout is in flight; `signOutError` is entered when the
  // server logout FAILS (Stream already disconnected + chat state cleared, but the
  // server session may still be valid) — the UI must not claim the user is signed out.
  SIGNING_OUT: 'signingOut',
  SIGN_OUT_ERROR: 'signOutError',
});

const EVENTS = Object.freeze({
  BOOT: 'BOOT',
  SESSION_VALID: 'SESSION_VALID',
  SESSION_NONE: 'SESSION_NONE',
  CHOOSE_ENTRY: 'CHOOSE_ENTRY',
  SUBMIT_EMAIL: 'SUBMIT_EMAIL',
  CODE_REQUEST_OK: 'CODE_REQUEST_OK',
  CODE_REQUEST_INVALID: 'CODE_REQUEST_INVALID',
  CODE_REQUEST_RATELIMITED: 'CODE_REQUEST_RATELIMITED',
  SUBMIT_CODE: 'SUBMIT_CODE',
  VERIFY_OK: 'VERIFY_OK',
  VERIFY_FAIL: 'VERIFY_FAIL',
  VERIFY_RATELIMITED: 'VERIFY_RATELIMITED',
  TOKEN_OK: 'TOKEN_OK',
  TOKEN_ERROR: 'TOKEN_ERROR',
  PROFILE_COMPLETE: 'PROFILE_COMPLETE',
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
  PROFILE_LOAD_ERROR: 'PROFILE_LOAD_ERROR',
  SAVE_PROFILE: 'SAVE_PROFILE',
  SAVE_OK: 'SAVE_OK',
  SAVE_FAIL: 'SAVE_FAIL',
  EDIT_PROFILE: 'EDIT_PROFILE',
  LOGOUT: 'LOGOUT',
  LOGOUT_OK: 'LOGOUT_OK',       // server /logout succeeded -> entryChoice
  LOGOUT_FAILED: 'LOGOUT_FAILED', // server /logout failed -> signOutError
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SERVICE_ERROR: 'SERVICE_ERROR',
  RETRY: 'RETRY',
});

const S = STATES;
const E = EVENTS;

const ALL_STATES = new Set(Object.values(STATES));

// Logout is meaningful only where an authenticated session may exist. The global
// LOGOUT event from one of these enters the transient `signingOut` state (the async
// logout then dispatches LOGOUT_OK / LOGOUT_FAILED). From other states LOGOUT is a
// no-op. This is also the set from which SESSION_EXPIRED is accepted.
const AUTHENTICATED_STATES = new Set([
  S.AUTHENTICATING, S.LOADING_PROFILE, S.PROFILE_SETUP, S.SAVING_PROFILE, S.COMMUNITY,
]);
const SESSION_EXPIRY_STATES = AUTHENTICATED_STATES;
const LOGOUT_STATES = AUTHENTICATED_STATES;

// Per-state (non-global) transitions. LOGOUT/SESSION_EXPIRED are handled globally
// and are intentionally NOT listed here.
const TRANSITIONS = Object.freeze({
  [S.BOOTING]: { [E.BOOT]: S.CHECKING_SESSION },
  [S.CHECKING_SESSION]: {
    [E.SESSION_VALID]: S.LOADING_PROFILE,
    [E.SESSION_NONE]: S.ENTRY_CHOICE,
    [E.SERVICE_ERROR]: S.SERVICE_ERROR,
  },
  [S.ENTRY_CHOICE]: { [E.CHOOSE_ENTRY]: S.EMAIL_ENTRY },
  [S.EMAIL_ENTRY]: { [E.SUBMIT_EMAIL]: S.REQUESTING_CODE },
  [S.REQUESTING_CODE]: {
    [E.CODE_REQUEST_OK]: S.CODE_ENTRY,
    [E.CODE_REQUEST_INVALID]: S.EMAIL_ENTRY,
    [E.CODE_REQUEST_RATELIMITED]: S.CODE_ENTRY,
    [E.SERVICE_ERROR]: S.SERVICE_ERROR,
  },
  [S.CODE_ENTRY]: {
    [E.SUBMIT_CODE]: S.VERIFYING,
    [E.SUBMIT_EMAIL]: S.REQUESTING_CODE, // resend
  },
  [S.VERIFYING]: {
    [E.VERIFY_OK]: S.AUTHENTICATING,
    [E.VERIFY_FAIL]: S.CODE_ENTRY,
    [E.VERIFY_RATELIMITED]: S.CODE_ENTRY,
    [E.SERVICE_ERROR]: S.SERVICE_ERROR,
  },
  [S.AUTHENTICATING]: {
    [E.TOKEN_OK]: S.LOADING_PROFILE,
    [E.SESSION_NONE]: S.ENTRY_CHOICE,
    [E.TOKEN_ERROR]: S.SERVICE_ERROR,
  },
  [S.LOADING_PROFILE]: {
    [E.PROFILE_COMPLETE]: S.COMMUNITY,
    [E.PROFILE_INCOMPLETE]: S.PROFILE_SETUP,
    [E.PROFILE_LOAD_ERROR]: S.SERVICE_ERROR,
  },
  [S.PROFILE_SETUP]: { [E.SAVE_PROFILE]: S.SAVING_PROFILE },
  [S.SAVING_PROFILE]: {
    [E.SAVE_OK]: S.COMMUNITY,
    [E.SAVE_FAIL]: S.PROFILE_SETUP,
    [E.SERVICE_ERROR]: S.SERVICE_ERROR,
  },
  [S.COMMUNITY]: { [E.EDIT_PROFILE]: S.PROFILE_SETUP },
  [S.SESSION_EXPIRED]: { [E.RETRY]: S.ENTRY_CHOICE },
  [S.SERVICE_ERROR]: { [E.RETRY]: S.CHECKING_SESSION },
  // Truthful async logout. Only LOGOUT_OK/LOGOUT_FAILED are valid here, so a late
  // async success event (VERIFY_OK/TOKEN_OK/PROFILE_COMPLETE) arriving after logout
  // is a no-op and cannot reconnect the user.
  [S.SIGNING_OUT]: { [E.LOGOUT_OK]: S.ENTRY_CHOICE, [E.LOGOUT_FAILED]: S.SIGN_OUT_ERROR },
  [S.SIGN_OUT_ERROR]: { [E.RETRY]: S.SIGNING_OUT },
});

// Resolve a global safety event. Returns a next state or null if not applicable.
function resolveGlobal(current, event) {
  if (!ALL_STATES.has(current)) return null;
  // LOGOUT (from an authenticated state) begins the async sign-out -> signingOut.
  if (event === E.LOGOUT && LOGOUT_STATES.has(current)) return S.SIGNING_OUT;
  if (event === E.SESSION_EXPIRED && SESSION_EXPIRY_STATES.has(current)) return S.SESSION_EXPIRED;
  return null;
}

// Pure transition. Global safety events take precedence over the per-state table.
// Returns { state, changed }. Unknown state, or an event not permitted from the
// current state, is a no-op (changed:false) — never throws.
function transition(current, event) {
  const g = resolveGlobal(current, event);
  if (g !== null) return { state: g, changed: g !== current };
  const table = TRANSITIONS[current];
  if (!table) return { state: current, changed: false };
  const next = table[event];
  if (typeof next !== 'string') return { state: current, changed: false };
  return { state: next, changed: next !== current };
}

// True iff `event` is valid (global or per-state) from `current`.
function canTransition(current, event) {
  if (resolveGlobal(current, event) !== null) return true;
  const table = TRANSITIONS[current];
  return !!(table && typeof table[event] === 'string');
}

module.exports = {
  INITIAL_STATE, STATES, EVENTS, TRANSITIONS,
  AUTHENTICATED_STATES, LOGOUT_STATES, SESSION_EXPIRY_STATES,
  transition, canTransition, resolveGlobal,
};
