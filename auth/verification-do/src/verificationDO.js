// VerificationDO — strongly consistent per-identity verification-code state
// (VIF Phase 2). Cloudflare Durable Object (classic `fetch` style, no external
// imports, so it is also unit-testable with an in-memory storage mock).
//
// Serialization: a Durable Object instance processes requests one at a time
// (input gate), so the read-modify-write in each op below cannot interleave for
// the same identity — this is what prevents cooldown/limit/attempt/consume
// races. This class is invoked ONLY via its binding from the auth Pages
// Functions; it exposes no public HTTP route (the DO Worker's own default fetch
// returns 404 — see index.js).
//
// The object is addressed by an OPAQUE key (idFromName(HMAC-SHA256(
// normalizedEmail, IDENTITY_KEY_SECRET))) chosen by the caller. This class never
// receives the raw email and never receives a plaintext code — only code HMACs.

import { defaultState, requestCode, submitCode, canSend, reserveCode, confirmCode, cancelCode } from './verificationLogic.js';

const STORAGE_KEY = 'state';

export class VerificationDO {
  constructor(state /* DurableObjectState */, env) {
    this.state = state;
    this.env = env;
  }

  async _load() {
    return (await this.state.storage.get(STORAGE_KEY)) || defaultState();
  }

  async _save(s) {
    await this.state.storage.put(STORAGE_KEY, s);
  }

  // Internal RPC-over-fetch contract used by the auth Pages Functions.
  // Body: { op: 'requestCode'|'submitCode'|'canSend', codeHmac?: string }
  // `now` is server-authoritative (Date.now() here), never taken from input.
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: 'bad_request' }, 400);
    }
    const op = body && body.op;
    const now = Date.now();
    const s = await this._load();

    if (op === 'canSend') {
      const result = canSend(s, now);
      await this._save(s); // persist pruned sends
      return json(result);
    }
    if (op === 'reserveCode') {
      if (!nonEmpty(body.codeHmac) || !nonEmpty(body.issuanceId)) return json({ ok: false, reason: 'bad_request' }, 400);
      const { state, result } = reserveCode(s, now, body.codeHmac, body.issuanceId);
      await this._save(state);
      return json(result);
    }
    if (op === 'confirmCode') {
      if (!nonEmpty(body.issuanceId)) return json({ ok: false, reason: 'bad_request' }, 400);
      const { state, result } = confirmCode(s, now, body.issuanceId);
      await this._save(state);
      return json(result);
    }
    if (op === 'cancelCode') {
      if (!nonEmpty(body.issuanceId)) return json({ ok: false, reason: 'bad_request' }, 400);
      const { state, result } = cancelCode(s, now, body.issuanceId);
      await this._save(state);
      return json(result);
    }
    if (op === 'requestCode') {
      if (!nonEmpty(body.codeHmac)) return json({ ok: false, reason: 'bad_request' }, 400);
      const { state, result } = requestCode(s, now, body.codeHmac);
      await this._save(state);
      return json(result);
    }
    if (op === 'submitCode') {
      if (!nonEmpty(body.codeHmac)) return json({ ok: false, reason: 'bad_request' }, 400);
      const { state, result } = submitCode(s, now, body.codeHmac);
      await this._save(state);
      return json(result);
    }
    return json({ ok: false, reason: 'unknown_op' }, 400);
  }
}

function nonEmpty(v) { return typeof v === 'string' && v.length > 0; }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
