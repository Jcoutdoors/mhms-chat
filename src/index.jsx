import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { StreamChat } from 'stream-chat';
import {
  Chat,
  Channel,
  ChannelHeader,
  MessageInput,
  MessageList,
  Thread,
  Window,
  useMessageContext,
  useOpenThreadHandler,
  useReactionHandler,
  useDeleteHandler,
  useChatContext,
  useChannelActionContext,
  useChannelStateContext,
  TypingIndicator,
  usePinHandler,
} from 'stream-chat-react';
import 'stream-chat-react/dist/css/index.css';
// Shared production channel configuration. Single source of truth for real cohort channel
// IDs, also consumed by qa-tools/ so the QA guard's production denylist and the app's
// channel-loading path can never drift apart. Never contains cats-qa-* channels.
import {
  ANNOUNCEMENTS_ID,
  GETTING_STARTED_ID,
  STATIC_CHANNELS,
  CHANNEL_GROUPS,
  getLiveChannelDefs,
  retainConfiguredChannels,
  isConfiguredProductionChannelId,
} from './channelConfig';

// Load emoji-mart from CDN at runtime
let emojiMartPromise = null;
function loadEmojiMart() {
  if (emojiMartPromise) return emojiMartPromise;
  emojiMartPromise = new Promise((resolve, reject) => {
    if (window.EmojiMart) { resolve(window.EmojiMart); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/emoji-mart@5/dist/browser.js';
    script.onload = () => {
      if (window.EmojiMart) resolve(window.EmojiMart);
      else reject(new Error('EmojiMart not found'));
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return emojiMartPromise;
}
setTimeout(() => loadEmojiMart().catch(() => {}), 3000);

// APP_CONFIG collects the CATS-specific settings that would change if this codebase
// were ever reused for a different cohort/program: org labels, the Stream API key and
// token worker URL, instructor emails, consultation details, and channel groups. Kept
// as plain data (not split into separate modules) so it stays easy to scan in one place.
const APP_CONFIG = {
  orgName: 'CATS Program',
  orgSubtitle: 'Cohort Community',
  apiKey: '9bdsdh9s956e',
  tokenUrl: 'https://mhms-chat-token.jonathan-5ad.workers.dev',
  // Instructor accounts are gated by the email they sign in with.
  // Anyone signing in with one of these emails can post in Announcements and use @everyone.
  instructorEmails: ['jonathan@nexgenrva.com', 'dr.mark.mayfield@gmail.com'],
  // Mark hosts a recurring Zoom consult; the join link is fixed across sessions.
  // Update consult.dates each term and consult.link if it ever changes.
  consult: {
    link: 'https://ccu.zoom.us/j/2303075413',
    time: '6pm MST (7pm CST / 8pm EST / 5pm PST)',
    dates: ['Jun 10', 'Jun 24', 'Jul 8', 'Jul 22', 'Aug 5', 'Aug 19'],
  },
  // Real cohort channel list now lives in ./channelConfig so the app and the QA tooling
  // share one definition. Never add a cats-qa-* channel to it.
  channelGroups: CHANNEL_GROUPS,
};

// v63 SOURCE CANDIDATE.
// Isolates everything about "which assistant, which image, which welcome-back copy" from
// the platform logic that presents the Welcome Back summary. The initial MHMS build uses
// ATLAS, but nothing outside this object should assume that name, image path, or wording.
// This is intentionally the smallest seam that keeps v64's org-level configuration a
// drop-in replacement rather than a rewrite: a plain constants object, not a config system.
const ASSISTANT_CONFIG = {
  name: 'ATLAS',
  heroImageSrc: './atlas-hero-transparent.png',
  heroImageFallbackSrc: './atlas-hero-white.png',
  heroImageAlt: 'ATLAS',
  welcomeBackGreeting: firstName => (firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'),
  welcomeBackIntro: "I'm here to help you get oriented. Here's what's happened since your last visit.",
};

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}
function isInstructorEmail(email) {
  return APP_CONFIG.instructorEmails.includes(normalizeEmail(email));
}

// Turn an email into a stable, deterministic Stream user ID. The same email always
// yields the same ID, so a person reconnects as the same account on any device.
// Stream user IDs must match [a-z0-9_-]; we hash to hex and prefix with cats-.
async function emailToUserId(email) {
  const norm = normalizeEmail(email);
  const bytes = new TextEncoder().encode(norm);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'cats-' + hex.slice(0, 24);
}

// Instructor status travels on the user object as an `instructor` flag, set at setup
// from the email allowlist. canPostAnnouncements reads that flag. It accepts either a
// full user object or a Stream message user (which also carries the flag once connected).
function canPostAnnouncements(user) {
  if (!user) return false;
  if (typeof user === 'object') return !!user.instructor;
  return false;
}
// ANNOUNCEMENTS_ID, GETTING_STARTED_ID and STATIC_CHANNELS now come from ./channelConfig
// (imported above) so the QA tooling and the app share one definition.

// A live registry of member names, kept up to date by the roster fetch.
// Used to highlight @mentions in rendered messages.
const memberNameRegistry = { names: [] };

// Same collection as before: every configured channel except the static wiki page.
const ALL_CHANNELS = getLiveChannelDefs();

// Ask for browser notification permission once.
function requestNotificationPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch (e) {}
}

// Fire a browser notification + subtle sound for a mention.
function fireMentionAlert(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: 'https://chat.mentalhealthmadesimple.life/favicon.ico' });
      setTimeout(() => { try { n.close(); } catch (e) {} }, 6000);
    }
  } catch (e) {}
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.start(); osc.stop(ctx.currentTime + 0.36);
  } catch (e) {}
}

// v62 SOURCE CANDIDATE — thread reply notifications. Not built, not tested.
// Keyed by threadId, the parent message ID, so a live
// notification.thread_message_new event and queryThreads() reconciliation for
// the same thread cannot create duplicate entries. One notification represents
// one unread thread, not one notification per reply. If multiple people reply
// before the thread is opened, the most recent reply information is shown.
function upsertThreadNote(setThreadNotes, note) {
  setThreadNotes(prev => {
    const existing = prev[note.threadId];
    // v63 SOURCE CANDIDATE — pre-existing v62 data race, found and fixed during v63 QA.
    // Stream can redeliver an older notification.thread_message_new event on reconnect
    // (interleaved with queryThreads() reconciliation, which fetches the true latest
    // state). Without this guard, a stale redelivered event arriving after the correct
    // reconciliation result would silently overwrite it, since the merge below has no
    // ordering check. Only accept the incoming note if it's at least as new as what's
    // already stored, so out-of-order delivery can no longer regress the note.
    if (existing && existing.createdAt && note.createdAt && new Date(note.createdAt) < new Date(existing.createdAt)) {
      return prev;
    }
    return {
      ...prev,
      [note.threadId]: {
        ...(existing || {}),
        ...note,
      },
    };
  });
}

function removeThreadNote(setThreadNotes, threadId) {
  setThreadNotes(prev => {
    if (!prev[threadId]) return prev;
    const next = { ...prev };
    delete next[threadId];
    return next;
  });
}

function getInitialChannelId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('channel');
    // Validate the ?channel= param against the shared production configuration, exactly as
    // the hash path already does. Previously an arbitrary value was returned here and only
    // neutralized downstream by the ALL_CHANNELS.find() fallback in connectChat; the end
    // state was the same, but rejecting it at the validation point makes the invariant
    // explicit and testable rather than incidental.
    if (fromParam && isConfiguredProductionChannelId(fromParam)) return fromParam;
    const hash = window.location.hash.replace('#', '');
    if (hash && isConfiguredProductionChannelId(hash)) return hash;
  } catch (e) {}
  return 'cats-general';
}

const AVATAR_COLORS = [
  { value: '#5a6bd4', label: 'Indigo' },
  { value: '#3a9d96', label: 'Teal' },
  { value: '#cf7a5c', label: 'Clay' },
  { value: '#6f9d6a', label: 'Sage' },
  { value: '#9a5fa6', label: 'Plum' },
  { value: '#5f7088', label: 'Slate' },
  { value: '#cc6585', label: 'Rose' },
  { value: '#c79234', label: 'Amber' },
  { value: '#4f8fc0', label: 'Sky' },
  { value: '#7d7fd4', label: 'Periwinkle' },
  { value: '#2f9d7b', label: 'Emerald' },
  { value: '#b56b9e', label: 'Mauve' },
];

function isTouchDevice() {
  try { return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0); } catch (e) { return false; }
}

function getInitials(name) {
  return (name || '').split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// Renders a circular avatar image when `image` is present and loads successfully.
// Falls back to colored initials when `image` is absent, empty, or fails to load
// (no broken-image icon is ever shown; a load failure just re-renders the initials).
function Avatar({ name, color, size = 32, image }) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [image]);
  const showImage = !!image && !imgFailed;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: showImage ? '#e7e9f0' : (color || '#3b73d8'), color: '#fff',
      fontSize: size * 0.38, fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, userSelect: 'none', fontFamily: "'DM Sans', sans-serif",
      overflow: 'hidden',
    }}>
      {showImage
        ? <img src={image} alt="" onError={() => setImgFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
        : getInitials(name)}
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#555',
  marginBottom: 5, letterSpacing: '0.02em', fontFamily: "'DM Sans', sans-serif",
};
const inputStyle = {
  width: '100%', padding: '9px 12px', fontSize: 14,
  border: '1px solid #e0e0e0', borderRadius: 8,
  fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a',
  background: '#fafafa', outline: 'none', boxSizing: 'border-box',
};
const btnPrimary = {
  width: '100%', padding: '12px', fontSize: 14, fontWeight: 600,
  background: 'linear-gradient(135deg,#3a55d9,#2f44b8)', color: '#fff', border: 'none',
  borderRadius: 10, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  boxShadow: '0 4px 12px rgba(58,85,217,0.28)',
};

function ProfileForm({ initial = {}, onSave, title, subtitle, showIntro = false, isReturning = false }) {
  const [firstName, setFirstName] = useState(initial.firstName || '');
  const [lastName, setLastName] = useState(initial.lastName || '');
  const [email, setEmail] = useState(initial.email || '');
  const [bio, setBio] = useState(initial.bio || '');
  const [link, setLink] = useState(initial.link || '');
  const [color, setColor] = useState(initial.color || AVATAR_COLORS[0].value);
  const [error, setError] = useState('');
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  function handleSave() {
    if (!firstName.trim()) { setError('First name is required.'); return; }
    if (!lastName.trim()) { setError('Last name is required.'); return; }
    const e = email.trim();
    if (!e) { setError('Email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setError('Please enter a valid email address.'); return; }
    onSave({ firstName: firstName.trim(), lastName: lastName.trim(), email: e, bio: bio.trim(), link: link.trim(), color, name: fullName });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '32px 32px 28px', width: 420, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          <Avatar name={fullName || '?'} color={color} size={48} image={initial.image} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: '#1a1a1a' }}>{title}</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{subtitle}</div>
          </div>
        </div>
        {showIntro && (
          <div style={{ background: isReturning ? '#f0f6ff' : '#f7f7f7', border: '1px solid #e6eefb', borderRadius: 10, padding: '13px 15px', marginBottom: 18, fontSize: 12.5, color: '#555', lineHeight: 1.55 }}>
            {isReturning ? (
              <span>
                <strong style={{ color: '#2456b0' }}>Welcome back!</strong> Adding your email just links this device to your account. Your profile and your place in the community are safe, nothing to set up again. This simply lets you sign in across your phone and laptop seamlessly, with no separate account to manage.
              </span>
            ) : (
              <span>
                <strong style={{ color: '#1a1a1a' }}>First time here?</strong> Add your name and email to join. Your email is how you sign in, so use the same one on any device and you will always come back as you, with no separate account to set up.
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>First Name</label>
            <input style={inputStyle} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Sarah" />
          </div>
          <div>
            <label style={labelStyle}>Last Name</label>
            <input style={inputStyle} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Johnson" />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          <div style={{ fontSize: 11.5, color: '#999', marginTop: 5, lineHeight: 1.45 }}>
            Used to keep your account synced across your devices. Use the same email on your phone and laptop to stay signed in as you.
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Bio <span style={{ color: '#bbb', fontWeight: 400 }}>(optional)</span></label>
          <textarea style={{ ...inputStyle, height: 72, resize: 'none' }} value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell the cohort a bit about yourself..." />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Website or LinkedIn <span style={{ color: '#bbb', fontWeight: 400 }}>(optional)</span></label>
          <input style={inputStyle} value={link} onChange={e => setLink(e.target.value)} placeholder="https://linkedin.com/in/yourname" />
        </div>
        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>Avatar Color</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {AVATAR_COLORS.map(c => (
              <button key={c.value} title={c.label} onClick={() => setColor(c.value)} style={{ width: 28, height: 28, borderRadius: '50%', background: c.value, border: color === c.value ? '3px solid #1a1a1a' : '3px solid transparent', cursor: 'pointer', outline: 'none', padding: 0, boxShadow: color === c.value ? '0 0 0 2px #fff inset' : 'none', transition: 'border 0.15s' }} />
            ))}
          </div>
        </div>
        {error && <div style={{ color: '#c00', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <button onClick={handleSave} style={btnPrimary}>Save Profile</button>
      </div>
    </div>
  );
}

function WelcomeCard({ name, onOpenGuide, onDismiss }) {
  const firstName = (name || '').split(' ')[0];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, fontFamily: "'DM Sans', sans-serif", padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '32px 32px 28px', width: 460, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', textAlign: 'center' }}>
        <div style={{ fontSize: 46, marginBottom: 12 }}>👋</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', marginBottom: 10 }}>
          {firstName ? `Welcome, ${firstName}!` : 'Welcome!'}
        </div>
        <div style={{ fontSize: 14, color: '#555', lineHeight: 1.65, maxWidth: 380, margin: '0 auto 22px' }}>
          This is the CATS cohort community, your space to connect, ask questions, and learn together. Before you dive in, take two minutes to read the Getting Started guide. It walks you through how everything works, how to reach Dr. Mayfield, and how to get help if you need it.
        </div>
        <button onClick={onOpenGuide} style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 600, background: 'linear-gradient(135deg,#3a55d9,#2f44b8)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: 10, boxShadow: '0 4px 12px rgba(58,85,217,0.28)' }}>
          Open the Getting Started guide
        </button>
        <button onClick={onDismiss} style={{ width: '100%', padding: '11px', fontSize: 13.5, fontWeight: 500, background: 'none', color: '#666', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
          Got it, take me to the chat
        </button>
      </div>
    </div>
  );
}

function ProfileCard({ user, onClose }) {
  if (!user) return null;
  const name = user.name || user.id;
  const color = user.color || '#3b73d8';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, fontFamily: "'DM Sans', sans-serif" }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '28px 28px 24px', width: 320, boxShadow: '0 16px 48px rgba(0,0,0,0.14)', position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#aaa', lineHeight: 1 }}>×</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <Avatar name={name} color={color} size={52} image={user.image} />
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>{name}</div>
        </div>
        {user.bio && <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 12 }}>{user.bio}</div>}
        {user.link && (
          <a href={user.link.startsWith('http') ? user.link : `https://${user.link}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#3a55d9', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            🔗 {user.link.replace(/^https?:\/\//, '')}
          </a>
        )}
        {!user.bio && !user.link && <div style={{ fontSize: 13, color: '#bbb', fontStyle: 'italic' }}>No profile info yet.</div>}
      </div>
    </div>
  );
}

function EmojiButton({ onEmojiSelect }) {
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pickerRef = useRef(null);
  const btnRef = useRef(null);
  const pickerInstanceRef = useRef(null);

  useEffect(() => {
    if (!showPicker) return;
    if (pickerInstanceRef.current) return;
    setLoading(true);
    loadEmojiMart().then(EmojiMart => {
      if (!pickerRef.current) return;
      pickerRef.current.innerHTML = '';
      const picker = new EmojiMart.Picker({
        onEmojiSelect: (emoji) => {
          onEmojiSelect(emoji.native);
          setShowPicker(false);
        },
        theme: 'light',
        previewPosition: 'none',
        skinTonePosition: 'none',
        maxFrequentRows: 2,
      });
      pickerRef.current.appendChild(picker);
      pickerInstanceRef.current = picker;
      setLoading(false);
    }).catch(() => { setLoading(false); setError(true); });
  }, [showPicker]);

  useEffect(() => {
    function handleClick(e) {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (pickerRef.current && pickerRef.current.contains(e.target)) return;
      setShowPicker(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignSelf: 'flex-end', marginBottom: 2 }}>
      <button ref={btnRef} onClick={() => { setError(false); setShowPicker(p => !p); }} title="Add emoji"
        style={{ background: showPicker ? '#f1f4fe' : 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '6px 8px', borderRadius: 8, color: showPicker ? '#3a55d9' : '#969cac', lineHeight: 1, display: 'flex', alignItems: 'center', transition: 'all 0.15s' }}>
        😊
      </button>
      {showPicker && (
        <div style={{ position: 'absolute', bottom: '44px', left: 0, zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          {loading && <div style={{ padding: '16px 24px', fontSize: 13, color: '#999', fontFamily: "'DM Sans', sans-serif" }}>Loading emojis...</div>}
          {error && <div style={{ padding: '16px 24px', fontSize: 13, color: '#c00', fontFamily: "'DM Sans', sans-serif" }}>Could not load emoji picker.</div>}
          <div ref={pickerRef} />
        </div>
      )}
    </div>
  );
}

// Render message text with @mentions highlighted.
// Turn a plain string into an array of text and clickable link elements.
// Detects http(s):// URLs, bare www. URLs, and bare email addresses, and renders them
// as links (email addresses become mailto: links). Used on the non-mention text
// segments below. Note: an email address whose local part matches a known member's
// first name (e.g. "sarah@gmail.com") is caught by the @mention pass first, same as
// before this change; that pre-existing interaction is unaffected.
function linkifyText(str, keyStart) {
  if (!str) return [str];
  // Match http(s) URLs, bare www. URLs, or bare email addresses in a single pass so
  // matches never overlap. Trailing sentence punctuation is trimmed for URLs only.
  const linkRe = /((?:https?:\/\/|www\.)[^\s]+)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/gi;
  const out = [];
  let last = 0; let m; let key = keyStart;
  while ((m = linkRe.exec(str)) !== null) {
    const isUrl = !!m[1];
    let matched = m[0];
    let trail = '';
    if (isUrl) {
      // Don't swallow trailing sentence punctuation that is unlikely to be part of the URL.
      const trailMatch = matched.match(/[.,;:!?)\]}'"]+$/);
      if (trailMatch) { trail = trailMatch[0]; matched = matched.slice(0, matched.length - trail.length); }
    }
    if (m.index > last) out.push(str.slice(last, m.index));
    const href = isUrl ? (matched.startsWith('http') ? matched : 'https://' + matched) : 'mailto:' + matched;
    out.push(
      <a key={'lnk' + (key++)} href={href} target={isUrl ? '_blank' : undefined} rel={isUrl ? 'noopener noreferrer' : undefined}
        style={{ color: '#3a55d9', textDecoration: 'underline', wordBreak: 'break-word' }}
        onClick={e => e.stopPropagation()}>
        {matched}
      </a>
    );
    if (trail) out.push(trail);
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
}

function renderTextWithMentions(text) {
  if (!text) return text;
  const names = memberNameRegistry.names || [];
  // Build a regex of @everyone plus @<known names> (longest first to match full names)
  const escaped = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const tokens = ['everyone', ...escaped].filter(Boolean);
  const re = tokens.length ? new RegExp('@(' + tokens.join('|') + ')\\b', 'gi') : null;
  const parts = [];
  let last = 0; let m; let key = 0;
  if (re) {
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        // linkify the plain text between mentions
        linkifyText(text.slice(last, m.index), key).forEach(p => parts.push(p));
        key += 50;
      }
      parts.push(
        <span key={'mnt' + (key++)} style={{ background: '#e8f0fe', color: '#2456b0', fontWeight: 600, borderRadius: 4, padding: '0 3px' }}>
          {m[0]}
        </span>
      );
      last = m.index + m[0].length;
    }
  }
  if (last < text.length) {
    linkifyText(text.slice(last), key).forEach(p => parts.push(p));
  }
  return parts.length ? parts : text;
}

const REACTION_EMOJI = { like: '👍', love: '❤️', haha: '😄', wow: '😮', sad: '😢' };
const REACTION_ORDER = ['like', 'love', 'haha', 'wow', 'sad'];

function CustomMessage() {
  const { message, isMyMessage } = useMessageContext();
  const openThread = useOpenThreadHandler(message);
  const { handlePin } = usePinHandler(message, {});
  const handleReaction = useReactionHandler(message);
  const handleDelete = useDeleteHandler(message);
  const { client } = useChatContext();
  const [showProfile, setShowProfile] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text || '');
  const user = message.user || {};
  const name = user.name || user.id || 'Member';
  const color = user.color || '#3b73d8';
  const mine = isMyMessage();

  if (message.deleted_at || message.type === 'deleted') {
    return (
      <div style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, padding: '3px 16px', marginBottom: 2 }}>
        <div style={{ fontSize: 12, color: '#bbb', fontStyle: 'italic', fontFamily: "'DM Sans', sans-serif" }}>This message was deleted</div>
      </div>
    );
  }
  if (!message.text) return null;

  const replyCount = message.reply_count || 0;
  const reactionCounts = message.reaction_counts || {};
  const ownReactions = (message.own_reactions || []).map(r => r.type);

  async function saveEdit() {
    const trimmed = editText.trim();
    if (!trimmed) { setEditing(false); return; }
    try {
      await client.updateMessage({ id: message.id, text: trimmed });
    } catch (e) {
      console.error('edit failed:', e.message);
    }
    setEditing(false);
  }

  return (
    <div onMouseEnter={() => { if (!isTouchDevice()) setHovered(true); }} onMouseLeave={() => { if (!isTouchDevice()) { setHovered(false); setShowReactionPicker(false); } }}
      style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, padding: '3px 16px', marginBottom: 2, position: 'relative' }}>
      <div style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => setShowProfile(true)}>
        <Avatar name={name} color={color} size={32} image={user.image} />
      </div>
      <div style={{ maxWidth: '68%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 3, cursor: 'pointer' }} onClick={() => setShowProfile(true)}>
          {mine ? 'You' : name}
        </div>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 280 }}>
            <textarea value={editText} onChange={e => setEditText(e.target.value)} autoFocus
              style={{ ...inputStyle, height: 60, resize: 'none', background: '#fff' }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(false); }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveEdit} style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: '#3a55d9', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Save</button>
              <button onClick={() => { setEditing(false); setEditText(message.text); }} style={{ fontSize: 12, color: '#666', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div onClick={() => { if (isTouchDevice()) setHovered(h => !h); }}
            style={{ background: mine ? '#eef1fd' : '#f4f5f8', borderRadius: mine ? '14px 4px 14px 14px' : '4px 14px 14px 14px', padding: '10px 14px', fontSize: 14, color: '#383d4b', lineHeight: 1.6, wordBreak: 'break-word', fontFamily: "'DM Sans', sans-serif", cursor: isTouchDevice() ? 'pointer' : 'default' }}>
            {renderTextWithMentions(message.text)}
            {message.message_text_updated && <span style={{ fontSize: 10, color: '#aaa', marginLeft: 6 }}>(edited)</span>}
          </div>
        )}

        {/* Reaction pills under the bubble */}
        {Object.keys(reactionCounts).length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {REACTION_ORDER.filter(t => reactionCounts[t] > 0).map(t => {
              const reacted = ownReactions.includes(t);
              return (
                <button key={t} onClick={() => handleReaction(t)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 9px', borderRadius: 13, border: reacted ? '1px solid #5872ea' : '1px solid #e7e9f0', background: reacted ? '#f1f4fe' : '#fbfcfe', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, color: reacted ? '#2f44b8' : '#686e7e', transition: 'all 0.14s ease' }}>
                  <span>{REACTION_EMOJI[t]}</span>
                  <span style={{ color: reacted ? '#2f44b8' : '#969cac', fontWeight: 700 }}>{reactionCounts[t]}</span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <div style={{ fontSize: 10, color: '#bbb' }}>
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          {message.pinned && (
            <span style={{ fontSize: 10, color: '#b45309', fontWeight: 600, background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>📌 Pinned</span>
          )}
          {replyCount > 0 && (
            <button onClick={openThread} style={{ fontSize: 11, color: '#3a55d9', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>

      {hovered && !editing && (
        <div style={{ position: 'absolute', top: -14, [mine ? 'right' : 'left']: 56, background: '#fff', border: '1px solid #e7e9f0', borderRadius: 9, boxShadow: '0 4px 16px rgba(24,27,38,0.07),0 1px 4px rgba(24,27,38,0.05)', display: 'flex', gap: 2, padding: '3px 6px', zIndex: 10, alignItems: 'center' }}>
          <button onClick={() => setShowReactionPicker(p => !p)} title="React" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 5px', borderRadius: 4, fontSize: 14, display: 'flex', alignItems: 'center' }}>
            😊
          </button>
          <button onClick={openThread} title="Reply in thread" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 5px', borderRadius: 4, fontSize: 13, color: '#666', fontFamily: "'DM Sans', sans-serif" }}>
            ↩ Reply
          </button>
          <button onClick={handlePin} title={message.pinned ? 'Unpin' : 'Pin message'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 5px', borderRadius: 4, fontSize: 13, color: '#666', fontFamily: "'DM Sans', sans-serif" }}>
            📌
          </button>
          {mine && (
            <span style={{ display: 'inline-flex', gap: 2 }}>
              <button onClick={() => { setEditText(message.text); setEditing(true); }} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 5px', borderRadius: 4, fontSize: 13, color: '#666', fontFamily: "'DM Sans', sans-serif" }}>
                ✏️
              </button>
              <button onClick={() => { if (confirm('Delete this message?')) handleDelete(); }} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 5px', borderRadius: 4, fontSize: 13, color: '#c0392b', fontFamily: "'DM Sans', sans-serif" }}>
                🗑
              </button>
            </span>
          )}
          {showReactionPicker && (
            <div style={{ position: 'absolute', top: 34, [mine ? 'right' : 'left']: 0, background: '#fff', border: '1px solid #e7e9f0', borderRadius: 10, boxShadow: '0 4px 16px rgba(24,27,38,0.10)', display: 'flex', gap: 4, padding: '6px 8px', zIndex: 20 }}>
              {REACTION_ORDER.map(t => (
                <button key={t} onClick={() => { handleReaction(t); setShowReactionPicker(false); }} title={t} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: '2px 4px', borderRadius: 6, lineHeight: 1 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f4f4f4'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  {REACTION_EMOJI[t]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {showProfile && <ProfileCard user={user} onClose={() => setShowProfile(false)} />}
    </div>
  );
}

// Members list: shows a full roster of all cohort members, green dot = online.
// Uses queryUsers (presence) as primary, falls back to channel watchers/members.
function MembersList({ chatClient, activeChannel, currentUserId }) {
  const [users, setUsers] = useState([]);
  const [profileUser, setProfileUser] = useState(null);

  useEffect(() => {
    if (!chatClient) return;
    let cancelled = false;

    const fetchRoster = async () => {
      const seen = {};

      // 1) Try the global user roster with presence
      try {
        const resp = await chatClient.queryUsers(
          { role: 'user' },
          { last_active: -1 },
          { presence: true, limit: 100 }
        );
        (resp.users || []).forEach(u => {
          if (u && u.id && u.name) seen[u.id] = { ...u };
        });
      } catch (e) {
        // ignore, fall through to channel-based fallback
      }

      // 2) Merge in watchers from the active channel (definitely online)
      if (activeChannel) {
        Object.values(activeChannel.state.watchers || {}).forEach(w => {
          if (w && w.id) seen[w.id] = { ...(seen[w.id] || {}), ...w, online: true };
        });
        Object.values(activeChannel.state.members || {}).forEach(m => {
          if (m.user && m.user.id) seen[m.user.id] = { ...(seen[m.user.id] || {}), ...m.user };
        });
      }

      // 3) Always include the connected user as online
      if (chatClient.user && chatClient.user.id) {
        seen[chatClient.user.id] = { ...(seen[chatClient.user.id] || {}), ...chatClient.user, online: true };
      }

      const list = Object.values(seen).filter(u => u && u.id && u.name);
      memberNameRegistry.names = list.map(u => u.name).filter(Boolean);
      if (!cancelled) setUsers(list);
    };

    fetchRoster();
    const interval = setInterval(fetchRoster, 6000);

    const handler = () => fetchRoster();
    chatClient.on('user.presence.changed', handler);
    chatClient.on('user.watching.start', handler);
    chatClient.on('user.watching.stop', handler);
    chatClient.on('user.updated', handler);

    return () => {
      cancelled = true;
      clearInterval(interval);
      chatClient.off('user.presence.changed', handler);
      chatClient.off('user.watching.start', handler);
      chatClient.off('user.watching.stop', handler);
      chatClient.off('user.updated', handler);
    };
  }, [chatClient, activeChannel]);

  const onlineCount = users.filter(u => u.online).length;
  const sorted = [...users].sort((a, b) => {
    if (a.online && !b.online) return -1;
    if (!a.online && b.online) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  return (
    <div style={{ padding: '10px 10px 16px', borderTop: '1px solid #eef0f5' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#969cac', letterSpacing: '0.09em', textTransform: 'uppercase', padding: '0 8px', marginBottom: 6 }}>
        Members {onlineCount > 0 && <span style={{ color: '#22c55e' }}>· {onlineCount} online</span>}
      </div>
      {sorted.map(user => {
        const name = user.name || user.id || 'Member';
        const color = user.color || '#3b73d8';
        const isOnline = !!user.online;
        return (
          <div key={user.id} onClick={() => setProfileUser(user)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#efefef'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Avatar name={name} color={color} size={24} image={user.image} />
              <div style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: isOnline ? '#22c55e' : '#d1d5db', border: '1.5px solid #f9f9f9', transition: 'background 0.3s' }} />
            </div>
            <span style={{ fontSize: 12, color: isOnline ? '#1a1a1a' : '#999', fontWeight: isOnline ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {name}{user.id === currentUserId ? ' (you)' : ''}
            </span>
          </div>
        );
      })}
      {sorted.length === 0 && <div style={{ fontSize: 12, color: '#bbb', padding: '4px 8px' }}>No members yet</div>}
      {profileUser && <ProfileCard user={profileUser} onClose={() => setProfileUser(null)} />}
    </div>
  );
}

function Sidebar({ groups, activeId, onSelect, currentUser, chatClient, activeChannel, onEditProfile, unreadCounts = {}, mentionCounts = {}, isMobile = false, mobileNavOpen = false, onCloseMobileNav }) {
  const name = currentUser?.name || '';
  const color = currentUser?.color || '#3b73d8';

  const baseStyle = { width: 264, minWidth: 264, background: 'linear-gradient(180deg,#f8f9fc 0%, #f4f6fa 100%)', borderRight: '1px solid #eef0f5', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif", overflowY: 'auto', WebkitOverflowScrolling: 'touch' };
  const mobileStyle = isMobile ? {
    position: 'fixed', top: 0, left: 0, height: '100dvh', maxHeight: '100dvh', zIndex: 1100,
    transform: mobileNavOpen ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.25s ease', boxShadow: mobileNavOpen ? '2px 0 24px rgba(0,0,0,0.18)' : 'none',
    overflowY: 'auto', WebkitOverflowScrolling: 'touch',
  } : {};

  return (
    <React.Fragment>
      {isMobile && mobileNavOpen && (
        <div onClick={onCloseMobileNav} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1099 }} />
      )}
      <div style={{ ...baseStyle, ...mobileStyle }}>
        {isMobile && (
          <button onClick={onCloseMobileNav} style={{ position: 'absolute', top: 14, right: 12, background: 'none', border: 'none', fontSize: 22, color: '#999', cursor: 'pointer', lineHeight: 1, zIndex: 2 }}>×</button>
        )}
      <div style={{ padding: '20px 20px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#3a55d9,#2f44b8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, boxShadow: '0 4px 12px rgba(58,85,217,0.35)', fontFamily: "'Fraunces', serif", flexShrink: 0 }}>C</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#181b26', letterSpacing: '0.01em' }}>{APP_CONFIG.orgName}</div>
            <div style={{ fontSize: 11.5, color: '#969cac', marginTop: 1 }}>{APP_CONFIG.orgSubtitle}</div>
          </div>
        </div>
      </div>

      {groups.map(group => (
        <div key={group.label} style={{ padding: '12px 10px 4px', flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#969cac', letterSpacing: '0.09em', textTransform: 'uppercase', padding: '8px 10px 6px' }}>{group.label}</div>
          {group.channels.map(ch => {
            const active = ch.id === activeId;
            const unread = unreadCounts[ch.id] || 0;
            const mentioned = mentionCounts[ch.id] || 0;
            return (
              <button key={ch.id} onClick={() => onSelect(ch.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 11px', border: 'none', background: active ? '#ffffff' : 'none', borderRadius: 9, cursor: 'pointer', textAlign: 'left', marginBottom: 1, transition: 'background 0.16s ease', boxShadow: active ? '0 1px 2px rgba(24,27,38,0.05),0 1px 3px rgba(24,27,38,0.04)' : 'none' }} onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(58,85,217,0.06)'; }} onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none'; }}>
                <span style={{ fontSize: 13, color: active ? '#3a55d9' : '#c4c9d4', fontWeight: 600, flexShrink: 0 }}>#</span>
                <span style={{ fontSize: 13.5, color: active ? '#181b26' : (unread > 0 ? '#181b26' : '#686e7e'), fontWeight: (active || unread > 0) ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{ch.name}</span>
                {mentioned > 0 && !active && (
                  <span style={{ background: '#e07a5f', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px', minWidth: 18, textAlign: 'center', flexShrink: 0 }}>@</span>
                )}
                {unread > 0 && mentioned === 0 && !active && (
                  <span style={{ background: '#3a55d9', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px', minWidth: 18, textAlign: 'center', flexShrink: 0 }}>{unread > 99 ? '99+' : unread}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      <MembersList chatClient={chatClient} activeChannel={activeChannel} currentUserId={currentUser?.id} />

      <div style={{ padding: '10px 14px', borderTop: '1px solid #eef0f5', flexShrink: 0 }}>
        <button onClick={onEditProfile} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: 8, transition: 'background 0.15s' }} onMouseEnter={e => e.currentTarget.style.background = '#efefef'} onMouseLeave={e => e.currentTarget.style.background = 'none'} title="Edit your profile">
          <div style={{ position: 'relative' }}>
            <Avatar name={name} color={color} size={28} image={currentUser?.image} />
            <div style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: '#22c55e', border: '1.5px solid #f9f9f9' }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#333', flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          <span style={{ fontSize: 11, color: '#bbb' }}>Edit</span>
        </button>
      </div>
    </div>
    </React.Fragment>
  );
}

const EMPTY_PROMPTS = {
  'cats-announcements': { icon: '📣', title: 'Announcements', body: 'Important updates from the instructor will appear here. Check back often for schedule changes and key information.' },
  'cats-general': {
    icon: '👋',
    title: 'Welcome to the CATS Community!',
    body: 'This is the heart of the cohort, where you connect, ask questions, and learn together. Before you post, take two minutes to read the Getting Started guide. It shows you how everything works, how to reach Dr. Mayfield, and how to get help.',
    ctaLabel: 'Read the Getting Started guide',
    ctaChannel: GETTING_STARTED_ID,
    afterCta: 'Then come back here and introduce yourself. We are glad you are here.',
  },
  'cats-weekly-wins': { icon: '🎉', title: 'Weekly Wins', body: 'Share a win from your week, big or small. Be the first to get it started.' },
  'cats-readings': { icon: '📚', title: 'Readings & Resources', body: 'Share articles, resources, and readings with the cohort here.' },
};
function ChannelEmptyState({ channelId, onJump }) {
  const prompt = EMPTY_PROMPTS[channelId] || { icon: '💬', title: '', body: 'No messages yet. Start the conversation for this module.' };
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 32px', textAlign: 'center', fontFamily: "'DM Sans', sans-serif", color: '#999' }}>
      <div style={{ fontSize: 44, marginBottom: 14 }}>{prompt.icon}</div>
      {prompt.title && <div style={{ fontSize: 17, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>{prompt.title}</div>}
      <div style={{ fontSize: 14, color: '#666', maxWidth: 360, lineHeight: 1.6 }}>{prompt.body}</div>
      {prompt.ctaLabel && onJump && (
        <button onClick={() => onJump(prompt.ctaChannel)}
          style={{ marginTop: 18, background: 'linear-gradient(135deg,#3a55d9,#2f44b8)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", boxShadow: '0 4px 12px rgba(58,85,217,0.28)' }}>
          {prompt.ctaLabel}
        </button>
      )}
      {prompt.afterCta && <div style={{ fontSize: 13, color: '#999', maxWidth: 340, lineHeight: 1.6, marginTop: 14 }}>{prompt.afterCta}</div>}
    </div>
  );
}

// Watches the Stream message textarea for "@" and shows a member autocomplete.
function MentionAutocomplete({ members, canMentionEveryone }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState({ left: 12, bottom: 56 });
  const taRef = useRef(null);

  useEffect(() => {
    const ta = document.querySelector('.str-chat__message-textarea-react-host textarea, .str-chat__message-textarea');
    if (!ta) return;
    taRef.current = ta;

    const onInput = () => {
      const val = ta.value;
      const pos = ta.selectionStart;
      const upto = val.slice(0, pos);
      const m = upto.match(/@([\w]*)$/);
      if (m) { setQuery(m[1].toLowerCase()); setOpen(true); }
      else setOpen(false);
    };
    ta.addEventListener('input', onInput);
    ta.addEventListener('keyup', onInput);
    ta.addEventListener('click', onInput);
    return () => {
      ta.removeEventListener('input', onInput);
      ta.removeEventListener('keyup', onInput);
      ta.removeEventListener('click', onInput);
    };
  }, []);

  if (!open) return null;

  const options = [];
  if (canMentionEveryone && 'everyone'.startsWith(query)) {
    options.push({ id: '__everyone', name: 'everyone', everyone: true });
  }
  members
    .filter(m => m.name && m.name.toLowerCase().includes(query))
    .slice(0, 8)
    .forEach(m => options.push(m));

  if (options.length === 0) return null;

  function pick(opt) {
    const ta = taRef.current;
    if (!ta) return;
    const val = ta.value;
    const pos = ta.selectionStart;
    const upto = val.slice(0, pos);
    const after = val.slice(pos);
    const replaced = upto.replace(/@([\w]*)$/, '@' + opt.name + ' ');
    const newVal = replaced + after;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, newVal);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = replaced.length;
    setTimeout(() => { ta.focus(); ta.setSelectionRange(caret, caret); }, 0);
    setOpen(false);
  }

  return (
    <div style={{ position: 'absolute', left: 12, bottom: 52, zIndex: 300, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.14)', overflow: 'hidden', minWidth: 220, fontFamily: "'DM Sans', sans-serif" }}>
      {options.map(opt => (
        <div key={opt.id} onMouseDown={e => { e.preventDefault(); pick(opt); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = '#f4f4f4'}
          onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
          {opt.everyone ? (
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#e03e3e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>@</div>
          ) : (
            <Avatar name={opt.name} color={opt.color} size={24} image={opt.image} />
          )}
          <span style={{ fontSize: 13, color: '#1a1a1a', fontWeight: opt.everyone ? 600 : 400 }}>
            {opt.everyone ? 'everyone' : opt.name}
            {opt.everyone && <span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>Notify the whole cohort</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function GettingStartedWiki() {
  const Section = ({ icon, title, children }) => (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{title}</span>
      </div>
      <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.65, paddingLeft: 26 }}>{children}</div>
    </div>
  );
  return (
    <div className="cats-wiki" style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', fontFamily: "'DM Sans', sans-serif", background: '#fff' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>Welcome to the CATS Community</h1>
        <p style={{ fontSize: 14, color: '#777', marginBottom: 26, lineHeight: 1.6 }}>This is your space to connect with the cohort, ask questions, and learn together. Here is how everything works.</p>

        {/* Live consultation card */}
        <div style={{ borderRadius: 16, padding: '22px 24px', marginBottom: 28, background: 'linear-gradient(135deg, #3a55d9 0%, #2f44b8 100%)', boxShadow: '0 12px 30px rgba(47,68,184,0.28)', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>🎥</span>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.01em' }}>Live Consultations with Dr. Mayfield</span>
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(255,255,255,0.92)', marginBottom: 14 }}>
            Mark hosts a live Zoom consultation every other week at <strong>{APP_CONFIG.consult.time}</strong>. Same link every time, so you can join right from here.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
            {APP_CONFIG.consult.dates.map(d => (
              <span key={d} style={{ fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.16)', color: '#fff', padding: '4px 10px', borderRadius: 20 }}>{d}</span>
            ))}
          </div>
          <a href={APP_CONFIG.consult.link} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#2f44b8', fontSize: 14, fontWeight: 700, padding: '11px 20px', borderRadius: 10, textDecoration: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.16)' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            Join our consultation
          </a>
        </div>

        <Section icon="💬" title="Channels">
          The sidebar on the left holds all your channels. Each course module has its own channel for module-specific discussion. The Community channels (General, Weekly Wins, Readings & Resources) are for everything else. Click any channel to open it.
        </Section>

        <Section icon="📣" title="Announcements">
          Important updates from the instructor land in the Announcements channel. Only instructors can post there, so keep an eye on it for schedule changes and key information.
        </Section>

        <Section icon="✏️" title="Posting & replying">
          Type in the box at the bottom to post a message. Hover over any message to reply in a thread, add a reaction, or pin it. You can edit or delete your own messages from the same hover menu.
        </Section>

        <Section icon="@" title="Mentions">
          Type @ to mention someone. Start typing their name and pick them from the list. They will get an alert so they know to check the message. Instructors can also use @everyone to notify the whole cohort at once.
        </Section>

        <Section icon="🎓" title="Reaching the instructor">
          To get Dr. Mayfield's attention, type @mark, @dr. mayfield, or @dr. mark mayfield in your message. He gets an email notification so your question reaches him even when he is not in the chat. Use this when you need him specifically rather than the whole group.
        </Section>

        <Section icon="📝" title="Turning in assignments">
          Every assignment goes straight to Dr. Mayfield by email. No portal, no upload button, no login screen hiding somewhere. Just send your work to <a href="mailto:dr.mark.mayfield@gmail.com" style={{ color: '#3a55d9', textDecoration: 'underline' }}>dr.mark.mayfield@gmail.com</a> and you are done.
        </Section>

        <Section icon="🛟" title="Tech help & support">
          Need help with the chat or having a technical issue? Type @support or @help in any channel. That sends the message straight to our support inbox so we can jump in.
        </Section>

        <Section icon="🔔" title="Notifications">
          When someone mentions you, you will see a red @ badge on the channel and get a browser notification, even if you are on another channel. Unread messages show a blue number on the channel name.
        </Section>

        <Section icon="🔍" title="Searching messages">
          Looking for something said earlier? Click the search icon at the top right of any channel and type a word or phrase to find past messages in that channel.
        </Section>

        <Section icon="🔗" title="Links and email addresses">
          Drop a link or an email address into a message and it turns clickable on its own. A link opens in a new tab. An email address opens someone's inbox with a message ready to write. No extra formatting, no copy and paste. Just type it and go.
        </Section>

        <Section icon="🔑" title="Your account">
          Your email is your account. Sign in with the same email on your phone, laptop, or anywhere else, and you are the same you, with your same name and history. No second account to set up, no juggling logins. One email, everywhere.
        </Section>

        <Section icon="📎" title="Sharing files">
          Use the attachment button in the message box to share images, PDFs, and other files with the cohort.
        </Section>

        <Section icon="🙋" title="Need help?">
          For course questions, post in the General channel. For anything technical or if something is not working, type @support or @help and we will get right on it. Welcome aboard.
        </Section>
      </div>
    </div>
  );
}

// Lightweight in-channel search using channel.search().
function ChannelSearchPanel({ channel, onJumpInfo }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    // reset when channel changes
    setQuery(''); setResults([]); setSearched(false); setOpen(false);
  }, [channel?.id]);

  async function runSearch(q) {
    if (!q || !q.trim() || !channel) { setResults([]); setSearched(false); return; }
    setSearching(true);
    try {
      const resp = await channel.search(q.trim(), { limit: 25 });
      setResults(resp.results || []);
      setSearched(true);
    } catch (e) {
      setResults([]); setSearched(true);
    }
    setSearching(false);
  }

  let timer = useRef(null);
  function onChange(v) {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(v), 350);
  }

  return (
    <div style={{ position: 'relative', fontFamily: "'DM Sans', sans-serif" }}>
      <button onClick={() => setOpen(o => !o)} title="Search this channel"
        style={{ background: open ? '#f1f4fe' : '#ffffff', border: open ? '1px solid #c9d4f5' : '1px solid #e7e9f0', cursor: 'pointer', fontSize: 15, width: 38, height: 38, borderRadius: 10, color: open ? '#3a55d9' : '#686e7e', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(24,27,38,0.05)', transition: 'all 0.16s ease' }}
        onMouseEnter={e => { if (!open) { e.currentTarget.style.background = '#f1f4fe'; e.currentTarget.style.borderColor = '#c9d4f5'; e.currentTarget.style.color = '#3a55d9'; } }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.borderColor = '#e7e9f0'; e.currentTarget.style.color = '#686e7e'; } }}>
        🔍
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 40, right: 0, width: 340, maxWidth: '80vw', background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.16)', zIndex: 400, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
            <input ref={inputRef} value={query} onChange={e => onChange(e.target.value)} placeholder="Search messages in this channel..."
              style={{ ...inputStyle, background: '#fafafa' }} />
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {searching && <div style={{ padding: '18px 16px', fontSize: 13, color: '#999' }}>Searching...</div>}
            {!searching && searched && results.length === 0 && (
              <div style={{ padding: '18px 16px', fontSize: 13, color: '#999' }}>No messages found.</div>
            )}
            {!searching && results.map((r, i) => {
              const m = r.message || r;
              const u = m.user || {};
              const name = u.name || u.id || 'Member';
              return (
                <div key={m.id || i} style={{ padding: '10px 14px', borderBottom: '1px solid #f6f6f6', display: 'flex', gap: 10 }}>
                  <Avatar name={name} color={u.color} size={26} image={u.image} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                      <span style={{ fontSize: 10, color: '#bbb', whiteSpace: 'nowrap' }}>{m.created_at ? new Date(m.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#555', lineHeight: 1.45, wordBreak: 'break-word' }}>{m.text}</div>
                  </div>
                </div>
              );
            })}
            {!searched && !searching && (
              <div style={{ padding: '18px 16px', fontSize: 12.5, color: '#bbb', lineHeight: 1.5 }}>
                Type to search everything posted in this channel.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getStoredProfile() {
  try { return JSON.parse(localStorage.getItem('cats_profile') || 'null'); } catch { return null; }
}
function storeProfile(p) {
  try { localStorage.setItem('cats_profile', JSON.stringify(p)); } catch {}
}

// Custom thread header with a clear, pronounced close control (Stream's default
// close button is faint and hard to find, on mobile and desktop). closeThread is
// passed in by Stream's Thread component.
function CatsThreadHeader({ closeThread, thread, onClose }) {
  const parentText = (thread && thread.text) ? thread.text : '';
  const preview = parentText.length > 48 ? parentText.slice(0, 48) + '…' : parentText;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #eef0f5', background: '#fff', fontFamily: "'DM Sans', sans-serif" }}>
      <button
        onClick={event => {
          if (onClose) onClose();
          if (closeThread) closeThread(event);
        }}
        title="Close thread"
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f1f4fe', color: '#3a55d9', border: '1px solid #d9e1fb', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '7px 12px 7px 9px', borderRadius: 9, fontFamily: "'DM Sans', sans-serif", flexShrink: 0, boxShadow: '0 1px 2px rgba(58,85,217,0.08)' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#e6ecfd'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#f1f4fe'; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>
        Back
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#181b26' }}>Thread</div>
        {preview && <div style={{ fontSize: 11.5, color: '#969cac', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</div>}
      </div>
    </div>
  );
}

// v62 SOURCE CANDIDATE.
// Mounted inside <Channel>, so this component can access openThread through
// ChannelActionContext. It waits until the requested channel is active, fetches
// the parent message through a REST request, and opens the existing Thread UI.
// It does not watch an additional channel.
function ThreadJumpHandler({
  pendingThread,
  activeId,
  channel,
  onOpened,
  onFailed,
}) {
  const { openThread } = useChannelActionContext('ThreadJumpHandler');

  useEffect(() => {
    if (
      !pendingThread ||
      !channel ||
      pendingThread.channelId !== activeId
    ) {
      return;
    }

    let cancelled = false;

    console.log('[CATS THREAD DIAG] thread jump attempted', {
      channelId: pendingThread.channelId,
      threadId: pendingThread.threadId,
    });

    (async () => {
      try {
        const resp = await channel.getMessagesById([
          pendingThread.threadId,
        ]);

        const msg =
          resp &&
          resp.messages &&
          resp.messages[0];

        if (cancelled) return;

        if (!msg) {
          console.warn(
            '[CATS THREAD DIAG] thread jump failed: parent message not found',
            pendingThread.threadId
          );

          onFailed(pendingThread.threadId);
          return;
        }

        if (!openThread) {
          console.warn(
            '[CATS THREAD DIAG] thread jump failed: openThread unavailable'
          );

          onFailed(pendingThread.threadId);
          return;
        }

        openThread(msg);

        if (cancelled) return;

        onOpened(pendingThread.threadId);

        try {
          await channel.markRead({
            thread_id: pendingThread.threadId,
          });

          console.log(
            '[CATS THREAD DIAG] thread marked read',
            pendingThread.threadId
          );
        } catch (e) {
          console.warn(
            '[CATS THREAD DIAG] markRead failed',
            pendingThread.threadId,
            e.message
          );
        }
      } catch (e) {
        if (cancelled) return;

        console.warn(
          '[CATS THREAD DIAG] thread jump failed',
          e.message
        );

        onFailed(pendingThread.threadId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    pendingThread,
    channel,
    activeId,
    openThread,
    onOpened,
    onFailed,
  ]);

  return null;
}

// v62 SOURCE CANDIDATE — correction.
// Mounted inside <Channel>, alongside ThreadJumpHandler. Stream's own
// ChannelStateContext.thread is the single central signal for "which thread is
// currently open," updated identically regardless of whether the thread was
// opened via the bell (ThreadJumpHandler -> openThread) or a native
// reply-count click (useOpenThreadHandler -> openThread). Watching it here
// means the notification-clearing logic works for both paths without
// attaching a separate handler to every message or reply-count control.
function ActiveThreadWatcher({ setThreadNotes, setOpenThreadId, threadNotesRef, channel }) {
  const { thread } = useChannelStateContext('ActiveThreadWatcher');
  const threadId = thread ? thread.id : null;

  useEffect(() => {
    setOpenThreadId(threadId);

    if (threadId && threadNotesRef.current[threadId]) {
      removeThreadNote(setThreadNotes, threadId);

      if (channel) {
        channel.markRead({ thread_id: threadId }).catch(e => {
          console.warn(
            '[CATS THREAD DIAG] markRead (native open) failed',
            e.message
          );
        });
      }
    }
  }, [threadId, channel, setThreadNotes, setOpenThreadId, threadNotesRef]);

  return null;
}

// v62 SOURCE CANDIDATE.
// Minimal thread-reply notification surface. This is not a general notification
// center.
function ThreadNoteBell({ notes, onSelect }) {
  const [open, setOpen] = useState(false);

  const list = Object.values(notes).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const count = list.length;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(current => !current)}
        title="Thread replies"
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          border: '1px solid #e7e9f0',
          background: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          boxShadow: '0 1px 2px rgba(24,27,38,0.06)',
        }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#5f6478"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {count > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: '#c0392b',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 9,
              minWidth: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            width: 280,
            maxHeight: 320,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e7e9f0',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(24,27,38,0.14)',
            zIndex: 30,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {count === 0 && (
            <div
              style={{
                padding: 16,
                fontSize: 12.5,
                color: '#969cac',
              }}
            >
              No new thread replies.
            </div>
          )}

          {list.map(note => (
            <button
              key={note.threadId}
              onClick={() => {
                onSelect(note);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                border: 'none',
                borderBottom: '1px solid #f1f2f6',
                background: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={event => {
                event.currentTarget.style.background = '#f7f8fc';
              }}
              onMouseLeave={event => {
                event.currentTarget.style.background = 'none';
              }}
            >
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: '#181b26',
                }}
              >
                {note.replierName} replied
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: '#969cac',
                  margin: '1px 0',
                }}
              >
                in{' '}
                {(ALL_CHANNELS.find(
                  channel => channel.id === note.channelId
                ) || {}).name || note.channelId}
              </div>

              <div
                style={{
                  fontSize: 11.5,
                  color: '#969cac',
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {note.preview || '(no preview)'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// v63 SOURCE CANDIDATE — Welcome Back summary.
//
// A deterministic navigation summary, not an AI-generated one. ATLAS presents it; the
// content is entirely existing Stream Chat data (channel unread counts, thread notes)
// run through fixed rules. No message bodies, attachments, images, links, rich text,
// reactions, or file names are ever rendered here, only channel names, unread counts,
// replier names, and an already-truncated plain-text preview.
//
// Real dialog semantics (role, aria-modal, focus trap, Escape, initial focus, focus
// restore) are implemented directly here since no accessible dialog pattern exists
// elsewhere in this codebase to reuse, and adding a dependency for one dialog isn't
// warranted.
function WelcomeBackSummary({ recap, firstName, onSelectChannel, onSelectThread, onDismiss, isMobile }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    if (closeButtonRef.current) closeButtonRef.current.focus();
    return () => {
      if (previouslyFocusedRef.current && previouslyFocusedRef.current.focus) {
        try { previouslyFocusedRef.current.focus(); } catch (e) {}
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  const totalUnread = recap.channelItems.reduce((sum, item) => sum + item.unreadCount, 0);
  const channelCount = recap.channelItems.length;
  const threadCount = recap.threadItems.length;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1150, fontFamily: "'DM Sans', sans-serif", padding: 16 }}
      onClick={onDismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-back-heading"
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, padding: isMobile ? '22px 22px 22px' : '26px 28px 24px', width: isMobile ? 440 : 520, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', position: 'relative' }}
      >
        <button
          ref={closeButtonRef}
          onClick={onDismiss}
          aria-label="Close"
          title="Close"
          style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#aaa', lineHeight: 1, padding: 4, zIndex: 2 }}
        >
          ×
        </button>

        {/* Guide header. ATLAS speaks from the left; on desktop his hero image is
            anchored to the right so the raised arm points back toward the message.
            On mobile the arrangement stacks with the image centered on top. The
            transparent asset sits directly on the dialog, not inside an icon box. */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', gap: isMobile ? 4 : 6, marginBottom: 18 }}>
          <div style={{ order: isMobile ? 2 : 1, flex: 1, minWidth: 0, textAlign: isMobile ? 'center' : 'left' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#3a55d9', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 6 }}>
              {ASSISTANT_CONFIG.name}
            </div>
            <div id="welcome-back-heading" style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.25, marginBottom: 8 }}>
              {ASSISTANT_CONFIG.welcomeBackGreeting(firstName)}
            </div>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.55 }}>
              {ASSISTANT_CONFIG.welcomeBackIntro}
            </div>
          </div>
          {/* Desktop: ATLAS is enlarged and leans into the hero area (negative left
              margin) so his raised arm reaches toward the welcome copy, reading as a
              present guide rather than an icon parked in empty space. Mobile size is
              unchanged. */}
          <div style={{ order: isMobile ? 1 : 2, width: isMobile ? 132 : 188, flexShrink: 0, marginLeft: isMobile ? 0 : -14, marginRight: isMobile ? 0 : -4, marginBottom: isMobile ? 0 : -2 }}>
            {!imgFailed ? (
              <img
                src={ASSISTANT_CONFIG.heroImageSrc}
                alt={ASSISTANT_CONFIG.heroImageAlt}
                onError={() => setImgFailed(true)}
                style={{ width: '100%', height: 'auto', objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <div style={{ width: '100%', paddingBottom: '100%', borderRadius: '50%', background: '#f1f4fe' }} aria-hidden="true" />
            )}
          </div>
        </div>

        {/* Recap body. v63 intentionally ships exactly two activity sections: unread
            channel messages, then unread thread replies. Each is a self-contained,
            independently-conditional block, so v63.1 sections (New from Mark, org
            announcements, release notes, new features, resources, upcoming events,
            recommended next steps) slot in here as sibling blocks between the activity
            sections and the "Continue to chat" action, without restructuring this
            component. No section framework is abstracted ahead of that need. */}
        {channelCount > 0 && (
          <div style={{ fontSize: 12.5, color: '#555', marginBottom: 8 }}>
            <strong>{totalUnread}</strong> unread {totalUnread === 1 ? 'message' : 'messages'} across <strong>{channelCount}</strong> {channelCount === 1 ? 'channel' : 'channels'}
          </div>
        )}
        {threadCount > 0 && (
          <div style={{ fontSize: 12.5, color: '#555', marginBottom: 16 }}>
            <strong>{threadCount}</strong> {threadCount === 1 ? 'reply' : 'replies'} in {threadCount === 1 ? 'a thread' : 'threads'} you started
          </div>
        )}

        {channelCount > 0 && (
          <div style={{ marginBottom: threadCount > 0 ? 14 : 4 }}>
            {recap.channelItems.map(item => (
              <button
                key={item.channelId}
                onClick={() => onSelectChannel(item.channelId)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 12px', marginBottom: 4, border: '1px solid #eef0f5', background: '#fafbfd', borderRadius: 9, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans', sans-serif" }}
              >
                <span style={{ fontSize: 13, color: '#181b26', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.channelName}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#3a55d9', background: '#eef1fd', borderRadius: 10, padding: '2px 8px', flexShrink: 0, marginLeft: 8 }}>
                  {item.unreadCount > 99 ? '99+' : item.unreadCount}
                </span>
              </button>
            ))}
          </div>
        )}

        {threadCount > 0 && (
          <div style={{ marginBottom: 6 }}>
            {recap.threadItems.map(item => {
              const chDef = ALL_CHANNELS.find(c => c.id === item.channelId);
              const preview = item.preview.length > 60 ? item.preview.slice(0, 60) + '…' : item.preview;
              return (
                <button
                  key={item.threadId}
                  onClick={() => onSelectThread(item)}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', marginBottom: 4, border: '1px solid #eef0f5', background: '#fafbfd', borderRadius: 9, cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans', sans-serif" }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#181b26' }}>
                    {item.replierName} replied {chDef ? `in ${chDef.name}` : ''}
                  </div>
                  {preview && (
                    <div style={{ fontSize: 11.5, color: '#969cac', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preview}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* v63.1 SECTION INSERTION POINT — future non-activity sections render here,
            as sibling blocks above the Continue action. Not implemented in v63. */}

        <button
          onClick={onDismiss}
          style={{ width: '100%', padding: '11px', marginTop: 8, fontSize: 13, fontWeight: 600, background: 'linear-gradient(135deg,#3a55d9,#2f44b8)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          Continue to chat
        </button>
      </div>
    </div>
  );
}

function App() {
  const [chatClient, setChatClient] = useState(null);
  const [channelMap, setChannelMap] = useState({});
  const [activeId, setActiveId] = useState(getInitialChannelId);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [mentionCounts, setMentionCounts] = useState({});
  const [rosterMembers, setRosterMembers] = useState([]);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Thread reply notifications (v62), live in production.
  const [threadNotes, setThreadNotes] = useState({});
  const [pendingThread, setPendingThread] = useState(null);
  const [openThreadId, setOpenThreadId] = useState(null);
  // v63 SOURCE CANDIDATE — Welcome Back summary.
  // Two independent "is this data ready" signals the recap waits on before it may ever
  // appear. Both fail open (set true even on failure) so a broken data source degrades
  // the recap rather than blocking chat entirely.
  const [channelUnreadReady, setChannelUnreadReady] = useState(false);
  const [threadRecoveryReady, setThreadRecoveryReady] = useState(false);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  useEffect(() => {
    window.__catsWBTrace = window.__catsWBTrace || [];
    window.__catsWBTrace.push({ t: Date.now(), showWelcomeBack });
  }, [showWelcomeBack]);
  const clientRef = useRef(null);
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const openThreadIdRef = useRef(null);
  useEffect(() => {
    openThreadIdRef.current = openThreadId;
  }, [openThreadId]);

  // v62 SOURCE CANDIDATE — correction. Lets ActiveThreadWatcher read the
  // latest threadNotes without needing it in its effect dependency array.
  const threadNotesRef = useRef({});
  useEffect(() => {
    threadNotesRef.current = threadNotes;
  }, [threadNotes]);

  // v63 SOURCE CANDIDATE — Welcome Back summary.
  // Snapshots currentUser.welcomed the FIRST time currentUser is known this page load,
  // before dismissWelcome() could flip it to true later in this same session. Read-only
  // use of the existing flag; does not change how or when it's written. This is what
  // stops a brand-new user from being told "welcome back" moments after finishing their
  // first WelcomeCard in the same visit.
  const wasReturningUserRef = useRef(null);
  useEffect(() => {
    if (wasReturningUserRef.current === null && currentUser) {
      wasReturningUserRef.current = !!currentUser.welcomed;
    }
  }, [currentUser]);

  const threadListenersRef = useRef([]);

  function teardownThreadListeners() {
    threadListenersRef.current.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch (e) {
        console.warn(
          '[CATS THREAD DIAG] listener cleanup failed',
          e.message
        );
      }
    });

    threadListenersRef.current = [];
  }

  useEffect(() => {
    return () => {
      teardownThreadListeners();
    };
  }, []);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const stored = getStoredProfile();
    if (!stored) { setIsSignup(true); setShowProfileForm(true); }
    else if (!stored.email) {
      // Existing pre-email profile: ask them to add an email once. Treated as signup so
      // identity is rederived from the email and connects on the stable ID. Their name
      // and color are pre-filled, so it is a quick confirm, not a rebuild.
      setIsSignup(true); setShowProfileForm(true);
    }
    else { setCurrentUser(stored); connectChat(stored); }
  }, []);

  async function connectChat(profile) {
    try {
      const res = await fetch(`${APP_CONFIG.tokenUrl}?user_id=${encodeURIComponent(profile.id)}`);
      const data = await res.json();
      if (!data.token) throw new Error('Token not returned.');
      const client = StreamChat.getInstance(APP_CONFIG.apiKey);
      clientRef.current = client;
      await client.connectUser({ id: profile.id, name: profile.name, color: profile.color, image: profile.image || undefined, bio: profile.bio || '', link: profile.link || '', instructor: !!profile.instructor }, data.token);

      const initialId = getInitialChannelId();
      const initialChDef = ALL_CHANNELS.find(c => c.id === initialId) || ALL_CHANNELS.find(c => c.id === 'cats-general');

      // OPTION A architecture (persistent unread/mention fix):
      // Watching a channel makes you a "present watcher", and Stream's server then
      // auto-advances your read pointer when a message arrives there, which wipes unread
      // mentions. So we DON'T watch every channel. Instead:
      //   1. queryChannels with watch:false loads all channels' state + read data and
      //      establishes membership, WITHOUT making us a present watcher (so unread
      //      mentions persist across sessions).
      //   2. We watch ONLY the active channel (read-on-receipt there is correct, you're
      //      viewing it).
      //   3. Live badges/sounds for non-active channels come from notification.message_new
      //      (fires for member channels you are not watching).
      const allIds = ALL_CHANNELS.map(c => c.id);
      const map = {};
      try {
        const queried = await client.queryChannels(
          { type: 'messaging', id: { $in: allIds } },
          { last_message_at: -1 },
          { watch: false, state: true, presence: false, limit: 30 }
        );
        // The query above is already constrained to an explicit ID allowlist, so in normal
        // operation this removes nothing. It enforces the same invariant client-side as
        // defense in depth, and it is the shared helper the QA invisibility tests exercise,
        // so those tests prove THIS path rather than a parallel copy of the logic.
        retainConfiguredChannels(queried).forEach(ch => { map[ch.id] = ch; });
      } catch (e) {
        // fall through; we'll at least set up the active channel below
      }

      // Ensure every cohort channel exists in the map AND the user is a member (membership
      // is what makes notification.message_new fire for channels they aren't watching).
      for (const chDef of ALL_CHANNELS) {
        let ch = map[chDef.id];
        if (!ch) {
          ch = client.channel('messaging', chDef.id, { name: chDef.name, members: [profile.id] });
          map[chDef.id] = ch;
        }
        // Add self as member if not already one (no-op if already a member).
        const isMember = ch.state && ch.state.members && ch.state.members[profile.id];
        if (!isMember) {
          try { await ch.addMembers([profile.id]); } catch (e) {}
        }
      }

      // Watch ONLY the active channel (live message.new + presence for who's-online there).
      try {
        const activeCh = map[initialChDef.id] || client.channel('messaging', initialChDef.id, { name: initialChDef.name, members: [profile.id] });
        await activeCh.watch({ presence: true });
        map[initialChDef.id] = activeCh;
      } catch (e) {}

      setChatClient(client);
      setChannelMap(map);
      setActiveId(initialChDef.id);

      // Seed badges from Stream's server-side read state, so users see everything they
      // missed since their LAST session, not just messages that arrive while connected.
      // countUnread()/countUnreadMentions() require read_events enabled on the channel type.
      try {
        const seededUnread = {};
        const seededMentions = {};
        ALL_CHANNELS.forEach((chDef) => {
          const ch = map[chDef.id];
          if (!ch) return;
          const u = ch.countUnread();
          const m = ch.countUnreadMentions();
          if (u > 0 || m > 0) {
            console.log('[CATS DIAG seed]', chDef.id, '| unread:', u, '| mentions:', m);
          }
          if (u > 0) seededUnread[chDef.id] = u;
          if (m > 0) seededMentions[chDef.id] = m;
        });
        console.log('[CATS DIAG seed] result -> unread:', JSON.stringify(seededUnread), '| mentions:', JSON.stringify(seededMentions));
        // Don't show a badge on the channel we're landing in; mark it read instead.
        delete seededUnread[initialChDef.id];
        delete seededMentions[initialChDef.id];
        setUnreadCounts(seededUnread);
        setMentionCounts(seededMentions);
        if (map[initialChDef.id]) { try { await map[initialChDef.id].markRead(); } catch (e) {} }
      } catch (e) {
        // if read state isn't available, fall back to live-only counting
      }
      // v63 SOURCE CANDIDATE: channel unread data has reached a known state (success or
      // fallback) either way, so the Welcome Back recap may now safely read unreadCounts.
      setChannelUnreadReady(true);

      const detectAndAlert = (event, channelLabelMap) => {
        const chId = event.channel_id || event.cid?.replace('messaging:', '');
        if (!chId) return;
        const msg = event.message || {};
        const text = msg.text || '';
        const lower = text.toLowerCase();
        const senderId = msg.user?.id || '';
        const senderName = msg.user?.name || 'Someone';
        const myId = profile.id;
        const myName = (profile.name || '').toLowerCase();
        const myFirst = myName.split(' ')[0];
        if (senderId === myId) return; // don't alert on your own messages

        // If the message lands in the channel the user is currently viewing, mark it read
        // on Stream instead of badging it.
        if (chId === activeIdRef.current) {
          const ch = clientRef.current && clientRef.current.activeChannels
            ? clientRef.current.activeChannels['messaging:' + chId] : null;
          if (ch && ch.markRead) { try { ch.markRead(); } catch (e) {} }
          return;
        }

        // Did this message mention me, or @everyone from an instructor?
        const mentionedMe = (myFirst && lower.includes('@' + myFirst)) || (myName && lower.includes('@' + myName));
        const everyoneByInstructor = lower.includes('@everyone') && canPostAnnouncements(msg.user);
        const isMention = mentionedMe || everyoneByInstructor;

        setUnreadCounts(prev => ({ ...prev, [chId]: (prev[chId] || 0) + 1 }));
        if (isMention) {
          setMentionCounts(prev => ({ ...prev, [chId]: (prev[chId] || 0) + 1 }));
          const chName = (ALL_CHANNELS.find(c => c.id === chId) || {}).name || 'the chat';
          fireMentionAlert(`${senderName} mentioned you`, `In ${chName}: ${text.slice(0, 120)}`);
        }
      };

      client.on('message.new', event => detectAndAlert(event));
      client.on('notification.message_new', event => detectAndAlert(event));
      requestNotificationPermission();

      // v62 SOURCE CANDIDATE — thread reply notifications.
      teardownThreadListeners();

      const handleThreadReply = async event => {
        console.log(
          '[CATS THREAD DIAG] notification.thread_message_new received',
          {
            keys: Object.keys(event || {}),
            channel_id: event.channel_id,
            cid: event.cid,
            parent_id: event.message?.parent_id,
            replier: event.message?.user?.id,
          }
        );

        const reply = event.message || {};
        const parentId = reply.parent_id;

        if (!parentId) {
          console.warn(
            '[CATS THREAD DIAG] no parent_id on event, skipping'
          );
          return;
        }

        const replierId = reply.user?.id;

        if (!replierId || replierId === profile.id) {
          console.log('[CATS THREAD DIAG] rejected: own reply');
          return;
        }

        const channelId =
          event.channel_id ||
          (event.cid || '').replace('messaging:', '');

        if (!channelId) {
          console.warn(
            '[CATS THREAD DIAG] no channel ID on event, skipping'
          );
          return;
        }

        try {
          const probe = clientRef.current.channel(
            'messaging',
            channelId
          );

          const response = await probe.getMessagesById([parentId]);

          const parent =
            response &&
            response.messages &&
            response.messages[0];

          if (!parent) {
            console.warn(
              '[CATS THREAD DIAG] parent lookup returned no message',
              parentId
            );
            return;
          }

          if (parent.user?.id !== profile.id) {
            console.log(
              '[CATS THREAD DIAG] rejected: not my thread',
              {
                parentAuthor: parent.user?.id,
              }
            );
            return;
          }

          console.log(
            '[CATS THREAD DIAG] accepted: notifying',
            {
              threadId: parentId,
              channelId,
            }
          );

          upsertThreadNote(setThreadNotes, {
            threadId: parentId,
            channelId,
            replierName: reply.user?.name || 'Someone',
            replierId,
            preview: (reply.text || '').slice(0, 120),
            // v63 SOURCE CANDIDATE: the reply's own message id, used as the stable
            // identity anchor for the Welcome Back recap signature (not display data).
            latestReplyId: reply.id || null,
            createdAt:
              reply.created_at ||
              new Date().toISOString(),
          });

          if (openThreadIdRef.current !== parentId) {
            const channelName =
              (
                ALL_CHANNELS.find(
                  channel => channel.id === channelId
                ) || {}
              ).name || 'the chat';

            fireMentionAlert(
              `${reply.user?.name || 'Someone'} replied to your thread`,
              `In ${channelName}: ${(reply.text || '').slice(0, 120)}`
            );
          }
        } catch (e) {
          console.warn(
            '[CATS THREAD DIAG] parent lookup failed',
            e.message
          );
        }
      };

      const threadReplySubscription = client.on(
        'notification.thread_message_new',
        handleThreadReply
      );

      threadListenersRef.current.push(() => {
        threadReplySubscription.unsubscribe();
      });

      // Persisted reconciliation.
      //
      // queryThreads() returns Thread objects. Thread state is read through
      // thread.state.getLatestValue(). Direct getters such as thread.id,
      // thread.channel, and thread.ownUnreadCount must be verified against the
      // installed stream-chat version before this hunk is accepted.
      //
      // watch:false is passed explicitly so queryThreads() does not expand the
      // application's one-watched-channel architecture.
      const reconcileThreads = async trigger => {
        try {
          const result = await client.queryThreads({
            watch: false,
            limit: 30,
            participant_limit: 10,
            reply_limit: 1,
          });

          const threads = result.threads || [];

          console.log(
            '[CATS THREAD DIAG] queryThreads result',
            {
              trigger,
              count: threads.length,
            }
          );

          threads.forEach(thread => {
            const unread = thread.ownUnreadCount;

            if (!unread) return;

            const state = thread.state.getLatestValue();
            const parentUserId =
              state.parentMessage?.user?.id;

            if (parentUserId !== profile.id) {
              return;
            }

            const lastReply =
              state.replies && state.replies.length
                ? state.replies[state.replies.length - 1]
                : null;

            const channelObject = thread.channel;

            const channelId = channelObject
              ? (
                  channelObject.id ||
                  (channelObject.cid || '').replace(
                    'messaging:',
                    ''
                  )
                )
              : null;

            if (!channelId) {
              console.warn(
                '[CATS THREAD DIAG] queryThreads thread missing channel ID',
                thread.id
              );
              return;
            }

            console.log(
              '[CATS THREAD DIAG] queryThreads reconciled unread thread',
              {
                threadId: thread.id,
                channelId,
                unread,
              }
            );

            upsertThreadNote(setThreadNotes, {
              threadId: thread.id,
              channelId,
              replierName:
                lastReply?.user?.name || 'Someone',
              replierId: lastReply?.user?.id,
              preview: (lastReply?.text || '').slice(
                0,
                120
              ),
              // v63 SOURCE CANDIDATE: same identity anchor as the live-event path above.
              latestReplyId: lastReply?.id || null,
              createdAt:
                state.updatedAt ||
                new Date().toISOString(),
            });
          });
        } catch (e) {
          console.warn(
            '[CATS THREAD DIAG] queryThreads reconciliation failed',
            trigger,
            e.message
          );
        }
      };

      // v63 SOURCE CANDIDATE: reconcileThreads is intentionally not awaited here (matches
      // the existing fire-and-forget v62 behavior), but .finally() marks thread recovery
      // "settled" either way so the Welcome Back recap knows when it may safely read
      // threadNotes, without ever blocking the rest of connectChat or the chat UI on it.
      reconcileThreads('initial-connect').finally(() => setThreadRecoveryReady(true));

      const recoveredSubscription = client.on(
        'connection.recovered',
        () => reconcileThreads('connection.recovered')
      );

      threadListenersRef.current.push(() => {
        recoveredSubscription.unsubscribe();
      });
    } catch (e) {
      setError('Chat error: ' + e.message);
    }
  }

  async function ensureChannel(id) {
    const chDef = ALL_CHANNELS.find(c => c.id === id);
    if (!chDef || !clientRef.current) return channelMap[id] || null;
    let channel = channelMap[id];
    if (!channel) {
      channel = clientRef.current.channel('messaging', chDef.id, { name: chDef.name, members: [currentUser.id] });
      setChannelMap(prev => ({ ...prev, [id]: channel }));
    }
    // Always ensure the channel we're opening is actively WATCHED (so live messages,
    // including your own, appear in real time). Channels loaded at login via queryChannels
    // are NOT watched, so opening one must watch it now.
    try { await channel.watch({ presence: true }); } catch (e) {}
    return channel;
  }

  async function handleChannelSelect(id) {
    const prevId = activeIdRef.current;
    setActiveId(id);
    setMobileNavOpen(false);
    setUnreadCounts(prev => ({ ...prev, [id]: 0 }));
    setMentionCounts(prev => ({ ...prev, [id]: 0 }));
    if (STATIC_CHANNELS.includes(id)) return;
    const ch = await ensureChannel(id);
    // Persist the read state to Stream so the cleared badge sticks across sessions/devices.
    if (ch) { try { await ch.markRead(); } catch (e) {} }
    // Stop watching the previously-active channel, so only the active channel is watched.
    // (Watching a channel makes Stream auto-advance read state on message arrival, which
    // would wipe unread mentions there. Keeping only the active channel watched preserves
    // unread/mention persistence everywhere else.)
    if (prevId && prevId !== id && !STATIC_CHANNELS.includes(prevId)) {
      const prevCh = channelMap[prevId];
      if (prevCh && prevCh.stopWatching) { try { await prevCh.stopWatching(); } catch (e) {} }
    }
  }

  // v62 SOURCE CANDIDATE.
  // Reuses handleChannelSelect so the previous watched channel is stopped and
  // only the selected channel becomes active.
  function handleThreadNoteClick(note) {
    if (note.channelId !== activeId) {
      handleChannelSelect(note.channelId);
    }

    setPendingThread({
      channelId: note.channelId,
      threadId: note.threadId,
    });
  }

  // v63 SOURCE CANDIDATE — Welcome Back summary.
  //
  // The recap is derived entirely from state v62 already maintains: unreadCounts (seeded
  // from channel.countUnread() in connectChat) and threadNotes (populated by the live
  // notification.thread_message_new handler and by queryThreads({ watch: false })
  // reconciliation). No parallel unread-tracking system, no additional Stream queries, no
  // additional channel ever watched.
  //
  // Empirically verified during v63 planning: channel.countUnread() does NOT include
  // thread replies (tested directly against a live throwaway channel: the count did not
  // move when a thread reply was added on top of an existing unread top-level message).
  // Channel-unread and thread-unread are disjoint counting domains, so they are presented
  // as two separate categories below, never summed into one implied-unique total.
  function computeWelcomeBackRecap() {
    const channelItems = Object.keys(unreadCounts)
      .filter(id => unreadCounts[id] > 0)
      .map(id => {
        const chDef = ALL_CHANNELS.find(c => c.id === id);
        const ch = channelMap[id];
        if (!chDef || !ch) return null; // missing channel name / no longer accessible: skip
        const msgs = (ch.state && ch.state.latestMessages) || [];
        const latest = msgs.length ? msgs[msgs.length - 1] : null;
        return {
          channelId: id,
          channelName: chDef.name,
          unreadCount: unreadCounts[id],
          // The latest message ID in a channel with unreadCount > 0 is reliably part of
          // that unread window: countUnread() counts messages with created_at after the
          // user's read cursor, and the newest message is always at or after that cursor
          // whenever the count is nonzero. Used as recap identity, not display data.
          latestRelevantMessageId: latest ? latest.id : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.channelId.localeCompare(b.channelId));

    const threadItems = Object.values(threadNotes)
      .map(note => ({
        threadId: note.threadId,
        channelId: note.channelId,
        replierName: note.replierName || 'Someone',
        preview: note.preview || '',
        latestReplyId: note.latestReplyId || null,
      }))
      .sort((a, b) => a.threadId.localeCompare(b.threadId));

    return { channelItems, threadItems };
  }

  const WELCOME_BACK_ACK_KEY = 'cats_welcome_back_ack';

  function readAcknowledgedRecap() {
    try {
      const raw = sessionStorage.getItem(WELCOME_BACK_ACK_KEY);
      if (!raw) return { channels: {}, threads: {} };
      const parsed = JSON.parse(raw);
      return { channels: parsed.channels || {}, threads: parsed.threads || {} };
    } catch (e) {
      return { channels: {}, threads: {} }; // sessionStorage unavailable/throws: fail open
    }
  }

  function writeAcknowledgedRecap(recap) {
    try {
      const channels = {};
      recap.channelItems.forEach(item => { channels[item.channelId] = item.latestRelevantMessageId; });
      const threads = {};
      recap.threadItems.forEach(item => { threads[item.threadId] = item.latestReplyId; });
      // Sorted keys so the stored record is deterministic regardless of iteration order.
      const sortedChannels = {};
      Object.keys(channels).sort().forEach(k => { sortedChannels[k] = channels[k]; });
      const sortedThreads = {};
      Object.keys(threads).sort().forEach(k => { sortedThreads[k] = threads[k]; });
      sessionStorage.setItem(WELCOME_BACK_ACK_KEY, JSON.stringify({ channels: sortedChannels, threads: sortedThreads }));
    } catch (e) {
      // sessionStorage unavailable/throws: fail open. Worst case the recap may reappear
      // more than ideal this session; it never breaks chat.
    }
  }

  // Signature inequality alone is not enough: reading one item shrinks the recap, and
  // that must NOT reopen the dialog. Only a genuinely new channel message id or thread
  // reply id not present in the last acknowledged recap counts as new activity.
  function recapHasNewActivity(recap, acknowledged) {
    const newChannelActivity = recap.channelItems.some(item => (
      !item.latestRelevantMessageId || acknowledged.channels[item.channelId] !== item.latestRelevantMessageId
    ));
    if (newChannelActivity) return true;
    return recap.threadItems.some(item => (
      !item.latestReplyId || acknowledged.threads[item.threadId] !== item.latestReplyId
    ));
  }

  const [welcomeBackRecap, setWelcomeBackRecap] = useState(null);

  useEffect(() => {
    if (!chatClient || !currentUser || showProfileForm) return;
    if (!channelUnreadReady || !threadRecoveryReady) return;
    if (wasReturningUserRef.current !== true) return; // brand-new user this session: never show
    if (showWelcomeBack) return;

    let recap;
    try {
      recap = computeWelcomeBackRecap();
    } catch (e) {
      console.warn('[CATS WELCOME BACK DIAG] recap computation failed', e.message);
      return; // fail open: recap skipped, chat unaffected
    }

    if (!recap.channelItems.length && !recap.threadItems.length) return; // no empty recap

    const acknowledged = readAcknowledgedRecap();
    if (!recapHasNewActivity(recap, acknowledged)) return;

    setWelcomeBackRecap(recap);
    // Acknowledge at presentation time (covers both "dismissed" and "opened an item"),
    // so the remaining, now-smaller recap never reopens the dialog on its own.
    writeAcknowledgedRecap(recap);
    setShowWelcomeBack(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatClient, currentUser, showProfileForm, channelUnreadReady, threadRecoveryReady, unreadCounts, channelMap, threadNotes, showWelcomeBack]);

  function dismissWelcomeBack() {
    setShowWelcomeBack(false);
  }

  function handleWelcomeBackChannelClick(channelId) {
    setShowWelcomeBack(false);
    handleChannelSelect(channelId);
  }

  function handleWelcomeBackThreadClick(threadItem) {
    setShowWelcomeBack(false);
    handleThreadNoteClick({ channelId: threadItem.channelId, threadId: threadItem.threadId });
  }

  useEffect(() => {
    if (activeId) {
      setUnreadCounts(prev => ({ ...prev, [activeId]: 0 }));
      setMentionCounts(prev => ({ ...prev, [activeId]: 0 }));
    }
  }, [activeId]);

  // Keep a roster of members for the mention autocomplete.
  useEffect(() => {
    if (!chatClient) return;
    let cancelled = false;
    const fetchRoster = async () => {
      try {
        const resp = await chatClient.queryUsers({ role: 'user' }, { name: 1 }, { limit: 100 });
        if (!cancelled) setRosterMembers((resp.users || []).filter(u => u && u.id && u.name && u.id !== chatClient.user?.id));
      } catch (e) {}
    };
    fetchRoster();
    const interval = setInterval(fetchRoster, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [chatClient]);

  async function handleProfileSave(profileData) {
    // Identity is derived from the email, so the same email is the same account anywhere.
    const id = await emailToUserId(profileData.email);
    const instructor = isInstructorEmail(profileData.email);
    const prior = getStoredProfile();
    // Preserve whether this person has already seen the welcome card.
    const welcomed = !!(prior && prior.welcomed);
    const profile = { ...profileData, id, instructor, welcomed };
    storeProfile(profile);
    setCurrentUser(profile);
    setShowProfileForm(false);
    if (isSignup) { setIsSignup(false); await connectChat(profile); }
    else if (clientRef.current) {
      // If the email changed the derived ID, reconnect as the new identity.
      if (clientRef.current.user && clientRef.current.user.id !== id) {
        await connectChat(profile);
      } else {
        await clientRef.current.upsertUser({ id: profile.id, name: profile.name, color: profile.color, image: profile.image || undefined, bio: profile.bio || '', link: profile.link || '', instructor });
      }
    }
  }

  // Show the one-time welcome card once the person is connected, if they have not seen it.
  useEffect(() => {
    if (chatClient && currentUser && !currentUser.welcomed && !showProfileForm) {
      setShowWelcome(true);
    }
  }, [chatClient, currentUser, showProfileForm]);

  function dismissWelcome(openGuide) {
    const updated = { ...(currentUser || {}), welcomed: true };
    storeProfile(updated);
    setCurrentUser(updated);
    setShowWelcome(false);
    if (openGuide) handleChannelSelect(GETTING_STARTED_ID);
  }

  if (error) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: '#c00', padding: '2rem', textAlign: 'center' }}>{error}</div>;

  if (showProfileForm) {
    const stored = getStoredProfile();
    const isReturning = !!(stored && stored.firstName && !stored.email);
    return <ProfileForm initial={stored || {}} onSave={handleProfileSave} title={isSignup ? 'Welcome to CATS Program' : 'Edit Your Profile'} subtitle={isSignup ? 'Set up your profile to get started' : 'Update your info anytime'} showIntro={isSignup} isReturning={isReturning} />;
  }

  if (!chatClient || Object.keys(channelMap).length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }}>
        <style>{`@keyframes mhms-pulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
        <div>{[0,1,2].map(i => <span key={i} style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3a55d9', margin: '0 3px', animation: 'mhms-pulse 1.2s infinite', animationDelay: `${i*0.2}s` }} />)}</div>
      </div>
    );
  }

  const activeChannel = channelMap[activeId];

  // Attach real Stream mentions (mentioned_users) when sending, so @name and @everyone
  // register as genuine mentions. This is what makes the orange @ badge fire live AND
  // persist across sessions (Stream's countUnreadMentions only counts real mentions).
  // Our custom autocomplete inserts plain text, so Stream never recorded mentions before.
  const submitWithMentions = async (messageOrText, channelCid, customMessageData, sendOptions) => {
    // Stream's submit passes a message object {text, attachments, mentioned_users, parent, ...}
    const msg = (typeof messageOrText === 'string') ? { text: messageOrText } : (messageOrText || {});
    const text = msg.text || '';
    const lower = text.toLowerCase();
    const ch = activeChannel;
    if (!ch) return;

    const mentionedIds = new Set();

    // Match @name against the roster (longest names first so full names win).
    const roster = (rosterMembers || []).slice().sort((a, b) => (b.name || '').length - (a.name || '').length);
    roster.forEach(u => {
      if (!u || !u.name) return;
      if (lower.includes('@' + u.name.toLowerCase())) mentionedIds.add(u.id);
    });

    // @everyone (instructor only): mention all channel members.
    if (lower.includes('@everyone') && canPostAnnouncements(currentUser)) {
      const members = ch.state && ch.state.members ? Object.keys(ch.state.members) : [];
      members.forEach(id => { if (id !== currentUser?.id) mentionedIds.add(id); });
    }

    const payload = {
      ...msg,
      mentioned_users: Array.from(mentionedIds),
    };
    delete payload.parent; // parent is passed separately below for threads
    try {
      await ch.sendMessage({ ...payload, parent_id: msg.parent?.id }, sendOptions);
    } catch (e) {
      // fall back to a plain send if anything about the mention payload is rejected
      try { await ch.sendMessage({ text }, sendOptions); } catch (e2) {}
    }
  };

  return (
    <div style={{ display: 'flex', height: isMobile ? '100dvh' : '100vh', minHeight: isMobile ? '100dvh' : undefined, fontFamily: "'DM Sans', sans-serif", background: 'radial-gradient(1200px 600px at 80% -10%, #eef1f8 0%, rgba(238,241,248,0) 60%), #e7e9f1', padding: isMobile ? 0 : 14, overflow: 'hidden' }}>
      {showWelcome && <WelcomeCard name={currentUser?.name} onOpenGuide={() => dismissWelcome(true)} onDismiss={() => dismissWelcome(false)} />}
      {showWelcomeBack && welcomeBackRecap && (
        <WelcomeBackSummary
          recap={welcomeBackRecap}
          firstName={(currentUser?.name || '').split(' ')[0]}
          onSelectChannel={handleWelcomeBackChannelClick}
          onSelectThread={handleWelcomeBackThreadClick}
          onDismiss={dismissWelcomeBack}
          isMobile={isMobile}
        />
      )}
      <div style={{ display: 'flex', flex: 1, background: '#fff', borderRadius: isMobile ? 0 : 18, boxShadow: isMobile ? 'none' : '0 24px 60px rgba(24,27,38,0.14)', overflow: 'hidden', border: isMobile ? 'none' : '1px solid rgba(255,255,255,0.6)', minHeight: 0 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap');
        :root{
          --primary-900:#1d2a63;--primary-700:#2f44b8;--primary-600:#3a55d9;--primary-500:#5872ea;--primary-100:#e6ebfb;--primary-50:#f1f4fe;
          --ink-900:#181b26;--ink-700:#383d4b;--ink-500:#686e7e;--ink-400:#969cac;--ink-300:#c4c9d4;
          --line:#e7e9f0;--line-soft:#eef0f5;
          --canvas:#e7e9f1;--sidebar:#f7f8fb;--surface:#ffffff;--raise:#fbfcfe;
          --warm:#e07a5f;--gold:#c98a2b;--gold-100:#f8eed6;--green:#2faa6a;
          --shadow-sm:0 1px 2px rgba(24,27,38,0.05),0 1px 3px rgba(24,27,38,0.04);
          --shadow-md:0 4px 16px rgba(24,27,38,0.07),0 1px 4px rgba(24,27,38,0.05);
          --shadow-lg:0 24px 60px rgba(24,27,38,0.14);
        }
        @keyframes mhms-pulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
        .str-chat{height:100%!important;font-family:'DM Sans',sans-serif!important}
        .str-chat__container{height:100%!important}
        .str-chat__main-panel{height:100%!important}
        .str-chat-channel{height:100%!important}
        .str-chat__channel-header{border-bottom:1px solid var(--line-soft)!important;background:rgba(255,255,255,0.85)!important;backdrop-filter:blur(8px)!important;padding:16px 24px!important;box-shadow:none!important}
        .str-chat__channel-header-title{font-family:'DM Sans',sans-serif!important;font-weight:700!important;font-size:16px!important;color:var(--ink-900)!important;letter-spacing:0.005em!important}
        .str-chat__channel-header-info{font-family:'DM Sans',sans-serif!important;font-size:12px!important;color:var(--ink-400)!important}
        .str-chat__channel-header-menu-button{display:none!important}
        .str-chat__header-hamburger{display:none!important}
        .str-chat__message-input{border-top:none!important;background:transparent!important;padding:0!important;box-shadow:none!important}
        .str-chat__message-textarea-react-host textarea,.str-chat__message-textarea{font-family:'DM Sans',sans-serif!important;font-size:14px!important;border-radius:14px!important;border:1px solid var(--line)!important;background:var(--raise)!important;padding:12px 14px!important;line-height:1.6!important;color:var(--ink-700)!important}
        .str-chat__message-textarea-react-host textarea:focus,.str-chat__message-textarea:focus{border-color:var(--primary-500)!important;background:var(--surface)!important;outline:none!important;box-shadow:0 0 0 4px rgba(58,85,217,0.08)!important}
        .str-chat__list{background:var(--surface)!important;padding:8px 0!important}
        .str-chat__send-button{display:none!important}
        .str-chat__avatar{display:none!important}
        .str-chat__message-sender-name{display:none!important}
        .str-chat__date-separator{display:flex!important;align-items:center!important;padding:16px 18px 12px!important;gap:14px!important}
        .str-chat__date-separator-line{flex:1!important;height:1px!important;background:var(--line-soft)!important;border:none!important}
        .str-chat__date-separator-date{font-family:'DM Sans',sans-serif!important;font-size:11px!important;font-weight:600!important;color:var(--ink-400)!important;letter-spacing:0.04em!important;text-transform:uppercase!important;background:transparent!important;padding:0!important}
        .str-chat__jump-to-latest-message,.str-chat__scroll-to-bottom-button{position:absolute!important;bottom:16px!important;right:20px!important;z-index:50!important}
        .str-chat__scroll-to-bottom-button button,.str-chat__jump-to-latest-message button{background:linear-gradient(135deg,var(--primary-600),var(--primary-700))!important;color:#fff!important;border-radius:20px!important;box-shadow:0 6px 18px rgba(58,85,217,0.32)!important;font-family:'DM Sans',sans-serif!important;border:none!important}
        @media (max-width: 768px){
          .str-chat__channel-header{padding-left:62px!important}
          .cats-wiki{padding-top:64px!important}
          /* On mobile, a thread takes over the full screen instead of splitting it */
          .str-chat__thread{position:fixed!important;inset:0!important;width:100vw!important;max-width:100vw!important;height:100%!important;z-index:1200!important;background:#fff!important;margin:0!important;border-radius:0!important;box-shadow:none!important}
          .str-chat__thread .str-chat__thread-header{padding:16px!important;border-bottom:1px solid #eef0f5!important}
          /* Make sure the main message list isn't hidden behind anything when no thread is open */
          .str-chat__main-panel{width:100%!important}
        }
      `}</style>
      <Sidebar groups={APP_CONFIG.channelGroups} activeId={activeId} onSelect={handleChannelSelect} currentUser={currentUser} chatClient={chatClient} activeChannel={activeChannel} onEditProfile={() => setShowProfileForm(true)} unreadCounts={unreadCounts} mentionCounts={mentionCounts} isMobile={isMobile} mobileNavOpen={mobileNavOpen} onCloseMobileNav={() => setMobileNavOpen(false)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', minHeight: 0, minWidth: 0 }}>
        {/* Persistent live-consult bar, visible across all channels */}
        <a href={APP_CONFIG.consult.link} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, flexShrink: 0, background: 'linear-gradient(135deg, #3a55d9 0%, #2f44b8 100%)', color: '#fff', textDecoration: 'none', fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, padding: '9px 16px', letterSpacing: '0.01em' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isMobile ? 'Live consults · every other week · 6pm MST' : 'Live consultations with Dr. Mayfield, every other week at 6pm MST (7pm CST / 8pm EST / 5pm PST). Full schedule in Getting Started.'}</span>
          <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>Join link</span>
        </a>
        {isMobile && !mobileNavOpen && (
          <button onClick={() => setMobileNavOpen(true)} title="Open menu"
            style={{ position: 'absolute', top: 50, left: 12, zIndex: 70, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, width: 38, height: 38, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <span style={{ width: 16, height: 2, background: '#444', borderRadius: 2 }} />
            <span style={{ width: 16, height: 2, background: '#444', borderRadius: 2 }} />
            <span style={{ width: 16, height: 2, background: '#444', borderRadius: 2 }} />
          </button>
        )}
        {STATIC_CHANNELS.includes(activeId) ? (
          <GettingStartedWiki />
        ) : activeChannel && (
          <Chat client={chatClient} theme="str-chat__theme-light">
            <Channel
              channel={activeChannel}
              EmptyStateIndicator={() => <ChannelEmptyState channelId={activeId} onJump={handleChannelSelect} />}
              ThreadHeader={threadHeaderProps => (
                <CatsThreadHeader
                  {...threadHeaderProps}
                  onClose={() => setOpenThreadId(null)}
                />
              )}
            >
              <Window>
                <div style={{ position: 'relative' }}>
                  <ChannelHeader />
                  <div
                    style={{
                      position: 'absolute',
                      top: 13,
                      right: 24,
                      zIndex: 60,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <ThreadNoteBell
                      notes={threadNotes}
                      onSelect={handleThreadNoteClick}
                    />
                    <ChannelSearchPanel channel={activeChannel} />
                  </div>
                </div>
                <MessageList Message={CustomMessage} disableDateSeparator={false} returnAllReadData={false} />
                <div style={{ position: 'relative' }}>
                  <TypingIndicator />
                  {(activeId !== ANNOUNCEMENTS_ID || canPostAnnouncements(currentUser)) ? (
                  <div style={{ display: 'flex', alignItems: 'flex-end', borderTop: '1px solid #eef0f5', background: '#fff', padding: '10px 16px', gap: 8, position: 'relative' }}>
                    <MentionAutocomplete members={rosterMembers} canMentionEveryone={canPostAnnouncements(currentUser)} />
                    <EmojiButton onEmojiSelect={(emoji) => {
                      const textarea = document.querySelector('.str-chat__message-textarea-react-host textarea, .str-chat__message-textarea');
                      if (textarea) {
                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const before = textarea.value.slice(0, start);
                        const after = textarea.value.slice(end);
                        const newVal = before + emoji + after;
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        setter.call(textarea, newVal);
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        setTimeout(() => { textarea.focus(); textarea.setSelectionRange(start + emoji.length, start + emoji.length); }, 0);
                      }
                    }} />
                    <div style={{ flex: 1 }}>
                      <MessageInput grow={true} minRows={isMobile ? 1 : 5} maxRows={isMobile ? 6 : 12} overrideSubmitHandler={submitWithMentions} />
                    </div>
                    <button title="Send" onClick={() => {
                      const ta = document.querySelector('.str-chat__message-textarea-react-host textarea, .str-chat__message-textarea');
                      if (ta && ta.value.trim()) {
                        ta.focus();
                        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                      }
                    }}
                      style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 11, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#3a55d9,#2f44b8)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(58,85,217,0.32)', alignSelf: 'flex-end', marginBottom: 1, transition: 'transform 0.12s ease' }}
                      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path></svg>
                    </button>
                  </div>
                  ) : (
                    <div style={{ borderTop: '1px solid #ebebeb', background: '#fafafa', padding: '14px 16px', textAlign: 'center', fontSize: 12.5, color: '#999', fontFamily: "'DM Sans', sans-serif" }}>
                      📣 Only the instructor can post in Announcements. Head to General to join the conversation.
                    </div>
                  )}
                  {(activeId !== ANNOUNCEMENTS_ID || canPostAnnouncements(currentUser)) && (
                    <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#969cac', fontFamily: "'DM Sans', sans-serif", padding: '9px 16px 4px', letterSpacing: '0.005em' }}>
                      Type @ to mention someone in the group · @mark or @dr. mark mayfield reaches Dr. Mayfield · @support reaches tech support
                    </div>
                  )}
                </div>
              </Window>
              <Thread
                additionalMessageInputProps={{
                  grow: true,
                  minRows: isMobile ? 1 : 5,
                  maxRows: isMobile ? 6 : 12,
                }}
              />

              <ThreadJumpHandler
                pendingThread={pendingThread}
                activeId={activeId}
                channel={activeChannel}
                onOpened={() => {
                  // Notification clearing and openThreadId are now handled
                  // centrally by ActiveThreadWatcher for both bell-driven and
                  // native thread opens. This callback only needs to clear the
                  // pending cross-channel jump state.
                  setPendingThread(null);
                }}
                onFailed={() => {
                  // Leave the bell notification intact so the user can retry.
                  // Clear only the pending automatic jump to prevent a retry loop.
                  setPendingThread(null);
                }}
              />

              <ActiveThreadWatcher
                setThreadNotes={setThreadNotes}
                setOpenThreadId={setOpenThreadId}
                threadNotesRef={threadNotesRef}
                channel={activeChannel}
              />
            </Channel>
          </Chat>
        )}
      </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
