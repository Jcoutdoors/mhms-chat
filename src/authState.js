// Onboarding / verified-auth state machine (VIF Phase 4A1).
//
// A PURE, framework-free description of the onboarding flow. It has no React
// dependency and performs no I/O — the UI layer (Phase 4B) drives it by sending
// events and rendering the current state. Modeling it here keeps the transitions
// reviewable and unit-testable in isolation from rendering.
//
// Invalid transitions are explicit and non-throwing: an event that is not valid
// for the current state leaves the state unchanged and reports changed:false.
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
});

const EVENTS = Object.freeze({
  BOOT: 'BOOT',
  SESSION_VALID: 'SESSION_VALID',
  SESSION_NONE: 'SESSION_NONE',
  CHOOSE_ENTRY: 'CHOOSE_ENTRY',        // New here / Returning (path tracked outside the machine)
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
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SERVICE_ERROR: 'SERVICE_ERROR',
  RETRY: 'RETRY',
});

const S = STATES;
const E = EVENTS;

// Per-state allowed events -> next state. Anything not listed is invalid.
const TRANSITIONS = Object.freeze({
  [S.BOOTING]: {
    [E.BOOT]: S.CHECKING_SESSION,
  },
  [S.CHECKING_SESSION]: {
    [E.SESSION_VALID]: S.LOADING_PROFILE, // /token succeeded during boot: token in hand
    [E.SESSION_NONE]: S.ENTRY_CHOICE,     // 401: no valid session
    [E.SERVICE_ERROR]: S.SERVICE_ERROR,   // transient failure, distinct from unauthenticated
  },
  [S.ENTRY_CHOICE]: {
    [E.CHOOSE_ENTRY]: S.EMAIL_ENTRY,
  },
  [S.EMAIL_ENTRY]: {
    [E.SUBMIT_EMAIL]: S.REQUESTING_CODE,
  },
  [S.REQUESTING_CODE]: {
    [E.CODE_REQUEST_OK]: S.CODE_ENTRY,
    [E.CODE_REQUEST_INVALID]: S.EMAIL_ENTRY,       // bad email format -> back to email
    [E.CODE_REQUEST_RATELIMITED]: S.CODE_ENTRY,    // cooldown; a prior code may still be entered
    [E.SERVICE_ERROR]: S.SERVICE_ERROR,
  },
  [S.CODE_ENTRY]: {
    [E.SUBMIT_CODE]: S.VERIFYING,
    [E.SUBMIT_EMAIL]: S.REQUESTING_CODE,           // resend
  },
  [S.VERIFYING]: {
    [E.VERIFY_OK]: S.AUTHENTICATING,               // cookie set; now call /token
    [E.VERIFY_FAIL]: S.CODE_ENTRY,                 // generic wrong/used/locked/expired
    [E.VERIFY_RATELIMITED]: S.CODE_ENTRY,
    [E.SERVICE_ERROR]: S.SERVICE_ERROR,
  },
  [S.AUTHENTICATING]: {
    [E.TOKEN_OK]: S.LOADING_PROFILE,
    [E.SESSION_NONE]: S.ENTRY_CHOICE,              // session vanished right after verify
    [E.TOKEN_ERROR]: S.SERVICE_ERROR,
  },
  [S.LOADING_PROFILE]: {
    [E.PROFILE_COMPLETE]: S.COMMUNITY,
    [E.PROFILE_INCOMPLETE]: S.PROFILE_SETUP,
    [E.PROFILE_LOAD_ERROR]: S.SERVICE_ERROR,
    [E.LOGOUT]: S.ENTRY_CHOICE,
    [E.SESSION_EXPIRED]: S.SESSION_EXPIRED,
  },
  [S.PROFILE_SETUP]: {
    [E.SAVE_PROFILE]: S.SAVING_PROFILE,
    [E.LOGOUT]: S.ENTRY_CHOICE,
  },
  [S.SAVING_PROFILE]: {
    [E.SAVE_OK]: S.COMMUNITY,
    [E.SAVE_FAIL]: S.PROFILE_SETUP,
    [E.SERVICE_ERROR]: S.SERVICE_ERROR,
  },
  [S.COMMUNITY]: {
    [E.EDIT_PROFILE]: S.PROFILE_SETUP,
    [E.LOGOUT]: S.ENTRY_CHOICE,
    [E.SESSION_EXPIRED]: S.SESSION_EXPIRED,
  },
  [S.SESSION_EXPIRED]: {
    [E.RETRY]: S.ENTRY_CHOICE,
    [E.LOGOUT]: S.ENTRY_CHOICE,
  },
  [S.SERVICE_ERROR]: {
    [E.RETRY]: S.CHECKING_SESSION,
    [E.LOGOUT]: S.ENTRY_CHOICE,
  },
});

// Pure transition. Returns { state, changed }. Unknown state or an event not
// permitted for the current state is a no-op (changed:false) — never throws.
function transition(current, event) {
  const table = TRANSITIONS[current];
  if (!table) return { state: current, changed: false };
  const next = table[event];
  if (typeof next !== 'string') return { state: current, changed: false };
  return { state: next, changed: next !== current };
}

// True iff `event` is valid from `current`.
function canTransition(current, event) {
  const table = TRANSITIONS[current];
  return !!(table && typeof table[event] === 'string');
}

module.exports = { INITIAL_STATE, STATES, EVENTS, TRANSITIONS, transition, canTransition };
