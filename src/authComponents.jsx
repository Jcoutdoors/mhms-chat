// Verified-auth onboarding UI (VIF Phase 4B; experience pass 4B2). Presentational,
// organization-driven components. They own NO auth logic and NO identity/instructor
// decisions — App() owns the authState machine and passes state + handlers in.
//
// ORGANIZATION-AGNOSTIC: every organization-specific value (assistant name/avatar,
// org name/tagline, community label, brand color, background, copy) comes from
// `config` (orgConfig). Nothing here hardcodes a specific assistant, brand, or program
// name. When the assistant is disabled, copy resolves to neutral org-branded guidance
// and no avatar container renders (see orgConfig.resolveCopy / assistantAvatarSources).

import React, { useState } from 'react';
import { assistantEnabled, assistantAvatarSources, resolveCopy } from './orgConfig.js';
import { describeError, cooldownSeconds } from './authErrors.js';
import { normalizeCode, CODE_LENGTH } from './authCodeInput.js';

const FONT = "'DM Sans', sans-serif";
const INK = '#1a2340';
const SUBTLE = '#5b6379';

function brandOf(config) { return (config && config.brandColor) || '#3b73d8'; }

// Full-viewport scrollable frame with the configured background. Uses the robust
// "min-height:100% + margin auto" pattern so content is vertically centered but never
// clipped on short viewports, and it fills an iframe's height. Provides visible
// keyboard focus rings for all controls in the subtree.
function Frame({ config, children }) {
  const bg = (config && config.authBackground) || '#f4f6fb';
  const brand = brandOf(config);
  return (
    <div className="vif-auth" style={{ position: 'fixed', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: bg, fontFamily: FONT, zIndex: 1000 }}>
      <style>{`.vif-auth :focus-visible{outline:3px solid ${brand}59;outline-offset:2px;border-radius:12px}`}</style>
      <div style={{ minHeight: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '28px 16px' }}>
        <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// The assistant character. Tries each configured avatar source in order, then renders
// nothing (no broken image, no empty box) — so a disabled assistant or a missing/failed
// image degrades cleanly. `size` is 'lead' (entry) or 'sub' (later screens).
function Hero({ config, size = 'lead' }) {
  const sources = assistantAvatarSources(config);
  const [idx, setIdx] = useState(0);
  if (!sources.length || idx >= sources.length) return null;
  const alt = (config.assistant && (config.assistant.avatarAlt || config.assistant.name)) || '';
  const dim = size === 'lead' ? 'clamp(104px, 23vh, 150px)' : 'clamp(78px, 15vh, 104px)';
  return (
    <img
      src={sources[idx]}
      alt={alt}
      style={{ width: dim, height: dim, objectFit: 'contain', marginBottom: size === 'lead' ? 4 : 2, filter: 'drop-shadow(0 12px 26px rgba(40,60,120,0.16))', userSelect: 'none' }}
      draggable={false}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

function Card({ children }) {
  return (
    <div style={{ width: '100%', boxSizing: 'border-box', background: '#fff', borderRadius: 20, padding: '26px 26px 24px', boxShadow: '0 18px 50px rgba(30,45,90,0.14)', border: '1px solid rgba(255,255,255,0.7)' }}>
      {children}
    </div>
  );
}

// Small org identity eyebrow (the umbrella brand). Present even when the assistant is
// disabled, so the organization identity never disappears.
function Eyebrow({ config }) {
  const tag = (config && (config.orgTagline || config.orgName)) || '';
  if (!tag) return null;
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: brandOf(config), marginBottom: 9 }}>{tag}</div>;
}

function Headline({ children }) {
  return <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 700, color: INK }}>{children}</h1>;
}
function Body({ children, style }) {
  return <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.5, color: SUBTLE, ...style }}>{children}</p>;
}

function primaryBtn(config) {
  return { padding: '13px 18px', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer', background: brandOf(config), color: '#fff', width: '100%', boxSizing: 'border-box' };
}
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: 13, fontSize: 15, border: '1px solid #d7dced', borderRadius: 12, background: '#fbfcff', color: INK };
const labelStyle = { fontSize: 13, fontWeight: 600, color: SUBTLE };

function ErrorText({ desc }) {
  if (!desc) return null;
  return <p role="alert" style={{ color: '#c0392b', fontSize: 12.5, margin: '10px 0 0', lineHeight: 1.4 }}>{desc.message}</p>;
}

// A large selection card (label + description) for the two entry paths.
function ChoiceCard({ config, label, desc, onClick, variant }) {
  const brand = brandOf(config);
  const primary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', boxSizing: 'border-box', textAlign: 'left', padding: '15px 16px', borderRadius: 15, marginTop: 12, cursor: 'pointer', background: primary ? `${brand}0d` : '#fff', border: `1.5px solid ${primary ? brand : '#e4e8f2'}`, transition: 'transform .12s ease, box-shadow .12s ease, border-color .12s ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 10px 24px rgba(40,60,120,0.13)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0, width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: primary ? brand : `${brand}14`, color: primary ? '#fff' : brand }}>
        {primary ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v1" /></svg>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: INK }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: '#6b7386', marginTop: 2, lineHeight: 1.4 }}>{desc}</span>
      </span>
      <span aria-hidden="true" style={{ flexShrink: 0, color: '#b6bccd', fontSize: 20, lineHeight: 1 }}>›</span>
    </button>
  );
}

// Branded loading (boot/session check/signing out). `lineKey` selects the copy slot.
export function AuthLoading({ config, lineKey = 'loadingLine' }) {
  const brand = brandOf(config);
  return (
    <Frame config={config}>
      <Hero config={config} size="sub" />
      <Card>
        <Eyebrow config={config} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <style>{`@keyframes cp{0%,80%,100%{opacity:.2}40%{opacity:1}}`}</style>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: brand, animation: 'cp 1.2s infinite', animationDelay: `${i * 0.2}s` }} />)}
          </div>
          <span style={{ fontSize: 14.5, color: SUBTLE }}>{resolveCopy(config, lineKey)}</span>
        </div>
      </Card>
    </Frame>
  );
}

export function AuthServiceError({ config, onRetry }) {
  return (
    <Frame config={config}>
      <Hero config={config} size="sub" />
      <Card>
        <Eyebrow config={config} />
        <Headline>Let’s try that again</Headline>
        <Body>{resolveCopy(config, 'serviceErrorLine')}</Body>
        <button style={{ ...primaryBtn(config), marginTop: 18 }} onClick={onRetry}>Try again</button>
      </Card>
    </Frame>
  );
}

// Session ended (state-machine `sessionExpired`). Truthful, reassuring, re-verify CTA.
export function SessionExpired({ config, onRetry }) {
  return (
    <Frame config={config}>
      <Hero config={config} size="sub" />
      <Card>
        <Eyebrow config={config} />
        <Headline>Welcome back</Headline>
        <Body>{resolveCopy(config, 'sessionExpiredLine')}</Body>
        <button style={{ ...primaryBtn(config), marginTop: 18 }} onClick={onRetry}>Verify my email</button>
      </Card>
    </Frame>
  );
}

// Sign-out FAILED (state-machine `signOutError`). Truthful: does not claim the account
// is signed out; chat stays locally disconnected; Retry re-attempts the server sign-out.
export function SignOutError({ config, onRetry, busy = false }) {
  return (
    <Frame config={config}>
      <Hero config={config} size="sub" />
      <Card>
        <Eyebrow config={config} />
        <Headline>{resolveCopy(config, 'signOutErrorTitle')}</Headline>
        <Body>{resolveCopy(config, 'signOutErrorBody')}</Body>
        <button style={{ ...primaryBtn(config), marginTop: 18, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={onRetry}>{busy ? 'Retrying…' : 'Try again'}</button>
      </Card>
    </Frame>
  );
}

export function EntryChoice({ config, onNew, onReturning }) {
  const intro = resolveCopy(config, 'assistantIntro');
  return (
    <Frame config={config}>
      <Hero config={config} size="lead" />
      <Card>
        <Eyebrow config={config} />
        <Headline>{resolveCopy(config, 'entryHeadline')}</Headline>
        {intro ? <Body style={{ marginBottom: 4 }}>{intro}</Body> : null}
        <div style={{ marginTop: 18 }}>
          <ChoiceCard config={config} variant="primary" label={resolveCopy(config, 'newLabel')} desc={resolveCopy(config, 'newDescription')} onClick={onNew} />
          <ChoiceCard config={config} variant="secondary" label={resolveCopy(config, 'returningLabel')} desc={resolveCopy(config, 'returningDescription')} onClick={onReturning} />
        </div>
      </Card>
    </Frame>
  );
}

export function EmailVerification({ config, isReturning, onRequest, error, busy }) {
  const [email, setEmail] = useState('');
  const desc = error ? describeError(error) : null;
  const canSubmit = email.trim() !== '' && !busy;
  const submit = (e) => { if (e) e.preventDefault(); if (canSubmit) onRequest(email.trim()); };
  const brand = brandOf(config);
  return (
    <Frame config={config}>
      <Hero config={config} size="sub" />
      <Card>
        <Eyebrow config={config} />
        <Headline>{resolveCopy(config, 'emailHeadline')}</Headline>
        <Body>{resolveCopy(config, 'emailBody')}</Body>
        {isReturning ? (
          <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.5, color: '#2f3b63', background: `${brand}0f`, border: `1px solid ${brand}2e`, borderRadius: 12, padding: '11px 13px' }}>
            {resolveCopy(config, 'returningReassurance')}
          </p>
        ) : null}
        <form onSubmit={submit} style={{ marginTop: 18 }}>
          <label htmlFor="auth-email" style={labelStyle}>Email</label>
          <input id="auth-email" name="email" style={{ ...inputStyle, marginTop: 6 }} type="email" autoComplete="email" inputMode="email"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <ErrorText desc={desc} />
          <button type="submit" style={{ ...primaryBtn(config), marginTop: 16, opacity: canSubmit ? 1 : 0.6 }} disabled={!canSubmit}>Email me a code</button>
        </form>
      </Card>
    </Frame>
  );
}

// `resendCooldown` is the CURRENT remaining seconds (state-owner-updated). This
// component owns NO timer: App/4B2 recomputes and re-renders it. No component-owned
// interval means no component cleanup obligation.
export function VerificationCode({ config, onVerify, onResend, error, busy, resendCooldown = 0 }) {
  const [code, setCode] = useState('');
  const desc = error ? describeError(error) : null;
  const cooldown = cooldownSeconds(resendCooldown * 1000);
  const canVerify = code.length === CODE_LENGTH && !busy;
  const submit = (e) => { if (e) e.preventDefault(); if (canVerify) onVerify(code); };
  return (
    <Frame config={config}>
      <Hero config={config} size="sub" />
      <Card>
        <Eyebrow config={config} />
        <Headline>{resolveCopy(config, 'codeHeadline')}</Headline>
        <Body>{resolveCopy(config, 'codeBody')}</Body>
        <form onSubmit={submit} style={{ marginTop: 18 }}>
          <label htmlFor="auth-code" style={labelStyle}>Six-digit code</label>
          <input id="auth-code" name="code" style={{ ...inputStyle, marginTop: 6, letterSpacing: 6, textAlign: 'center', fontSize: 20, fontWeight: 600 }}
            inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH}
            value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="000000" />
          <ErrorText desc={desc} />
          <button type="submit" style={{ ...primaryBtn(config), marginTop: 16, opacity: canVerify ? 1 : 0.6 }} disabled={!canVerify}>Verify and continue</button>
          {/* type=button so resend never submits the verification form */}
          <button type="button" style={{ marginTop: 12, width: '100%', background: 'transparent', border: 'none', color: cooldown > 0 ? '#aab0c0' : brandOf(config), fontSize: 13.5, fontWeight: 600, cursor: cooldown > 0 || busy ? 'default' : 'pointer' }}
            disabled={cooldown > 0 || busy} onClick={onResend}>
            {cooldown > 0 ? `Resend available in ${cooldown}s` : "Didn’t get it? Resend code"}
          </button>
        </form>
      </Card>
    </Frame>
  );
}

// Presentational switch over the authState string. App() supplies `state`, `config`,
// and `handlers`; profile setup reuses the ProfileForm. `signingOut`/`signOutError` are
// rendered by App() directly (AuthLoading / SignOutError).
export function AuthGate({ state, config, isReturning, error, busy, resendCooldown, handlers = {} }) {
  switch (state) {
    case 'booting':
    case 'checkingSession':
    case 'authenticating':
    case 'loadingProfile':
      return <AuthLoading config={config} />;
    case 'serviceError':
      return <AuthServiceError config={config} onRetry={handlers.onRetry} />;
    case 'sessionExpired':
      return <SessionExpired config={config} onRetry={handlers.onRetry} />;
    case 'entryChoice':
      return <EntryChoice config={config} onNew={handlers.onNew} onReturning={handlers.onReturning} />;
    case 'emailEntry':
    case 'requestingCode':
      return <EmailVerification config={config} isReturning={isReturning} onRequest={handlers.onRequestCode} error={error} busy={state === 'requestingCode' || busy} />;
    case 'codeEntry':
    case 'verifying':
      return <VerificationCode config={config} onVerify={handlers.onVerifyCode} onResend={handlers.onResend} error={error} busy={state === 'verifying' || busy} resendCooldown={resendCooldown} />;
    default:
      return null; // profileSetup/community/signingOut/signOutError handled by App()
  }
}
