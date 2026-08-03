// Verified-auth onboarding UI (VIF Phase 4B; host-experience pass 4B2). Presentational,
// organization-driven components. They own NO auth logic and NO identity/instructor
// decisions — App() owns the authState machine and passes state + handlers in.
//
// ORGANIZATION-AGNOSTIC: every organization-specific value (assistant name/avatar,
// org name/tagline, community label, brand color, background, copy) comes from `config`
// (orgConfig). Nothing here hardcodes a specific assistant, brand, or program name.
//
// HOST-IN-CARD: the assistant is integrated INTO the card as the host who welcomes and
// guides the user — centered at the top of the card on mobile, side-by-side (character
// left, welcome copy right) on wider screens (a CSS media-query branch). Later screens
// keep a compact host header so the flow never reverts to a bare utility form. When the
// assistant is disabled, no character area renders and copy is neutral, org-centered.

import React, { useState } from 'react';
import { assistantEnabled, assistantAvatarSources, resolveCopy } from './orgConfig.js';
import { describeError, cooldownSeconds } from './authErrors.js';
import { normalizeCode, CODE_LENGTH } from './authCodeInput.js';

const FONT = "'DM Sans', sans-serif";
const INK = '#1a2340';
const SUBTLE = '#5b6379';

function brandOf(config) { return (config && config.brandColor) || '#3b73d8'; }

// One injected stylesheet for the responsive host layout + interaction states. Inline
// styles can't express media queries, so the layout branch lives here (scoped to .vif-auth).
function styleSheet(brand) {
  return `
.vif-auth :focus-visible{outline:3px solid ${brand}59;outline-offset:2px;border-radius:12px}
.vif-card{position:relative;overflow:visible;width:100%;box-sizing:border-box;background:#fff;border-radius:20px;padding:22px 24px 22px;box-shadow:0 16px 44px rgba(30,45,90,0.13);border:1px solid rgba(255,255,255,0.7)}
/* The shell caps the card width. Entry widens on desktop (vif-shell--wide) so the larger
   host and the welcome copy each get room; other screens stay compact at 460. */
.vif-shell{width:100%;max-width:460px;margin:0 auto}
/* Entry welcome zone: centered host on mobile, side-by-side on wider screens. */
.vif-welcome{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px}
.vif-welcome-copy{width:100%}
.vif-hero-lead{display:block;width:150px;height:150px;object-fit:contain;margin:-46px auto 2px;filter:drop-shadow(0 10px 22px rgba(40,60,120,0.16));user-select:none}
.vif-prompt{margin:12px 0 2px;font-size:14.5px;font-weight:600;color:#2f3a5e;line-height:1.45}
/* Tablet: side-by-side host, enlarged ~+22% and given a wider host column. */
@media (min-width:640px){
  .vif-welcome{flex-direction:row;align-items:center;text-align:left;gap:22px;margin-top:2px}
  .vif-welcome-copy{flex:1 1 auto;min-width:0;width:auto}
  .vif-hero-lead{width:180px;height:180px;margin:0;flex:0 0 180px}
}
/* Desktop: the host becomes a co-equal focal point (~+38% vs the prior desktop size,
   ~37% of a widened welcome row) with the copy vertically centered beside him. */
@media (min-width:1024px){
  .vif-shell--wide{max-width:600px}
  .vif-welcome{gap:26px}
  .vif-hero-lead{width:205px;height:205px;flex:0 0 205px}
}
/* Choice rows: typographic, no dominant icon circles. */
.vif-choice{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;text-align:left;padding:14px 16px;border-radius:14px;margin-top:10px;cursor:pointer;background:#fff;border:1.5px solid #e4e8f2;transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease, background .12s ease}
.vif-choice--primary{background:${brand}0c;border-color:${brand}}
.vif-choice:hover{box-shadow:0 8px 20px rgba(40,60,120,0.12);transform:translateY(-1px)}
.vif-choice:active{transform:translateY(0);box-shadow:none}
.vif-chev{flex-shrink:0;color:#b6bccd;font-size:20px;line-height:1}
`;
}

// The assistant character. Tries each configured avatar source in order, then renders
// nothing (no broken image, no empty box) — disabled/missing/failed images degrade cleanly.
function Hero({ config, className, style }) {
  const sources = assistantAvatarSources(config);
  const [idx, setIdx] = useState(0);
  if (!sources.length || idx >= sources.length) return null;
  const alt = (config.assistant && (config.assistant.avatarAlt || config.assistant.name)) || '';
  return <img src={sources[idx]} alt={alt} className={className} style={style} draggable={false} onError={() => setIdx((i) => i + 1)} />;
}

// Compact host header for the non-entry screens: a small integrated character next to the
// organization eyebrow. When the assistant is disabled, only the eyebrow shows.
function HostHeader({ config }) {
  const tag = (config && (config.orgTagline || config.orgName)) || '';
  const src = assistantAvatarSources(config)[0];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
      {src ? <Hero config={config} style={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0 5px 12px rgba(40,60,120,0.16))' }} /> : null}
      {tag ? <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: brandOf(config) }}>{tag}</div> : null}
    </div>
  );
}

function Frame({ config, wide, children }) {
  const bg = (config && config.authBackground) || '#f4f6fb';
  return (
    <div className="vif-auth" style={{ position: 'fixed', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: bg, fontFamily: FONT, zIndex: 1000 }}>
      <style>{styleSheet(brandOf(config))}</style>
      <div style={{ minHeight: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '26px 16px' }}>
        <div className={`vif-shell${wide ? ' vif-shell--wide' : ''}`}>{children}</div>
      </div>
    </div>
  );
}

function Eyebrow({ config }) {
  const tag = (config && (config.orgTagline || config.orgName)) || '';
  if (!tag) return null;
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: brandOf(config), marginBottom: 7 }}>{tag}</div>;
}
function Headline({ children }) {
  return <h1 style={{ margin: 0, fontSize: 21, lineHeight: 1.25, fontWeight: 700, color: INK }}>{children}</h1>;
}
function Body({ children, style }) {
  return <p style={{ margin: '7px 0 0', fontSize: 14, lineHeight: 1.5, color: SUBTLE, ...style }}>{children}</p>;
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

// A choice row that reads as a direct answer to the host's prompt (label + description),
// with a subtle chevron. No dominant icon circle competing with the character.
function ChoiceRow({ label, desc, onClick, primary }) {
  return (
    <button type="button" onClick={onClick} className={`vif-choice${primary ? ' vif-choice--primary' : ''}`}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15.5, fontWeight: 700, color: INK }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: '#6b7386', marginTop: 2, lineHeight: 1.4 }}>{desc}</span>
      </span>
      <span aria-hidden="true" className="vif-chev">›</span>
    </button>
  );
}

// Branded loading (boot/session check/signing out). `lineKey` selects the copy slot.
export function AuthLoading({ config, lineKey = 'loadingLine' }) {
  const brand = brandOf(config);
  return (
    <Frame config={config}>
      <div className="vif-card">
        <HostHeader config={config} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <style>{`@keyframes cp{0%,80%,100%{opacity:.2}40%{opacity:1}}`}</style>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: brand, animation: 'cp 1.2s infinite', animationDelay: `${i * 0.2}s` }} />)}
          </div>
          <span style={{ fontSize: 14.5, color: SUBTLE }}>{resolveCopy(config, lineKey)}</span>
        </div>
      </div>
    </Frame>
  );
}

export function AuthServiceError({ config, onRetry }) {
  return (
    <Frame config={config}>
      <div className="vif-card">
        <HostHeader config={config} />
        <Headline>Let’s try that again</Headline>
        <Body>{resolveCopy(config, 'serviceErrorLine')}</Body>
        <button style={{ ...primaryBtn(config), marginTop: 18 }} onClick={onRetry}>Try again</button>
      </div>
    </Frame>
  );
}

export function SessionExpired({ config, onRetry }) {
  return (
    <Frame config={config}>
      <div className="vif-card">
        <HostHeader config={config} />
        <Headline>Welcome back</Headline>
        <Body>{resolveCopy(config, 'sessionExpiredLine')}</Body>
        <button style={{ ...primaryBtn(config), marginTop: 18 }} onClick={onRetry}>Verify my email</button>
      </div>
    </Frame>
  );
}

// Sign-out FAILED (state-machine `signOutError`). Truthful: does not claim the account is
// signed out; chat stays locally disconnected; Retry re-attempts the server sign-out.
export function SignOutError({ config, onRetry, busy = false }) {
  return (
    <Frame config={config}>
      <div className="vif-card">
        <HostHeader config={config} />
        <Headline>{resolveCopy(config, 'signOutErrorTitle')}</Headline>
        <Body>{resolveCopy(config, 'signOutErrorBody')}</Body>
        <button style={{ ...primaryBtn(config), marginTop: 18, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={onRetry}>{busy ? 'Retrying…' : 'Try again'}</button>
      </div>
    </Frame>
  );
}

// Entry: the host welcomes and guides. Character is integrated INSIDE the card — centered
// atop the card on mobile, to the left of the welcome copy on wider screens.
export function EntryChoice({ config, onNew, onReturning }) {
  const welcome = resolveCopy(config, 'assistantIntro');
  const prompt = resolveCopy(config, 'entryPrompt');
  return (
    <Frame config={config} wide>
      <div className="vif-card">
        <div className="vif-welcome">
          <Hero config={config} className="vif-hero-lead" />
          <div className="vif-welcome-copy">
            <Eyebrow config={config} />
            <Headline>{resolveCopy(config, 'entryHeadline')}</Headline>
            {welcome ? <Body>{welcome}</Body> : null}
            {prompt ? <p className="vif-prompt">{prompt}</p> : null}
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <ChoiceRow primary label={resolveCopy(config, 'newLabel')} desc={resolveCopy(config, 'newDescription')} onClick={onNew} />
          <ChoiceRow label={resolveCopy(config, 'returningLabel')} desc={resolveCopy(config, 'returningDescription')} onClick={onReturning} />
        </div>
      </div>
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
      <div className="vif-card">
        <HostHeader config={config} />
        <Headline>{resolveCopy(config, 'emailHeadline')}</Headline>
        <Body>{resolveCopy(config, 'emailBody')}</Body>
        {isReturning ? (
          <p style={{ margin: '13px 0 0', fontSize: 13, lineHeight: 1.5, color: '#2f3b63', background: `${brand}0f`, border: `1px solid ${brand}2e`, borderRadius: 12, padding: '11px 13px' }}>
            {resolveCopy(config, 'returningReassurance')}
          </p>
        ) : null}
        <form onSubmit={submit} style={{ marginTop: 16 }}>
          <label htmlFor="auth-email" style={labelStyle}>Email</label>
          <input id="auth-email" name="email" style={{ ...inputStyle, marginTop: 6 }} type="email" autoComplete="email" inputMode="email"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <ErrorText desc={desc} />
          <button type="submit" style={{ ...primaryBtn(config), marginTop: 16, opacity: canSubmit ? 1 : 0.6 }} disabled={!canSubmit}>Email me a code</button>
        </form>
      </div>
    </Frame>
  );
}

// `resendCooldown` is the CURRENT remaining seconds (state-owner-updated). This component
// owns NO timer: App/4B2 recomputes and re-renders it.
export function VerificationCode({ config, onVerify, onResend, error, busy, resendCooldown = 0 }) {
  const [code, setCode] = useState('');
  const desc = error ? describeError(error) : null;
  const cooldown = cooldownSeconds(resendCooldown * 1000);
  const canVerify = code.length === CODE_LENGTH && !busy;
  const submit = (e) => { if (e) e.preventDefault(); if (canVerify) onVerify(code); };
  return (
    <Frame config={config}>
      <div className="vif-card">
        <HostHeader config={config} />
        <Headline>{resolveCopy(config, 'codeHeadline')}</Headline>
        <Body>{resolveCopy(config, 'codeBody')}</Body>
        <form onSubmit={submit} style={{ marginTop: 16 }}>
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
      </div>
    </Frame>
  );
}

// Presentational switch over the authState string. App() supplies `state`, `config`, and
// `handlers`; profile setup reuses the ProfileForm. `signingOut`/`signOutError` are
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
