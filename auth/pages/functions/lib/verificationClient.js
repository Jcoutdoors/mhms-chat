// VerificationDO client (Phase 3). The Pages Function derives the OPAQUE object
// name and speaks the internal RPC. It never sends the raw email or a plaintext
// code to the Durable Object — only the code HMAC.

import { hmacSha256Hex } from './crypto.js';

// Opaque routing name = HMAC-SHA256(normalizedEmail, IDENTITY_KEY_SECRET).
export async function deriveObjectName(env, normalizedEmail) {
  return hmacSha256Hex(normalizedEmail, env.IDENTITY_KEY_SECRET);
}

function stubFor(env, objectName) {
  const id = env.VERIFICATION_DO.idFromName(objectName);
  return env.VERIFICATION_DO.get(id);
}

async function call(env, objectName, payload) {
  const stub = stubFor(env, objectName);
  let res;
  try {
    res = await stub.fetch('https://do.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('verification_unavailable'); // safe, generic
  }
  if (!res || !res.ok) throw new Error('verification_unavailable');
  try {
    return await res.json();
  } catch {
    throw new Error('verification_unavailable');
  }
}

// Phase 3 issuance transaction.
export function reserveCode(env, objectName, codeHmac, issuanceId) {
  return call(env, objectName, { op: 'reserveCode', codeHmac, issuanceId });
}
export function confirmCode(env, objectName, issuanceId) {
  return call(env, objectName, { op: 'confirmCode', issuanceId });
}
export function cancelCode(env, objectName, issuanceId) {
  return call(env, objectName, { op: 'cancelCode', issuanceId });
}
export function submitCode(env, objectName, codeHmac) {
  return call(env, objectName, { op: 'submitCode', codeHmac });
}
