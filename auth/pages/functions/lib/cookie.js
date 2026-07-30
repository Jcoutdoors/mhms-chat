// __Host- session cookie construction (Phase 3). Host-only, no Domain.

import { AUTH_CONFIG } from './config.js';

const BASE = `Secure; HttpOnly; SameSite=Lax; Path=/`;

export function setSessionCookie(token) {
  return `${AUTH_CONFIG.cookieName}=${token}; ${BASE}; Max-Age=${AUTH_CONFIG.sessionTtlSeconds}`;
}

// Same attributes, Max-Age=0 — clears the cookie.
export function clearSessionCookie() {
  return `${AUTH_CONFIG.cookieName}=; ${BASE}; Max-Age=0`;
}

// Read the session token from the request Cookie header, or null.
export function readSessionCookie(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    if (part.startsWith(AUTH_CONFIG.cookieName + '=')) {
      return part.slice(AUTH_CONFIG.cookieName.length + 1);
    }
  }
  return null;
}
