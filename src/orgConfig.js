// Organization / assistant configuration seam (VIF Phase 4A1; expanded 4B2).
//
// The SINGLE place organization-specific onboarding values live. Reusable
// auth/onboarding components must read from an orgConfig object and must NOT
// hardcode "ATLAS", MHMS branding, support details, or organization copy. This
// keeps the platform organization-agnostic (see PLATFORM_BLUEPRINT.md:
// "Configuration Over Customization"; "the platform does not have a built in
// assistant named ATLAS").
//
// This is intentionally a plain-data seam, NOT an admin system: another org
// swaps the object (different assistant, copy, brand, background, or assistant
// disabled). ATLAS is the Mental Health Made Simple *implementation* of the
// reusable assistant identity — not a platform-wide fixed name.
//
// CommonJS so Node tests and webpack consume it unchanged. Pure data + small
// pure helpers; no I/O, no React.

'use strict';

// The Mental Health Made Simple / ATLAS configuration. Copy is intentionally
// generic in structure; org-specific words live here and nowhere else.
const MHMS_ORG_CONFIG = {
  orgName: 'CATS Program',
  orgSubtitle: 'Cohort Community',
  // Shown as the small identity eyebrow above the headline (the umbrella brand the
  // participant is entering). Distinct from orgName so white-label orgs can differ.
  orgTagline: 'Mental Health Made Simple',
  // The community label used in headline copy (may differ from the formal orgName).
  communityLabel: 'CATS Community',
  brandColor: '#3b73d8',
  logo: './atlas-hero-transparent.png',
  logoFallback: './atlas-hero-white.png',
  supportContact: 'jonathan@nexgenrva.com',
  // Background treatment for the auth experience (a calm, brand-tinted wash — no
  // heavy gradients). A white-label org can override or set a flat color.
  authBackground:
    'radial-gradient(1100px 620px at 50% -8%, #e7edfc 0%, rgba(231,237,252,0) 62%), linear-gradient(180deg, #f6f8fd 0%, #eef1f8 100%)',
  assistant: {
    enabled: true,
    name: 'ATLAS',
    avatar: './atlas-hero-transparent.png',
    avatarFallback: './atlas-hero-white.png',
    avatarAlt: 'ATLAS, the Mental Health Made Simple community guide',
  },
  // Copy slots consumed by onboarding UI. `{assistant}`, `{org}`, and `{community}`
  // are filled by resolveCopy so the strings themselves stay org-neutral in structure.
  // Assistant-voiced strings (first person) have neutral equivalents in `copyNeutral`,
  // used when the assistant is disabled.
  copy: {
    // Legacy 4A1/4B1 slots (kept for back-compat with existing consumers/tests).
    welcome: "Hi, I'm {assistant}. I'll help you get connected to the {org} community.",
    entryChoice: 'Are you new here, or returning?',
    newGuidance: 'First time here? Verify your email, then set up your profile to join.',
    returningGuidance: 'Welcome back — just verify the email you used for {org}.',
    verificationGuidance: 'Enter the six-digit code we emailed you.',
    reconnectedSuccess: 'It looks like you already have a {org} profile. We reconnected you.',
    setupGuidance: "Your email is verified. Let's finish setting up your profile.",

    // Phase 4B2 ATLAS experience copy.
    entryHeadline: 'Welcome to the {community}',
    // The host's spoken welcome (first person). Dropped entirely when the assistant is
    // disabled (see copyNeutral). Followed by the prompt the two options answer.
    assistantIntro: "Hi, I'm {assistant}. I'll help you get connected and point you to the right place.",
    entryPrompt: 'Is this your first time here, or are you returning?',
    newLabel: "I'm new here",
    newDescription: 'Verify your email and set up your community profile.',
    returningLabel: "I've been here before",
    returningDescription: 'Verify your email and return to your profile and conversations.',
    emailHeadline: "Let's verify your email",
    emailBody: "Use the email connected to your {org} registration. I'll send you a six-digit code.",
    returningReassurance: 'Your profile, conversations, and place in the community will still be here.',
    codeHeadline: 'Check your email',
    codeBody: 'Enter the six-digit code I sent you.',
    loadingLine: 'Getting things ready…',
    serviceErrorLine: "Something went wrong on our end. Your account is safe — let's try again.",
    sessionExpiredLine: "You've been signed out. For your security, please verify your email again to continue.",
    signingOutLine: 'Signing you out…',
    signOutErrorTitle: "We couldn't finish signing you out",
    signOutErrorBody:
      "You've been disconnected here, but the sign-out didn't complete on our end, so we can't confirm it finished. Please try again. If you refresh, you may still be signed in until it succeeds.",
  },
  // Neutral (assistant-disabled) overrides for voice-sensitive keys only. Keys absent
  // here fall back to `copy` with the assistant token stripped (see resolveCopy).
  copyNeutral: {
    assistantIntro: '',
    emailBody: "Use the email connected to your {org} registration. We'll send you a six-digit code.",
    codeBody: 'Enter the six-digit code we sent you.',
  },
  // Platform Navigation & Home Foundation — Stage 2. Organization-level shell/Home data,
  // kept in this seam so reusable shell components never hardcode org-specific values.
  // `destinations` and `home` are consumed starting in a later slice (Home is not built
  // yet); `home` copy uses the same {org}/{community} tokens resolveCopy already fills.
  destinations: [
    { id: 'home', label: 'Home' },
    { id: 'community', label: 'Community' },
  ],
  home: {
    heading: 'Welcome to the {community}',
    supporting: 'Your cohort home base. Jump into the conversation anytime.',
    goToCommunityLabel: 'Go to Community',
  },
  // Recurring Zoom consultation (migrated from APP_CONFIG in Stage 2 Slice 3 so it has a
  // single organization-level source of truth). Update `dates` each term and `link` if it
  // ever changes. Rendered by the Getting Started card and the persistent consult bar.
  consult: {
    link: 'https://ccu.zoom.us/j/2303075413',
    time: '6pm MST (7pm CST / 8pm EST / 5pm PST)',
    dates: ['Jun 10', 'Jun 24', 'Jul 8', 'Jul 22', 'Aug 5', 'Aug 19'],
  },
};

// Returns true iff the config enables an assistant persona.
function assistantEnabled(config) {
  return !!(config && config.assistant && config.assistant.enabled);
}

// Ordered avatar source candidates for the assistant character, most-preferred first.
// Empty when the assistant is disabled or no avatar is configured — callers must then
// render NO avatar container (no broken image, no empty box). This is the pure core of
// the missing-image fallback (the component tries each source, then renders nothing).
function assistantAvatarSources(config) {
  if (!assistantEnabled(config)) return [];
  const a = config.assistant || {};
  const out = [];
  if (typeof a.avatar === 'string' && a.avatar) out.push(a.avatar);
  if (typeof a.avatarFallback === 'string' && a.avatarFallback && a.avatarFallback !== a.avatar) out.push(a.avatarFallback);
  return out;
}

// The SINGLE implementation of organization-token filling: replaces {org} and {community}
// in a string. Both resolveCopy (for `copy` keys) and resolveOrgText (for arbitrary org
// strings like home.heading) delegate here so token semantics can never diverge. Assistant-
// token handling stays in resolveCopy. Non-strings resolve to '' (safe for optional config).
function fillOrgTokens(config, text) {
  if (typeof text !== 'string') return '';
  const org = (config && config.orgName) || 'the community';
  const community = (config && config.communityLabel) || org;
  return text.replace(/\{org\}/g, org).replace(/\{community\}/g, community);
}

// Fills {assistant}, {org}, and {community} placeholders. When the assistant is disabled,
// a `copyNeutral[key]` override wins if present; otherwise the assistant intro clause and
// any {assistant} token are stripped so no persona name leaks through.
function resolveCopy(config, key) {
  const fill = (s) => fillOrgTokens(config, s);

  if (!assistantEnabled(config)) {
    if (config && config.copyNeutral && typeof config.copyNeutral[key] === 'string') {
      return fill(config.copyNeutral[key]).replace(/\s{2,}/g, ' ').trim();
    }
    const base = config && config.copy && typeof config.copy[key] === 'string' ? config.copy[key] : '';
    const stripped = base.replace(/^\s*Hi, I'm \{assistant\}\.\s*/i, '').replace(/\{assistant\}/g, '');
    return fill(stripped).replace(/\s{2,}/g, ' ').trim();
  }

  const base = config && config.copy && typeof config.copy[key] === 'string' ? config.copy[key] : '';
  const assistant = (config.assistant && config.assistant.name) || 'your guide';
  return fill(base).replace(/\{assistant\}/g, assistant);
}

// Fills {org}/{community} tokens in an arbitrary configured string, for organization strings
// that live OUTSIDE the `copy` map (e.g. home.heading). Delegates to the shared fillOrgTokens
// so it applies the exact same substitution as resolveCopy — callers never duplicate token-
// replacement logic. No assistant-token handling; non-strings resolve to '' (via fillOrgTokens).
function resolveOrgText(config, text) {
  return fillOrgTokens(config, text);
}

module.exports = { MHMS_ORG_CONFIG, assistantEnabled, assistantAvatarSources, resolveCopy, resolveOrgText };
