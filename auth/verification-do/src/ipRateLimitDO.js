// IpRateLimitDO — fixed-window IP rate limiter Durable Object (VIF Phase 3).
//
// Reached ONLY via its binding from the auth Pages Functions (no public route).
// Addressed by an opaque IP-derived name computed upstream; this class never
// receives or stores the raw IP — only the window counter. Classic `fetch` style
// so it is unit-testable with an in-memory storage mock.

import { defaultWindow, hit } from './ipRateLimitLogic.js';

const KEY = 'w';

export class IpRateLimitDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // Internal RPC: { op: 'hit', limit, periodMs }. `now` is server-authoritative.
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ allowed: false, reason: 'bad_request' }, 400);
    }
    if (!body || body.op !== 'hit') return json({ allowed: false, reason: 'bad_request' }, 400);
    const limit = Number(body.limit);
    const periodMs = Number(body.periodMs);
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(periodMs) || periodMs <= 0) {
      return json({ allowed: false, reason: 'bad_request' }, 400);
    }
    const cur = (await this.state.storage.get(KEY)) || defaultWindow();
    const { state, allowed } = hit(cur, Date.now(), limit, periodMs);
    await this.state.storage.put(KEY, state);
    return json({ allowed });
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
