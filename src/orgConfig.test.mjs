// orgConfig tests (Phase 4A1; expanded 4B2). Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MHMS_ORG_CONFIG, assistantEnabled, assistantAvatarSources, resolveCopy } from './orgConfig.js';

const disabled = { ...MHMS_ORG_CONFIG, assistant: { ...MHMS_ORG_CONFIG.assistant, enabled: false } };

test('MHMS config exposes the required org/assistant fields', () => {
  const c = MHMS_ORG_CONFIG;
  for (const k of ['orgName', 'brandColor', 'logo', 'supportContact', 'assistant', 'copy']) {
    assert.ok(k in c, `missing ${k}`);
  }
  assert.equal(c.assistant.name, 'ATLAS');
  assert.equal(assistantEnabled(c), true);
});

// ---- configured assistant identity ----
test('configured assistant name / image / alt', () => {
  assert.equal(MHMS_ORG_CONFIG.assistant.name, 'ATLAS');
  assert.equal(MHMS_ORG_CONFIG.assistant.avatar, './atlas-hero-transparent.png');
  assert.equal(MHMS_ORG_CONFIG.assistant.avatarFallback, './atlas-hero-white.png');
  assert.ok((MHMS_ORG_CONFIG.assistant.avatarAlt || '').length > 0);
});

test('configured assistant introduction is ATLAS-voiced', () => {
  const intro = resolveCopy(MHMS_ORG_CONFIG, 'assistantIntro');
  assert.ok(intro.includes('ATLAS'), 'assistant name present');
  assert.ok(/get connected/i.test(intro));
  assert.equal(intro.includes('{'), false);
});

// ---- MHMS entry / new / returning copy ----
test('MHMS entry headline uses the community label', () => {
  assert.equal(resolveCopy(MHMS_ORG_CONFIG, 'entryHeadline'), 'Welcome to the CATS Community');
});
test('new-user copy', () => {
  assert.equal(resolveCopy(MHMS_ORG_CONFIG, 'newLabel'), "I'm new here");
  assert.ok(/community profile/i.test(resolveCopy(MHMS_ORG_CONFIG, 'newDescription')));
});
test('returning-user copy', () => {
  assert.equal(resolveCopy(MHMS_ORG_CONFIG, 'returningLabel'), "I've been here before");
  assert.ok(/profile and conversations/i.test(resolveCopy(MHMS_ORG_CONFIG, 'returningDescription')));
});
test('verification copy is human, not technical', () => {
  assert.equal(resolveCopy(MHMS_ORG_CONFIG, 'emailHeadline'), "Let's verify your email");
  assert.equal(resolveCopy(MHMS_ORG_CONFIG, 'codeHeadline'), 'Check your email');
  assert.ok(/six-digit code I sent you/i.test(resolveCopy(MHMS_ORG_CONFIG, 'codeBody')));
  assert.ok(/still be here/i.test(resolveCopy(MHMS_ORG_CONFIG, 'returningReassurance')));
});

// ---- resolveCopy token filling (assistant enabled) ----
test('resolveCopy fills {assistant} and {org} when the assistant is enabled', () => {
  const s = resolveCopy(MHMS_ORG_CONFIG, 'welcome');
  assert.ok(s.includes('ATLAS'), 'assistant name present');
  assert.ok(s.includes('CATS Program'), 'org name present');
  assert.equal(s.includes('{assistant}'), false);
  assert.equal(s.includes('{org}'), false);
});

// ---- assistant-disabled neutral fallback ----
test('assistant-disabled mode drops the persona and introduces no assistant name', () => {
  assert.equal(assistantEnabled(disabled), false);
  const welcome = resolveCopy(disabled, 'welcome');
  assert.equal(welcome.includes('ATLAS'), false, 'no assistant name leaks');
  assert.equal(welcome.includes("Hi, I'm"), false, 'intro clause dropped');
  assert.ok(welcome.includes('CATS Program'), 'org still present');
  const setup = resolveCopy(disabled, 'reconnectedSuccess');
  assert.ok(setup.includes('CATS Program'));
  assert.equal(setup.includes('{'), false);
});

test('assistant-disabled uses neutral voice for voice-sensitive copy', () => {
  assert.equal(resolveCopy(disabled, 'assistantIntro'), '', 'intro fully dropped when disabled');
  const emailBody = resolveCopy(disabled, 'emailBody');
  assert.ok(/We'll send you/i.test(emailBody), 'neutral "We\'ll" voice');
  assert.equal(/I'll send you/i.test(emailBody), false, 'no first-person assistant voice');
  assert.equal(emailBody.includes('ATLAS'), false);
  const codeBody = resolveCopy(disabled, 'codeBody');
  assert.ok(/we sent you/i.test(codeBody));
  assert.equal(codeBody.includes('{'), false);
  // Org-centered copy that has no persona is identical in both modes.
  assert.equal(resolveCopy(disabled, 'entryHeadline'), 'Welcome to the CATS Community');
});

// ---- missing-image / avatar fallback (pure) ----
test('assistantAvatarSources returns ordered candidates, [] when unusable', () => {
  assert.deepEqual(assistantAvatarSources(MHMS_ORG_CONFIG), ['./atlas-hero-transparent.png', './atlas-hero-white.png']);
  assert.deepEqual(assistantAvatarSources(disabled), [], 'disabled -> no avatar container');
  const noAvatar = { ...MHMS_ORG_CONFIG, assistant: { enabled: true, name: 'Nova' } };
  assert.deepEqual(assistantAvatarSources(noAvatar), [], 'no avatar configured -> no container');
  const onlyPrimary = { ...MHMS_ORG_CONFIG, assistant: { enabled: true, name: 'Nova', avatar: 'x.png' } };
  assert.deepEqual(assistantAvatarSources(onlyPrimary), ['x.png']);
});

// ---- white-label / fallbacks ----
test('organization-name fallback when orgName/communityLabel absent', () => {
  const bare = { assistant: { enabled: false }, copy: { entryHeadline: 'Welcome to the {community}', x: 'Join {org} today' } };
  assert.equal(resolveCopy(bare, 'entryHeadline'), 'Welcome to the the community');
  assert.equal(resolveCopy(bare, 'x'), 'Join the community today');
  const org = { assistant: { enabled: false }, orgName: 'Acme', copy: { entryHeadline: 'Welcome to the {community}' } };
  assert.equal(resolveCopy(org, 'entryHeadline'), 'Welcome to the Acme', 'community falls back to orgName');
});

test('white-label: a different assistant name/avatar resolves without ATLAS/MHMS leaking', () => {
  const nova = {
    orgName: 'Acme Cohort', communityLabel: 'Acme Circle', brandColor: '#0a0',
    assistant: { enabled: true, name: 'Nova', avatar: 'nova.png', avatarAlt: 'Nova' },
    copy: { assistantIntro: "I'm {assistant}. I'll help you get connected.", entryHeadline: 'Welcome to the {community}' },
  };
  assert.equal(resolveCopy(nova, 'assistantIntro'), "I'm Nova. I'll help you get connected.");
  assert.equal(resolveCopy(nova, 'entryHeadline'), 'Welcome to the Acme Circle');
  assert.deepEqual(assistantAvatarSources(nova), ['nova.png']);
});

test('assistantEnabled is defensive against malformed config', () => {
  assert.equal(assistantEnabled(null), false);
  assert.equal(assistantEnabled({}), false);
  assert.equal(assistantEnabled({ assistant: {} }), false);
});

test('resolveCopy on an unknown key returns empty string, never throws', () => {
  assert.equal(resolveCopy(MHMS_ORG_CONFIG, 'nope'), '');
});

// ---- reusable components must not hardcode ATLAS/MHMS/CATS ----
test('authComponents.jsx contains no hardcoded ATLAS/MHMS/CATS/org copy', () => {
  const src = readFileSync(new URL('./authComponents.jsx', import.meta.url), 'utf8');
  for (const forbidden of ['ATLAS', 'CATS', 'MHMS', 'Mental Health Made Simple']) {
    assert.equal(src.includes(forbidden), false, `authComponents.jsx must not hardcode "${forbidden}"`);
  }
});
