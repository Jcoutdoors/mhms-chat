// Stage 3 Slice 1b — ShellHeader (top UTILITY header) guards. As of the global-shell slice the header is
// no longer the destination switcher (that moved to GlobalSidebar). It provides the sidebar toggle, a
// compact current-area context label, and a secondary Help shortcut — presentation-only, no destination
// navigation, no runtime/auth/state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HEADER = readFileSync(new URL('./shellHeader.jsx', import.meta.url), 'utf8');
const SIDEBAR = readFileSync(new URL('./globalSidebar.jsx', import.meta.url), 'utf8');

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

test('1. ShellHeader is a dedicated exported, presentation-only component', () => {
  assert.ok(/export function ShellHeader\(/.test(HEADER));
  const body = fnBody(HEADER, 'ShellHeader');
  for (const banned of ['useState', 'useEffect', 'usePlatformRuntime', 'createAuthController', 'chatClient', 'runtime']) {
    assert.equal(body.includes(banned), false, `no ${banned}`);
  }
  assert.equal(/platformRuntime|authController|stream-chat|StreamChat/.test(HEADER), false, 'no runtime/auth/Stream import');
});

test('2. the header renders a semantic <header>', () => {
  assert.ok(/<header\b/.test(HEADER));
});

test('3. the header is NOT the destination switcher (no primary destination nav here)', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.equal(/aria-label="Primary"/.test(body), false, 'no primary nav landmark in the header');
  assert.equal(body.includes('config.destinations'), false, 'header does not read the destination list');
  assert.equal(body.includes('onSelectDestination'), false, 'header does not switch destinations');
  assert.equal(body.includes('aria-current'), false, 'no destination active-state in the header');
  // the primary destination navigation lives in the sidebar instead
  assert.ok(/config\.destinations/.test(SIDEBAR) && /aria-current/.test(SIDEBAR), 'GlobalSidebar owns the destination nav');
});

test('4. the sidebar toggle is accessible (label + aria-expanded + aria-controls)', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.ok(/onClick=\{onToggleSidebar\}/.test(body), 'toggle invokes onToggleSidebar');
  assert.ok(/aria-label=\{toggleLabel\}/.test(body), 'toggle has a state-aware accessible name');
  assert.ok(/aria-expanded=\{!!navExpanded\}/.test(body), 'toggle exposes aria-expanded');
  assert.ok(/aria-controls=\{navControlsId\}/.test(body), 'toggle points at the controlled nav');
  assert.ok(/ref=\{toggleRef\}/.test(body), 'toggle accepts a ref so focus can return to it');
});

test('5. the toggle label reflects mobile (open/close) vs desktop (expand/collapse)', () => {
  assert.ok(/isMobile[\s\S]*Close navigation[\s\S]*Open navigation/.test(HEADER), 'mobile open/close labels');
  assert.ok(/Collapse navigation[\s\S]*Expand navigation/.test(HEADER), 'desktop collapse/expand labels');
});

test('6. the header shows a compact current-area context (not clickable nav)', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.ok(/\{activeLabel \|\| orgName\}/.test(body), 'renders the active area label (context, not a switcher)');
});

test('7. a secondary Help shortcut is present and routes to the configured support contact', () => {
  const body = fnBody(HEADER, 'ShellHeader');
  assert.ok(/aria-label="Help"/.test(body), 'Help shortcut present');
  assert.ok(/supportContact \? `mailto:\$\{supportContact\}`/.test(body), 'routes to config.supportContact when present');
});

test('8. the header hardcodes no product/organization branding', () => {
  for (const term of ['Anchor', 'CATS', 'MHMS', 'ATLAS', 'Mental Health', 'Collier']) {
    assert.equal(HEADER.includes(term), false, `no hardcoded "${term}"`);
  }
});

test('9. the header consumes --platform-* theme tokens', () => {
  assert.ok(/var\(--platform-header-background/.test(HEADER), 'header background token');
  assert.ok(/var\(--platform-font-body/.test(HEADER), 'body font token');
});
