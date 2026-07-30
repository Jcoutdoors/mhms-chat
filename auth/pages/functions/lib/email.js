// Branded verification email via Resend (Phase 3).
// - Injectable transport so tests never hit the network.
// - Local capture mode (env.LOCAL_EMAIL_CAPTURE==='1') skips Resend and returns
//   the code to the caller for local workerd integration (gated; never in prod).
// - Never logs the code, the API key, or the full recipient.

import { AUTH_CONFIG } from './config.js';

export function buildVerificationEmail(code) {
  const { appName, subject } = AUTH_CONFIG.email;
  const mins = Math.round(AUTH_CONFIG.code.ttlSeconds / 60);
  const text =
    `${appName}\n\nYour verification code is ${code}\n\n` +
    `It expires in ${mins} minutes. If you didn't request this, you can ignore this email.`;
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:480px">` +
    `<h2 style="margin:0 0 12px">${appName}</h2>` +
    `<p>Your verification code is:</p>` +
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
    `<p style="color:#555">It expires in ${mins} minutes. If you didn't request this, you can safely ignore this email.</p>` +
    `</div>`;
  return { subject, html, text };
}

// Sends the code. Returns { ok, captured?, code? }. Throws nothing to callers
// beyond a boolean result so a delivery failure degrades to a generic response.
export async function sendVerificationCode(env, to, code, transport = globalThis.fetch) {
  // Local-only capture for integration testing. Never active in production.
  if (env && env.LOCAL_EMAIL_CAPTURE === '1') {
    return { ok: true, captured: true, code };
  }
  const { subject, html, text } = buildVerificationEmail(code);
  try {
    const res = await transport('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: AUTH_CONFIG.email.from, to, subject, html, text }),
    });
    return { ok: !!(res && res.ok) };
  } catch {
    // Sanitized: never surface provider internals or the code.
    return { ok: false };
  }
}
