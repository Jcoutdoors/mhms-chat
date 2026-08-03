// Server-derived instructor claim (VIF Phase 4A2).
//
// Instructor status is authorization data. It is derived ONLY from the verified
// session subject (the deterministic Stream user_id) against a SERVER-CONTROLLED
// allowlist of instructor emails — never from the browser, localStorage, client
// config, or Stream profile fields.
//
// The session stores only `sub` (= emailToUserId(normalizedEmail)) and never the
// raw email, so we cannot (and must not) reverse it. Instead we map each CONFIGURED
// instructor email through the SAME canonical normalize+hash used for identity, and
// compare the resulting user_ids to the session subject. This needs no session
// format change and keeps the allowlist server-side.
//
// The allowlist is read from a server binding (a plaintext Cloudflare environment
// variable or a secret — same string either way), named by AUTH_CONFIG.instructor
// .bindingName. It is a separator-delimited list of emails. It is NEVER logged and
// NEVER returned to the client.
//
// FAIL CLOSED, TWO WAYS:
//   1. Configuration problems (missing / non-string / blank / malformed / oversized /
//      too many entries) yield an EMPTY instructor set -> instructor:false.
//   2. Any EXCEPTION during derivation is caught by `resolveInstructor` and resolves
//      to `false` (a literal boolean) WITHOUT propagating — so the optional instructor
//      claim can never turn a valid /token response into an error. The exception is
//      not logged or exposed.

import { normalizeEmail, emailToUserId } from './identity.js';
import { AUTH_CONFIG } from './config.js';

// Explicit, centralized bounds. Oversized/excess configuration is treated as
// EMPTY (fail-closed) — never truncated-and-partially-authorized.
export const MAX_ALLOWLIST_RAW_LENGTH = 16 * 1024; // 16 KB
export const MAX_ALLOWLIST_ENTRIES = 100;

// Split a configured allowlist string on commas / semicolons / whitespace.
// Non-string input, or a string longer than the raw-length bound, yields [].
// Blank/whitespace entries are dropped. If the token count exceeds the entry
// bound, the WHOLE list is rejected ([]) rather than partially applied.
export function parseAllowlist(raw) {
  if (typeof raw !== 'string') return [];
  if (raw.length > MAX_ALLOWLIST_RAW_LENGTH) return []; // oversized -> empty, no partial apply
  const entries = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (entries.length > MAX_ALLOWLIST_ENTRIES) return []; // too many -> empty, no partial apply
  return entries;
}

// Minimal structural email check (mirrors the route validators): exactly one "@"
// with non-empty local and domain parts. Malformed entries are skipped, not thrown.
function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Derive the set of instructor Stream user_ids from the server-configured allowlist.
// Emails are normalized with the CANONICAL rule (no duplicate normalization logic)
// and hashed with the CANONICAL emailToUserId (injectable for tests). Duplicates
// collapse in the Set. May reject only if the injected/real derivation throws — the
// public entry point `resolveInstructor` contains that.
export async function deriveInstructorUserIds(env, toUserId = emailToUserId) {
  const raw = env ? env[AUTH_CONFIG.instructor.bindingName] : undefined;
  const ids = new Set();
  for (const entry of parseAllowlist(raw)) {
    const norm = normalizeEmail(entry);
    if (!looksLikeEmail(norm)) continue; // ignore malformed entries safely
    ids.add(await toUserId(norm));
  }
  return ids;
}

// Whether the verified session subject is an approved instructor. May throw only if
// derivation throws; callers should use `resolveInstructor` for the fail-closed path.
export async function isInstructorSub(env, sub, toUserId = emailToUserId) {
  if (typeof sub !== 'string' || !sub) return false;
  const ids = await deriveInstructorUserIds(env, toUserId);
  return ids.has(sub);
}

// PUBLIC entry point for the route. ALWAYS resolves to a literal boolean and NEVER
// throws: any instructor-specific exception (e.g. canonical derivation failure) is
// contained here and becomes `false`, so the optional claim can never interrupt a
// valid token response. The exception is neither logged nor exposed.
//
// `env.__instructorToUserId`, if a function, overrides the canonical hash — a
// test-only seam to simulate derivation failure at the route boundary. It is never
// set in production (there is no such Cloudflare binding), so production always uses
// the canonical emailToUserId.
export async function resolveInstructor(env, sub) {
  const toUserId = env && typeof env.__instructorToUserId === 'function' ? env.__instructorToUserId : emailToUserId;
  try {
    return (await isInstructorSub(env, sub, toUserId)) === true;
  } catch {
    return false; // fail closed; do not log or surface the exception
  }
}
