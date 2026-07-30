// LOCAL-ONLY proof that the Pages Function → VerificationDO binding works.
//
// GATED: returns 404 unless env.LOCAL_DO_PROOF === '1'. That variable is set
// ONLY during local `wrangler pages dev` (see auth/README.md); production never
// sets it, so this route is inert (404) in the deployed project. It is NOT a
// production authentication route: no email, no session, no Stream, no secret.
//
// It proves, against the real Wrangler/workerd runtime, that a Pages Function
// can: read context.env.VERIFICATION_DO, derive an opaque object name, obtain
// the Durable Object stub, call the internal RPC (fetch) contract, and receive
// the expected response.

export async function onRequest(context) {
  const { env, request } = context;
  if (!env || env.LOCAL_DO_PROOF !== '1') {
    return new Response('not found', { status: 404 });
  }
  const url = new URL(request.url);
  const name = url.searchParams.get('id') || 'local-test-identity';
  const op = url.searchParams.get('op') || 'canSend';
  const codeHmac = url.searchParams.get('codeHmac') || undefined;

  // Opaque object name (in production this is HMAC-SHA256(email, IDENTITY_KEY_SECRET)).
  const stubId = env.VERIFICATION_DO.idFromName(name);
  const stub = env.VERIFICATION_DO.get(stubId);
  const doRes = await stub.fetch('https://do.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, codeHmac }),
  });
  const result = await doRes.json();
  return new Response(JSON.stringify({ boundary: 'ok', op, do: result }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
