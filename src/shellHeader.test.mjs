// Stage 2 Slice 5 — ShellHeader guards. Structural (source-scan) tests plus a behavioral check of the
// config-driven navigation. ShellHeader is presentation-only platform chrome: organization identity +
// Home/Community navigation whose labels come from config.destinations, with aria-current on the active
// destination, and NO runtime/auth/Stream/profile/logout dependency, NO owned destination state, and NO
// routing/persistence. Body-scoped where a doc comment could otherwise satisfy a check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MHMS_ORG_CONFIG } from './orgConfig.js';

const HEADER = readFileSync(new URL('./shellHeader.jsx', import.meta.url), 'utf8');

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

test('1. ShellHeader exists as a dedicated exported component', () => {
  assert.ok(/export function ShellHeader\(/.test(HEADER));
});

test('2. ShellHeader is presentation-only (no state, no effects, no runtime instantiation)', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  for (const banned of ['useState', 'useReducer', 'useEffect', 'usePlatformRuntime', 'createAuthController']) {
    assert.equal(body.includes(banned), false, `ShellHeader does not use ${banned}`);
  }
});

test('3. ShellHeader imports no runtime/auth/Stream module', () => {
  assert.equal(/platformRuntime|usePlatformRuntime/.test(HEADER), false, 'no runtime');
  assert.equal(/authController|createAuthController|from '\.\/authState'/.test(HEADER), false, 'no auth');
  assert.equal(/stream-chat|StreamChat/.test(HEADER), false, 'no Stream');
});

test('4. ShellHeader accepts only the minimal approved props', () => {
  assert.ok(/export function ShellHeader\(\{\s*config,\s*activeDestination,\s*onSelectDestination\s*\}\)/.test(HEADER),
    'props are exactly { config, activeDestination, onSelectDestination }');
  const body = fnBody(HEADER, 'ShellHeader');
  for (const banned of ['runtime', 'currentUser', 'chatClient', 'channelMap', 'unreadCounts', 'threadNotes', 'controller', 'onLogout', 'onEditProfile']) {
    assert.equal(body.includes(banned), false, `ShellHeader does not take/use ${banned}`);
  }
});

test('5. navigation entries are read from config.destinations', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.ok(/config\.destinations/.test(body), 'reads config.destinations');
  assert.ok(/destinations\.map\(/.test(body), 'renders a control per configured destination');
});

test('6. ShellHeader does not hardcode Home/Community as its navigation source', () => {
  const body = fnBody(HEADER, 'ShellHeader'); // scope to code, not the doc comment
  for (const literal of ["'home'", "'community'", '>Home<', '>Community<', 'Home', 'Community']) {
    assert.equal(body.includes(literal), false, `no hardcoded navigation literal: ${literal}`);
  }
});

test('7. ShellHeader renders a semantic <header>', () => {
  assert.ok(/<header\b/.test(HEADER));
});

test('8. ShellHeader renders a semantic <nav>', () => {
  assert.ok(/<nav\b/.test(HEADER));
});

test('9. the nav has an accessible label', () => {
  assert.ok(/<nav[^>]*aria-label="Primary"/.test(HEADER), 'nav is labelled');
});

test('10. destination controls are semantic buttons (not fake links)', () => {
  assert.ok(/<button\b/.test(HEADER), 'uses <button>');
  assert.ok(/type="button"/.test(HEADER), 'button is type="button"');
  assert.equal(/href=|<a[\s>]|router|Link\b/.test(fnBody(HEADER, 'ShellHeader')), false, 'no fake link / router');
});

test('11. destination labels come from config (d.label), not literals', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.ok(/\{d\.label\}/.test(body), 'renders the configured label');
});

test('12. the active destination exposes aria-current="page"', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.ok(/isActive\s*=\s*d\.id === activeDestination/.test(body), 'active derived from activeDestination');
  assert.ok(/aria-current=\{isActive \? 'page' : undefined\}/.test(body), 'aria-current on active only');
});

test('13. a destination button invokes onSelectDestination with its id', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.ok(/onClick=\{\(\) => onSelectDestination\(d\.id\)\}/.test(body), 'selection reports the destination id');
});

test('14. no URL / href / history / storage behavior exists', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  for (const api of ['href', 'pushState', 'replaceState', 'popstate', 'hashchange', 'localStorage', 'sessionStorage', 'location', 'history']) {
    assert.equal(body.includes(api), false, `no ${api}`);
  }
});

test('15. no profile/logout or account controls exist in the shell header', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  for (const control of ['onLogout', 'onEditProfile', 'logout', 'Sign out', 'Edit profile', 'profile']) {
    assert.equal(body.includes(control), false, `no ${control}`);
  }
});

test('16. ShellHeader hardcodes no organization-specific terms', () => {
  for (const term of ['CATS', 'MHMS', 'Mental Health', 'ATLAS', 'Mayfield']) {
    assert.equal(HEADER.includes(term), false, `no hardcoded "${term}"`);
  }
});

test('17. ShellHeader holds no runtime/client/channel state', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  for (const banned of ['client.on(', 'channelMap', 'unreadCounts', 'mentionCounts', 'threadNotes', 'pendingThread', 'setupChannels']) {
    assert.equal(body.includes(banned), false, `no ${banned}`);
  }
});

test('18. ShellHeader owns no destination state (PlatformShell does)', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.equal(/useState\(/.test(body), false, 'no local destination state');
  assert.ok(/activeDestination/.test(body), 'active destination arrives as a prop');
});

// ---- behavioral: config-driven labels resolve to the approved two destinations ----
test('19. config.destinations supplies exactly the Home and Community labels (behavioral)', () => {
  const labels = MHMS_ORG_CONFIG.destinations.map((d) => d.label);
  assert.deepEqual(MHMS_ORG_CONFIG.destinations.map((d) => d.id), ['home', 'community']);
  assert.deepEqual(labels, ['Home', 'Community']);
});

test('20. destination controls meet the >=44px mobile touch-target minimum', () => {
  // Global box-sizing:border-box means minHeight is the rendered control height. The active/inactive
  // branch shares this style, so both destination buttons get the same minimum.
  const body = fnBody(HEADER, 'ShellHeader');
  const m = body.match(/minHeight:\s*(\d+)/);
  assert.ok(m, 'destination button declares a minHeight');
  assert.ok(Number(m[1]) >= 44, `destination button minHeight >= 44 (found ${m && m[1]})`);
});
