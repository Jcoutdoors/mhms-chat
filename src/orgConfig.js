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

// Fills {assistant}, {org}, and {community} placeholders. When the assistant is disabled,
// a `copyNeutral[key]` override wins if present; otherwise the assistant intro clause and
// any {assistant} token are stripped so no persona name leaks through.
function resolveCopy(config, key) {
  const org = (config && config.orgName) || 'the community';
  const community = (config && config.communityLabel) || org;
  const fill = (s) => s.replace(/\{org\}/g, org).replace(/\{community\}/g, community);

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

module.exports = { MHMS_ORG_CONFIG, assistantEnabled, assistantAvatarSources, resolveCopy };
