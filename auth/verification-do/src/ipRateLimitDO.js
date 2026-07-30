// IpRateLimitDO — trailing rolling-window IP rate limiter Durable Object (Phase 3).
//
// Reached ONLY via its binding from the auth Pages Functions (no public route).
// Addressed by an opaque IP-derived name computed upstream; this class never
// receives or stores the raw IP — only per-policy timestamp arrays. Classic
// `fetch` style so it is unit-testable with an in-memory storage mock. The DO
// selects from SERVER-DEFINED policies; the caller sends only a policy name.

import { defaultState, isKnownPolicy, hit } from './ipRateLimitLogic.js';

const KEY = 'w';

export class IpRateLimitDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // Internal RPC: { op: 'hit', policy: 'verify_request' | 'verify_submit' }.
  // `now` is server-authoritative. No caller-supplied timestamp or limits.
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ allowed: false, reason: 'bad_request' }, 400);
    }
    if (!body || body.op !== 'hit' || typeof body.policy !== 'string' || !isKnownPolicy(body.policy)) {
      return json({ allowed: false, reason: 'bad_request' }, 400);
    }
    const cur = (await this.state.storage.get(KEY)) || defaultState();
    const { state, allowed, retryAfterMs } = hit(cur, Date.now(), body.policy);
    await this.state.storage.put(KEY, state);
    return json({ allowed, retryAfterMs });
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
