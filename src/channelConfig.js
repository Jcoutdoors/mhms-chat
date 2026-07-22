// Shared production channel configuration.
//
// This module is the SINGLE SOURCE OF TRUTH for real cohort (production) channel IDs.
// It is consumed by two very different runtimes, which is why it is CommonJS:
//
//   1. src/index.jsx  — bundled by webpack; imports these names via ESM/CJS interop.
//   2. qa-tools/*     — plain Node scripts; `require()` this file directly.
//
// package.json has no "type" field, so a .js file is CommonJS under Node. Authoring this
// as CommonJS lets both consumers read the exact same data with no duplicated list and no
// ESM/CJS friction. Do NOT convert this to ESM without also solving the Node side.
//
// QA SAFETY RULE (see PROJECT_KNOWLEDGE.md, QA Safety Guardrails):
// This file must contain ONLY real cohort channels. Never add a cats-qa-* channel here.
// The QA mutation guard derives its production denylist from this module, so anything
// listed here becomes permanently write-protected for QA tooling — and anything NOT
// listed here is invisible to the normal application's channel-loading path.

const ANNOUNCEMENTS_ID = 'cats-announcements';
const GETTING_STARTED_ID = 'cats-getting-started';

// Static channels render as a wiki page, not a Stream chat feed.
const STATIC_CHANNELS = [GETTING_STARTED_ID];

const CHANNEL_GROUPS = [
  {
    label: 'Start Here',
    channels: [
      { id: 'cats-getting-started', name: '📖 Getting Started' },
      { id: 'cats-announcements', name: '📣 Announcements' },
    ],
  },
  {
    label: 'Course Modules',
    channels: [
      { id: 'cats-mod-01', name: 'Mod 1 · Development & Neuroscience' },
      { id: 'cats-mod-02', name: 'Mod 2 · Attachment Theory' },
      { id: 'cats-mod-03', name: 'Mod 3 · Trauma, ACEs & PTSD' },
      { id: 'cats-mod-04', name: 'Mod 4 · Therapeutic Presence' },
      { id: 'cats-mod-05', name: 'Mod 5 · CBT, DBT & ACT' },
      { id: 'cats-mod-06', name: 'Mod 6 · TF-CBT, EMDR & MI' },
      { id: 'cats-mod-07', name: 'Mod 7 · Crisis Intervention' },
      { id: 'cats-mod-08', name: 'Mod 8 · Family Systems' },
      { id: 'cats-mod-09', name: 'Mod 9 · Identity, Culture & Tech' },
      { id: 'cats-mod-10', name: 'Mod 10 · Supervised Practice' },
    ],
  },
  {
    label: 'Community',
    channels: [
      { id: 'cats-general', name: 'General' },
      { id: 'cats-weekly-wins', name: 'Weekly Wins' },
      { id: 'cats-readings', name: 'Readings & Resources' },
    ],
  },
];

/**
 * Every configured production channel ID, UNFILTERED.
 *
 * Deliberately includes static/getting-started and announcements, which are excluded from
 * other runtime collections. The QA production denylist derives from this, and a denylist
 * that omitted the static channels would leave them unprotected.
 */
function getProductionChannelIds() {
  return CHANNEL_GROUPS.flatMap(g => g.channels).map(c => c.id);
}

const ALL_PRODUCTION_CHANNEL_IDS = getProductionChannelIds();

/**
 * The live (non-static) channel definitions the chat UI actually loads and watches.
 * This is exactly the collection the app previously derived inline as ALL_CHANNELS.
 */
function getLiveChannelDefs() {
  return CHANNEL_GROUPS.flatMap(g => g.channels).filter(c => !STATIC_CHANNELS.includes(c.id));
}

/**
 * THE production channel predicate.
 *
 * This is the shared filtering logic used by BOTH the running application and the QA
 * invisibility tests, so the tests prove the real path rather than a parallel copy.
 */
function isConfiguredProductionChannelId(id) {
  return typeof id === 'string' && ALL_PRODUCTION_CHANNEL_IDS.indexOf(id) !== -1;
}

/**
 * Retain only configured production channels from an arbitrary channel-like collection.
 *
 * The application's channel query is already constrained to an explicit ID allowlist, so in
 * normal operation nothing is removed here. This is defense in depth: it enforces the
 * invariant client-side as well, and gives the invisibility tests a real, shared code path
 * to exercise with a deliberately mixed collection.
 */
function retainConfiguredChannels(channels) {
  return (channels || []).filter(ch => ch && isConfiguredProductionChannelId(ch.id));
}

module.exports = {
  ANNOUNCEMENTS_ID,
  GETTING_STARTED_ID,
  STATIC_CHANNELS,
  CHANNEL_GROUPS,
  ALL_PRODUCTION_CHANNEL_IDS,
  getProductionChannelIds,
  getLiveChannelDefs,
  isConfiguredProductionChannelId,
  retainConfiguredChannels,
};
