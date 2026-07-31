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
// FAIL CLOSED: missing/blank/malformed configuration yields an empty instructor
// set, so every verified identity resolves to instructor:false.

import { normalizeEmail, emailToUserId } from './identity.js';
import { AUTH_CONFIG } from './config.js';

// Split a configured allowlist string on commas / semicolons / whitespace.
// Non-string input yields []. Blank/whitespace entries are dropped.
export function parseAllowlist(raw) {
  if (typeof raw !== 'string') return [];
  return raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

// Minimal structural email check (mirrors the route validators): exactly one "@"
// with non-empty local and domain parts. Malformed entries are skipped, not thrown.
function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Derive the set of instructor Stream user_ids from the server-configured allowlist.
// Emails are normalized with the CANONICAL rule (no duplicate normalization logic)
// and hashed with the CANONICAL emailToUserId. Duplicates collapse in the Set.
export async function deriveInstructorUserIds(env) {
  const raw = env ? env[AUTH_CONFIG.instructor.bindingName] : undefined;
  const ids = new Set();
  for (const entry of parseAllowlist(raw)) {
    const norm = normalizeEmail(entry);
    if (!looksLikeEmail(norm)) continue; // ignore malformed entries safely
    ids.add(await emailToUserId(norm));
  }
  return ids;
}

// True iff the verified session subject is an approved instructor. Fail-closed:
// a non-string/empty sub, or an empty/absent allowlist, returns false.
export async function isInstructorSub(env, sub) {
  if (typeof sub !== 'string' || !sub) return false;
  const ids = await deriveInstructorUserIds(env);
  return ids.has(sub);
}
