// Organization / assistant configuration seam (VIF Phase 4A1).
//
// The SINGLE place organization-specific onboarding values live. Reusable
// auth/onboarding components must read from an orgConfig object and must NOT
// hardcode "ATLAS", MHMS branding, support details, or organization copy. This
// keeps the platform organization-agnostic (see PLATFORM_BLUEPRINT.md:
// "Configuration Over Customization"; "the platform does not have a built in
// assistant named ATLAS").
//
// This is intentionally a plain-data seam, NOT an admin system: another org
// swaps the object (different assistant, copy, brand, or assistant disabled).
//
// CommonJS so Node tests and webpack consume it unchanged. Pure data + small
// pure helpers; no I/O, no React.

'use strict';

// The Mental Health Made Simple / ATLAS configuration. Copy is intentionally
// generic in structure; org-specific words live here and nowhere else.
const MHMS_ORG_CONFIG = {
  orgName: 'CATS Program',
  orgSubtitle: 'Cohort Community',
  brandColor: '#3b73d8',
  logo: './atlas-hero-transparent.png',
  logoFallback: './atlas-hero-white.png',
  supportContact: 'jonathan@nexgenrva.com',
  assistant: {
    enabled: true,
    name: 'ATLAS',
    avatar: './atlas-hero-transparent.png',
    avatarFallback: './atlas-hero-white.png',
    avatarAlt: 'ATLAS',
  },
  // Copy slots consumed by onboarding UI. `{assistant}`/`{org}` are filled by
  // resolveCopy so the strings themselves stay org-neutral in structure.
  copy: {
    welcome: "Hi, I'm {assistant}. I'll help you get connected to the {org} community.",
    entryChoice: 'Are you new here, or returning?',
    newGuidance: "First time here? Verify your email, then set up your profile to join.",
    returningGuidance: 'Welcome back — just verify the email you used for {org}.',
    verificationGuidance: 'Enter the six-digit code we emailed you.',
    reconnectedSuccess: 'It looks like you already have a {org} profile. We reconnected you.',
    setupGuidance: "Your email is verified. Let's finish setting up your profile.",
  },
};

// Returns true iff the config enables an assistant persona.
function assistantEnabled(config) {
  return !!(config && config.assistant && config.assistant.enabled);
}

// Fills {assistant} and {org} placeholders. When the assistant is disabled the
// copy renders in a neutral voice: no assistant name is introduced, and any
// leading "Hi, I'm {assistant}." style greeting collapses to org-only guidance.
function resolveCopy(config, key) {
  const template = config && config.copy && typeof config.copy[key] === 'string' ? config.copy[key] : '';
  const org = (config && config.orgName) || 'the community';
  if (!assistantEnabled(config)) {
    // Neutral mode: drop an introductory assistant clause if present, then strip
    // any remaining {assistant} token so no persona name leaks through.
    const neutral = template.replace(/^\s*Hi, I'm \{assistant\}\.\s*/i, '');
    return neutral.replace(/\{assistant\}/g, '').replace(/\{org\}/g, org).trim();
  }
  const assistant = config.assistant.name || 'your guide';
  return template.replace(/\{assistant\}/g, assistant).replace(/\{org\}/g, org);
}

module.exports = { MHMS_ORG_CONFIG, assistantEnabled, resolveCopy };
