// Verified-auth onboarding UI (VIF Phase 4B). Presentational, organization-driven
// components. They own NO auth logic and NO identity/instructor decisions — App()
// owns the authState machine (Phase 4B2 wiring) and passes state + handlers in.
// Every organization-specific value (assistant name/avatar, org name, brand color,
// support, copy) comes from `config` (orgConfig), so nothing here hardcodes ATLAS,
// MHMS, or CATS. When the assistant is disabled the copy resolves to neutral
// organization-branded guidance (see orgConfig.resolveCopy).
//
// Not wired into production startup in 4B1; validated by build/transpile.

import React, { useState } from 'react';
import { assistantEnabled, resolveCopy } from './orgConfig.js';
import { describeError, cooldownSeconds } from './authErrors.js';
import { normalizeCode, CODE_LENGTH } from './authCodeInput.js';

const FONT = "'DM Sans', sans-serif";

// A small assistant/organization header used across the flow. Shows the assistant
// avatar+name when enabled, otherwise a neutral organization title.
function Guide({ config, line }) {
  const on = assistantEnabled(config);
  const brand = (config && config.brandColor) || '#3b73d8';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      {on && config.assistant && config.assistant.avatar ? (
        <img src={config.assistant.avatar} alt={config.assistant.avatarAlt || config.assistant.name || ''}
          style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : null}
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{on ? (config.assistant.name || (config.orgName || 'Welcome')) : (config.orgName || 'Welcome')}</div>
        {line ? <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{line}</div> : null}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f4f6fb', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, fontFamily: FONT }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '28px 30px', width: 420, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.12)' }}>{children}</div>
    </div>
  );
}
function primaryBtn(config) {
  return { padding: '11px 18px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer', background: (config && config.brandColor) || '#3b73d8', color: '#fff' };
}
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: 11, fontSize: 15, border: '1px solid #d9d9d9', borderRadius: 8 };

// Neutral branded loading (boot/session check). No form flash before /token resolves.
export function AuthLoading({ config }) {
  return (
    <Shell>
      <Guide config={config} line={resolveCopy(config, 'welcome')} />
      <div style={{ display: 'flex', gap: 6, padding: '8px 0' }}>
        <style>{`@keyframes cp{0%,80%,100%{opacity:.2}40%{opacity:1}}`}</style>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: (config && config.brandColor) || '#3b73d8', animation: 'cp 1.2s infinite', animationDelay: `${i * 0.2}s` }} />)}
      </div>
    </Shell>
  );
}

export function AuthServiceError({ config, onRetry }) {
  return (
    <Shell>
      <Guide config={config} />
      <p style={{ fontSize: 14, color: '#444', lineHeight: 1.5 }}>We’re having trouble connecting. Your session hasn’t been lost — please try again in a moment.</p>
      <button style={{ ...primaryBtn(config), marginTop: 16 }} onClick={onRetry}>Retry</button>
    </Shell>
  );
}

export function EntryChoice({ config, onNew, onReturning }) {
  return (
    <Shell>
      <Guide config={config} line={resolveCopy(config, 'entryChoice')} />
      <button style={{ ...primaryBtn(config), width: '100%', marginBottom: 10 }} onClick={onNew}>New here</button>
      <button style={{ ...primaryBtn(config), width: '100%', background: 'transparent', color: (config && config.brandColor) || '#3b73d8', border: `1px solid ${(config && config.brandColor) || '#3b73d8'}` }} onClick={onReturning}>Returning</button>
      <p style={{ fontSize: 12, color: '#999', marginTop: 14, textAlign: 'center' }}>
        {resolveCopy(config, 'newGuidance')}
      </p>
    </Shell>
  );
}

export function EmailVerification({ config, isReturning, onRequest, error, busy }) {
  const [email, setEmail] = useState('');
  const desc = error ? describeError(error) : null;
  const canSubmit = email.trim() !== '' && !busy;
  const submit = (e) => { if (e) e.preventDefault(); if (canSubmit) onRequest(email.trim()); };
  return (
    <Shell>
      <Guide config={config} line={resolveCopy(config, isReturning ? 'returningGuidance' : 'newGuidance')} />
      <form onSubmit={submit}>
        <label htmlFor="auth-email" style={{ fontSize: 13, color: '#555' }}>Email</label>
        <input id="auth-email" name="email" style={{ ...inputStyle, marginTop: 6 }} type="email" autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        {desc ? <p style={{ color: '#c0392b', fontSize: 12.5, marginTop: 8 }}>{desc.message}</p> : null}
        <button type="submit" style={{ ...primaryBtn(config), width: '100%', marginTop: 14, opacity: canSubmit ? 1 : 0.6 }} disabled={!canSubmit}>Request code</button>
      </form>
    </Shell>
  );
}

// `resendCooldown` is the CURRENT remaining seconds (state-owner-updated). This
// component is presentational and owns NO timer: the state owner (App/4B2) decrements
// and re-renders. No component-owned interval means no component cleanup obligation.
export function VerificationCode({ config, onVerify, onResend, error, busy, resendCooldown = 0 }) {
  const [code, setCode] = useState('');
  const desc = error ? describeError(error) : null;
  const cooldown = cooldownSeconds(resendCooldown * 1000);
  const canVerify = code.length === CODE_LENGTH && !busy;
  const submit = (e) => { if (e) e.preventDefault(); if (canVerify) onVerify(code); };
  return (
    <Shell>
      <Guide config={config} line={resolveCopy(config, 'verificationGuidance')} />
      <form onSubmit={submit}>
        <label htmlFor="auth-code" style={{ fontSize: 13, color: '#555' }}>Six-digit code</label>
        <input id="auth-code" name="code" style={{ ...inputStyle, marginTop: 6, letterSpacing: 4, textAlign: 'center', fontSize: 18 }}
          inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH}
          value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="000000" />
        {desc ? <p style={{ color: '#c0392b', fontSize: 12.5, marginTop: 8 }}>{desc.message}</p> : null}
        <button type="submit" style={{ ...primaryBtn(config), width: '100%', marginTop: 14, opacity: canVerify ? 1 : 0.6 }} disabled={!canVerify}>Verify code</button>
        {/* type=button so resend never submits the verification form */}
        <button type="button" style={{ marginTop: 10, width: '100%', background: 'transparent', border: 'none', color: cooldown > 0 ? '#aaa' : (config && config.brandColor) || '#3b73d8', fontSize: 13, cursor: cooldown > 0 || busy ? 'default' : 'pointer' }}
          disabled={cooldown > 0 || busy} onClick={onResend}>
          {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend code'}
        </button>
      </form>
    </Shell>
  );
}

// Presentational switch over the authState string. App() (4B2) supplies `state`,
// `config`, and `handlers`; profile setup reuses the existing ProfileForm.
export function AuthGate({ state, config, isReturning, error, busy, resendCooldown, handlers = {} }) {
  switch (state) {
    case 'booting':
    case 'checkingSession':
    case 'authenticating':
    case 'loadingProfile':
      return <AuthLoading config={config} />;
    case 'serviceError':
      return <AuthServiceError config={config} onRetry={handlers.onRetry} />;
    case 'entryChoice':
      return <EntryChoice config={config} onNew={handlers.onNew} onReturning={handlers.onReturning} />;
    case 'emailEntry':
    case 'requestingCode':
      return <EmailVerification config={config} isReturning={isReturning} onRequest={handlers.onRequestCode} error={error} busy={state === 'requestingCode' || busy} />;
    case 'codeEntry':
    case 'verifying':
      return <VerificationCode config={config} onVerify={handlers.onVerifyCode} onResend={handlers.onResend} error={error} busy={state === 'verifying' || busy} resendCooldown={resendCooldown} />;
    default:
      return null; // profileSetup/community are rendered by App() (ProfileForm / chat shell)
  }
}
