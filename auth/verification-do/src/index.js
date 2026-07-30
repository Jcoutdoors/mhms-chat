// Durable Object Worker entry (VIF Phase 2).
//
// This Worker exists PRIMARILY to export the VerificationDO class so the auth
// Pages project can bind to it. It intentionally exposes NO public route: its
// own default fetch returns 404. All verification state access happens via the
// Durable Object binding from the auth Pages Functions (Phase 3), never by a
// public HTTP call to this Worker.

export { VerificationDO } from './verificationDO.js';

export default {
  async fetch() {
    // No public endpoint. The DO is reached only through its binding.
    return new Response('not found', { status: 404 });
  },
};
