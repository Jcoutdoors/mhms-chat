// orgConfig tests (Phase 4A1; expanded 4B2). Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MHMS_ORG_CONFIG, assistantEnabled, assistantAvatarSources, resolveCopy, resolveOrgText } from './orgConfig.js';

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

test('configured assistant welcome is ATLAS-voiced and host-like', () => {
  const intro = resolveCopy(MHMS_ORG_CONFIG, 'assistantIntro');
  assert.ok(/^Hi, I'm ATLAS\./.test(intro), 'host greets in first person');
  assert.ok(/get connected/i.test(intro));
  assert.ok(/right place/i.test(intro), 'offers to guide');
  assert.equal(intro.includes('{'), false);
});

test('entry prompt is host-guided, not the old generic wording', () => {
  const prompt = resolveCopy(MHMS_ORG_CONFIG, 'entryPrompt');
  assert.equal(prompt, 'Is this your first time here, or are you returning?');
  assert.equal(/Are you new here/i.test(prompt), false, 'old generic prompt not used');
  // The prompt is org-neutral, so it survives assistant-disabled unchanged.
  assert.equal(resolveCopy(disabled, 'entryPrompt'), 'Is this your first time here, or are you returning?');
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

// ---- shared organization-token helper (resolveCopy and resolveOrgText share one implementation) ----
test('resolveCopy and resolveOrgText fill {community} identically (single token implementation)', () => {
  // entryHeadline carries {community} and no assistant token, so both paths must agree.
  const raw = MHMS_ORG_CONFIG.copy.entryHeadline; // 'Welcome to the {community}'
  assert.ok(raw.includes('{community}'), 'source string still uses the {community} token');
  assert.equal(resolveCopy(MHMS_ORG_CONFIG, 'entryHeadline'), 'Welcome to the CATS Community');
  assert.equal(resolveOrgText(MHMS_ORG_CONFIG, raw), resolveCopy(MHMS_ORG_CONFIG, 'entryHeadline'));
});

test('resolveCopy and resolveOrgText fill {org} identically (single token implementation)', () => {
  // reconnectedSuccess carries {org} and no assistant token, so both paths must agree.
  const raw = MHMS_ORG_CONFIG.copy.reconnectedSuccess;
  assert.ok(raw.includes('{org}'), 'source string still uses the {org} token');
  assert.equal(resolveOrgText(MHMS_ORG_CONFIG, raw), resolveCopy(MHMS_ORG_CONFIG, 'reconnectedSuccess'));
  assert.ok(resolveOrgText(MHMS_ORG_CONFIG, raw).includes('CATS Program'), '{org} resolved to orgName');
});

test('org-token filling shares the same fallbacks across both paths', () => {
  // Missing orgName/communityLabel -> "the community" (community falls back to org) in BOTH paths.
  const bare = { assistant: { enabled: false }, copy: { entryHeadline: 'Welcome to the {community}' } };
  assert.equal(resolveOrgText(bare, 'Welcome to the {community}'), 'Welcome to the the community');
  assert.equal(resolveCopy(bare, 'entryHeadline'), resolveOrgText(bare, 'Welcome to the {community}'));
  const org = { assistant: { enabled: false }, orgName: 'Acme', copy: { entryHeadline: 'Welcome to the {community}' } };
  assert.equal(resolveOrgText(org, 'Welcome to the {community}'), 'Welcome to the Acme');
  assert.equal(resolveCopy(org, 'entryHeadline'), resolveOrgText(org, 'Welcome to the {community}'));
});

test('resolveOrgText returns "" for non-string input (safe optional config)', () => {
  assert.equal(resolveOrgText(MHMS_ORG_CONFIG, undefined), '');
  assert.equal(resolveOrgText(MHMS_ORG_CONFIG, null), '');
  assert.equal(resolveOrgText(MHMS_ORG_CONFIG, 42), '');
  assert.equal(resolveOrgText(null, undefined), '');
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

// ---- host-in-card layout: responsive branch + integrated character ----
const AUTH_SRC = readFileSync(new URL('./authComponents.jsx', import.meta.url), 'utf8');

test('has a responsive layout branch (mobile centered -> side-by-side on wider screens)', () => {
  assert.ok(/@media\s*\(min-width:\s*640px\)/.test(AUTH_SRC), 'a min-width media query switches layout');
  assert.ok(/flex-direction:\s*row/.test(AUTH_SRC), 'side-by-side row layout on wider screens');
  assert.ok(AUTH_SRC.includes('vif-welcome'), 'welcome (host+copy) responsive container present');
});

test('the host scales up on tablet then desktop (co-equal focal point, wider host column)', () => {
  // Tablet enlarges the character and gives it a wider flex-basis column.
  const tablet = AUTH_SRC.slice(AUTH_SRC.indexOf('@media (min-width:640px)'));
  assert.ok(/\.vif-hero-lead\{width:180px;height:180px;margin:0;flex:0 0 180px\}/.test(tablet), 'tablet host ~180px on a widened column');
  // Desktop adds a further scale-up and widens the entry card so copy stays roomy.
  assert.ok(/@media\s*\(min-width:\s*1024px\)/.test(AUTH_SRC), 'a desktop (1024px) prominence branch exists');
  const desktop = AUTH_SRC.slice(AUTH_SRC.indexOf('@media (min-width:1024px)'));
  assert.ok(/\.vif-hero-lead\{width:205px;height:205px;flex:0 0 205px\}/.test(desktop), 'desktop host ~205px');
  assert.ok(/\.vif-shell--wide\{max-width:600px\}/.test(desktop), 'entry card widens on desktop so copy is not cramped');
  assert.ok(AUTH_SRC.includes('vif-shell--wide') && AUTH_SRC.includes('Frame config={config} wide'), 'only the entry Frame opts into the wider shell');
});

test('the character is integrated INSIDE the card, not floating above it', () => {
  // In the entry composition, the card (vif-card) must open before the <Hero ...>
  // character — i.e. the host lives inside the card, never as a sibling above it.
  const entry = AUTH_SRC.slice(AUTH_SRC.indexOf('function EntryChoice'));
  const body = entry.slice(0, entry.indexOf('\n}'));
  const cardAt = body.indexOf('vif-card');
  const heroAt = body.indexOf('<Hero');
  assert.ok(cardAt !== -1 && heroAt !== -1, 'entry uses a card and a Hero');
  assert.ok(cardAt < heroAt, 'card opens before Hero (character is inside the card)');
  // The host sits in the responsive welcome zone shared with the copy.
  assert.ok(body.includes('vif-welcome'), 'host + copy share the responsive welcome container');
});

test('later screens keep a compact integrated host header (not a bare utility form)', () => {
  assert.ok(/function HostHeader/.test(AUTH_SRC), 'a compact host header exists for secondary screens');
  const email = AUTH_SRC.slice(AUTH_SRC.indexOf('function EmailVerification'));
  assert.ok(email.slice(0, email.indexOf('\n}')).includes('HostHeader'), 'email screen uses the host header');
});
