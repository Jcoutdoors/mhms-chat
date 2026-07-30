// Crypto helpers (Phase 3). Web Crypto only (global in Workers + Node 20+).

const enc = new TextEncoder();

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-SHA256(message, secret) -> lowercase hex.
export async function hmacSha256Hex(message, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(sig);
}

// HMAC-SHA256 -> base64url (for the compact session signature).
export async function hmacSha256B64url(message, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return b64urlFromBytes(new Uint8Array(sig));
}

export function b64urlFromString(str) {
  return b64urlFromBytes(enc.encode(str));
}
export function b64urlFromBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function stringFromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Constant-time comparison of two equal-length hex/ascii strings.
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Cryptographically secure 6-digit code, leading zeros preserved, modulo-bias avoided.
export function generateSixDigitCode() {
  // Rejection sampling over [0, 999999]; 2^20 = 1048576, reject >= 1000000.
  const max = 1000000;
  const limit = Math.floor(0xffffffff / max) * max; // largest multiple of max within uint32
  const buf = new Uint32Array(1);
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % max).padStart(6, '0');
}
