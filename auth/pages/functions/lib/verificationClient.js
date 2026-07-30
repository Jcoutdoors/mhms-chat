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

async function call(env, objectName, op, codeHmac) {
  const stub = stubFor(env, objectName);
  let res;
  try {
    res = await stub.fetch('https://do.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(codeHmac === undefined ? { op } : { op, codeHmac }),
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

export function requestCode(env, objectName, codeHmac) {
  return call(env, objectName, 'requestCode', codeHmac);
}
export function submitCode(env, objectName, codeHmac) {
  return call(env, objectName, 'submitCode', codeHmac);
}
