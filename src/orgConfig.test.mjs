// orgConfig tests (Phase 4A1). Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MHMS_ORG_CONFIG, assistantEnabled, resolveCopy } from './orgConfig.js';

test('MHMS config exposes the required org/assistant fields', () => {
  const c = MHMS_ORG_CONFIG;
  for (const k of ['orgName', 'brandColor', 'logo', 'supportContact', 'assistant', 'copy']) {
    assert.ok(k in c, `missing ${k}`);
  }
  assert.equal(c.assistant.name, 'ATLAS');
  assert.equal(assistantEnabled(c), true);
});

test('resolveCopy fills {assistant} and {org} when the assistant is enabled', () => {
  const s = resolveCopy(MHMS_ORG_CONFIG, 'welcome');
  assert.ok(s.includes('ATLAS'), 'assistant name present');
  assert.ok(s.includes('CATS Program'), 'org name present');
  assert.equal(s.includes('{assistant}'), false);
  assert.equal(s.includes('{org}'), false);
});

test('assistant-disabled mode drops the persona and introduces no assistant name', () => {
  const disabled = { ...MHMS_ORG_CONFIG, assistant: { ...MHMS_ORG_CONFIG.assistant, enabled: false } };
  assert.equal(assistantEnabled(disabled), false);
  const welcome = resolveCopy(disabled, 'welcome');
  assert.equal(welcome.includes('ATLAS'), false, 'no assistant name leaks');
  assert.equal(welcome.includes("Hi, I'm"), false, 'intro clause dropped');
  assert.ok(welcome.includes('CATS Program'), 'org still present');
  // Other copy still resolves org and omits the assistant token.
  const setup = resolveCopy(disabled, 'reconnectedSuccess');
  assert.ok(setup.includes('CATS Program'));
  assert.equal(setup.includes('{'), false);
});

test('assistantEnabled is defensive against malformed config', () => {
  assert.equal(assistantEnabled(null), false);
  assert.equal(assistantEnabled({}), false);
  assert.equal(assistantEnabled({ assistant: {} }), false);
});

test('resolveCopy on an unknown key returns empty string, never throws', () => {
  assert.equal(resolveCopy(MHMS_ORG_CONFIG, 'nope'), '');
});
