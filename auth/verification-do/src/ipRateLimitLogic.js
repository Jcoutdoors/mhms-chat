// IpRateLimitDO core logic (VIF Phase 3) — pure, I/O-free, deterministic.
//
// Fixed-window IP rate limiter. One Durable Object instance per opaque
// IP-derived key (idFromName(HMAC-SHA256(clientIP, IDENTITY_KEY_SECRET))). The
// object stores ONLY window state ({ windowStart, count }) — never the raw IP,
// never any PII. Serialization by the Durable Object runtime makes the counter
// race-safe. Server time (`now`) is authoritative.

'use strict';

function defaultWindow() {
  return { windowStart: 0, count: 0 };
}

// Record one request. Returns { state, allowed } for a fixed window of `periodMs`
// permitting up to `limit` requests. A request that starts a new window counts as 1.
function hit(state, now, limit, periodMs) {
  let w = state && typeof state.windowStart === 'number' ? state : defaultWindow();
  if (now - w.windowStart >= periodMs) {
    w = { windowStart: now, count: 1 };
  } else {
    w = { windowStart: w.windowStart, count: w.count + 1 };
  }
  return { state: w, allowed: w.count <= limit };
}

export { defaultWindow, hit };
