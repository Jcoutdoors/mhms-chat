// Stage 2 Slice 4 — HomeDestination guards. Structural (source-scan) tests plus a behavioral
// check of the shared copy resolver. HomeDestination is presentation-only: it must take no
// runtime/client/auth, render one heading + supporting copy + one Community action, and resolve
// org copy through the shared token-fill (no hardcoded org wording, no duplicated templating).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MHMS_ORG_CONFIG, resolveOrgText } from './orgConfig.js';

const HOME = readFileSync(new URL('./homeDestination.jsx', import.meta.url), 'utf8');

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

test('1. HomeDestination exists as a dedicated exported component', () => {
  assert.ok(/export function HomeDestination\(/.test(HOME));
});

test('2. HomeDestination imports no runtime module', () => {
  assert.equal(/from '\.\/platformRuntime'|usePlatformRuntime/.test(HOME), false);
});

test('3. HomeDestination imports no auth controller / auth state', () => {
  assert.equal(/authController|createAuthController|from '\.\/authState'/.test(HOME), false);
});

test('4. HomeDestination hardcodes no organization-specific terms', () => {
  for (const term of ['CATS', 'MHMS', 'Mental Health', 'ATLAS', 'Mayfield', 'Zoom']) {
    assert.equal(HOME.includes(term), false, `no hardcoded "${term}"`);
  }
});

test('5. HomeDestination accepts only the minimal approved props', () => {
  assert.ok(/export function HomeDestination\(\{\s*config,\s*currentUser,\s*onGoToCommunity\s*\}\)/.test(HOME),
    'props are exactly { config, currentUser, onGoToCommunity }');
  const body = fnBody(HOME, 'HomeDestination'); // scope to code, not the doc comment
  for (const banned of ['runtime', 'chatClient', 'channelMap', 'unreadCounts', 'threadNotes', 'controller', 'pendingThread']) {
    assert.equal(body.includes(banned), false, `HomeDestination does not take/use ${banned}`);
  }
});

test('6. HomeDestination renders exactly one <h1>', () => {
  assert.equal((HOME.match(/<h1[\s>]/g) || []).length, 1);
});

test('7. HomeDestination renders supporting copy from config', () => {
  assert.ok(HOME.includes('home.supporting'), 'reads config.home.supporting');
});

test('8. HomeDestination renders exactly one semantic Community action button', () => {
  assert.equal((HOME.match(/<button[\s>]/g) || []).length, 1, 'one button');
  assert.ok(/type="button"/.test(HOME), 'button is type="button"');
  assert.equal(/href=|<a[\s>]/.test(fnBody(HOME, 'HomeDestination')), false, 'no fake link');
});

test('9. the Community action is wired to onGoToCommunity', () => {
  assert.ok(/onClick=\{onGoToCommunity\}/.test(HOME), 'button onClick calls onGoToCommunity');
});

test('10. HomeDestination reads organization configuration (heading + label)', () => {
  assert.ok(HOME.includes('home.heading'), 'reads config.home.heading');
  assert.ok(HOME.includes('home.goToCommunityLabel'), 'reads config.home.goToCommunityLabel');
});

test('11. HomeDestination uses the shared copy resolver, not its own templating', () => {
  assert.ok(/resolveOrgText\(/.test(HOME), 'uses resolveOrgText');
  assert.equal(/\.replace\(\/\\\{/.test(HOME), false, 'no inline token-replacement in HomeDestination');
});

test('12. HomeDestination contains no dashboard/activity/consultation/shell features', () => {
  const body = fnBody(HOME, 'HomeDestination'); // scope to code, not the doc comment
  for (const feature of ['unread', 'consult', 'featured', 'dashboard', 'task', 'learning', 'assistant', 'ShellHeader', 'aria-current', '<nav']) {
    assert.equal(body.includes(feature), false, `no ${feature}`);
  }
});

test('13. resolveOrgText resolves Home copy tokens against org config (behavioral)', () => {
  assert.equal(resolveOrgText(MHMS_ORG_CONFIG, MHMS_ORG_CONFIG.home.heading), 'Welcome to the CATS Community');
  assert.equal(resolveOrgText(MHMS_ORG_CONFIG, MHMS_ORG_CONFIG.home.supporting), MHMS_ORG_CONFIG.home.supporting);
  assert.equal(resolveOrgText(MHMS_ORG_CONFIG, undefined), '', 'non-string resolves to empty');
});
