// IpRateLimitDO core logic (VIF Phase 3) — pure, I/O-free, deterministic.
//
// TRUE TRAILING ROLLING-WINDOW limiter (not fixed-window: no bucket reset, so
// requests just before and just after a wall-clock minute boundary are counted
// together relative to "now"). One Durable Object per opaque IP-derived key
// (idFromName(HMAC-SHA256(clientIP, IP_RATE_LIMIT_KEY_SECRET))). State holds only
// the minimum timestamp data per SERVER-DEFINED policy — never the raw IP, never
// any PII. Server time (`now`) is authoritative (the DO passes Date.now()).

'use strict';

// Server-defined route policies. The browser NEVER supplies limits/policy values;
// the public route passes only a stable policy name, validated here.
const POLICIES = {
  verify_request: [
    { maxHits: 5, windowMs: 60 * 1000 },        // 5 / trailing 60s
    { maxHits: 20, windowMs: 60 * 60 * 1000 },  // 20 / trailing 60m
  ],
  verify_submit: [
    { maxHits: 20, windowMs: 5 * 60 * 1000 },   // 20 / trailing 5m
    { maxHits: 100, windowMs: 60 * 60 * 1000 }, // 100 / trailing 60m
  ],
};

function isKnownPolicy(name) {
  return Object.prototype.hasOwnProperty.call(POLICIES, name);
}
function defaultState() {
  return {}; // { [policyName]: number[] }  (timestamps, ms)
}

// Record one hit under `policyName`. Returns { state, allowed, retryAfterMs }.
// Rejects if adding this hit would exceed ANY of the policy's trailing windows;
// on reject, does NOT append (counters never exceed a threshold) and reports the
// most conservative retryAfterMs (the longest wait across all violated windows).
function hit(state, now, policyName) {
  const rules = POLICIES[policyName];
  if (!rules) return { state, allowed: false, retryAfterMs: 0, reason: 'bad_policy' };

  const longest = Math.max(...rules.map((r) => r.windowMs));
  const src = state && Array.isArray(state[policyName]) ? state[policyName] : [];
  // 1) prune timestamps older than the longest configured window.
  const arr = src.filter((ts) => now - ts < longest);

  // 2-3) for each rule, would appending exceed the threshold?
  let retryAfterMs = 0;
  for (const r of rules) {
    const inWin = arr.filter((ts) => now - ts < r.windowMs);
    if (inWin.length + 1 > r.maxHits) {
      const oldest = Math.min(...inWin); // oldest in this window frees a slot when it expires
      const ra = oldest + r.windowMs - now;
      if (ra > retryAfterMs) retryAfterMs = ra; // most conservative across violated rules
    }
  }

  if (retryAfterMs > 0) {
    return { state: { ...state, [policyName]: arr }, allowed: false, retryAfterMs };
  }
  // 4-5) allowed: append now, persist pruned+appended state.
  arr.push(now);
  return { state: { ...state, [policyName]: arr }, allowed: true, retryAfterMs: 0 };
}

export { POLICIES, isKnownPolicy, defaultState, hit };
