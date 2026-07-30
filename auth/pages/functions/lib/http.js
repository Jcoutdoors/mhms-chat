// CORS + response helpers (Phase 3). Exact-origin, credentialed, no-store.

import { AUTH_CONFIG } from './config.js';

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
};

// True only for the exact approved origin. Missing/other origins are NOT approved.
export function isApprovedOrigin(request) {
  return request.headers.get('Origin') === AUTH_CONFIG.approvedOrigin;
}

// CORS headers for approved credentialed responses only.
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': AUTH_CONFIG.approvedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

// JSON response for an APPROVED-origin request. Optionally attaches a Set-Cookie
// and/or a Retry-After header (seconds, from a retryAfterMs).
export function jsonApproved(obj, { status = 200, setCookie, retryAfterMs } = {}) {
  const headers = { 'Content-Type': 'application/json', ...SECURITY_HEADERS, ...corsHeaders() };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    headers['Retry-After'] = String(Math.ceil(retryAfterMs / 1000));
  }
  return new Response(JSON.stringify(obj), { status, headers });
}

// Stable, minimal client-facing error shape. `opts.retryAfterMs` adds Retry-After
// (used for 429). The body never carries counters/timestamps/thresholds/state.
export function errorApproved(error, status, opts = {}) {
  return jsonApproved({ ok: false, error }, { status, retryAfterMs: opts.retryAfterMs });
}

// Rejection for missing/unapproved Origin: 403, NO ACAO, NO Set-Cookie, no detail.
export function rejectOrigin() {
  return new Response(JSON.stringify({ ok: false, error: 'invalid_request' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS, 'Vary': 'Origin' },
  });
}

// Preflight: 204 + CORS for approved origin; 403 (no ACAO) otherwise.
export function preflight(request, methods) {
  if (!isApprovedOrigin(request)) return rejectOrigin();
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      ...SECURITY_HEADERS,
    },
  });
}

// Parse a JSON body defensively; returns null on any problem.
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
