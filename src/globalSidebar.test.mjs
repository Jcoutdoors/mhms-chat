// Stage 3 Slice 1b — GlobalSidebar guards. Structural (source-scan) tests plus behavioral checks of the
// config-driven destination model. GlobalSidebar is the PRIMARY destination navigation: presentation-
// only, config-driven from config.destinations ({id,label,enabled?,icon?}), a labelled <nav> with one
// accessible <button> per enabled destination, aria-current on the active one, accessible names in
// collapsed/icon-only mode, a Help & Support utility, and NO runtime/auth/state/org-hardcoding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MHMS_ORG_CONFIG } from './orgConfig.js';

const SIDEBAR = readFileSync(new URL('./globalSidebar.jsx', import.meta.url), 'utf8');

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

test('1. GlobalSidebar exists as a dedicated exported component', () => {
  assert.ok(/export function GlobalSidebar\(/.test(SIDEBAR));
});

test('2. GlobalSidebar is presentation-only (no state/effects/runtime/auth)', () => {
  const body = fnBody(SIDEBAR, 'GlobalSidebar');
  for (const banned of ['useState', 'useEffect', 'useReducer', 'usePlatformRuntime', 'createAuthController', 'chatClient', 'runtime']) {
    assert.equal(body.includes(banned), false, `no ${banned}`);
  }
  assert.equal(/platformRuntime|authController|stream-chat|StreamChat/.test(SIDEBAR), false, 'no runtime/auth/Stream import');
});

test('3. navigation is a labelled <nav> landmark', () => {
  assert.ok(/<nav[^>]*aria-label="Primary"/.test(SIDEBAR), 'primary nav landmark');
});

test('4. destinations come from config.destinations and are filtered to enabled entries', () => {
  const body = fnBody(SIDEBAR, 'GlobalSidebar');
  assert.ok(/config\.destinations/.test(body), 'reads config.destinations');
  assert.ok(/\.filter\(\(d\) => d && d\.enabled !== false && d\.id\)/.test(body), 'renders only enabled destinations, safely');
  assert.ok(/destinations\.map\(/.test(body), 'one control per enabled destination');
});

test('5. each destination is a semantic button with aria-current on the active one', () => {
  const body = fnBody(SIDEBAR, 'GlobalSidebar');
  assert.ok(/type="button"/.test(body), 'destination controls are buttons');
  assert.ok(/const isActive = d\.id === activeDestination/.test(body), 'active derived from activeDestination');
  assert.ok(/aria-current=\{isActive \? 'page' : undefined\}/.test(body), 'aria-current on active only');
  assert.ok(/onClick=\{\(\) => onSelectDestination\(d\.id\)\}/.test(body), 'selection reports the destination id');
});

test('6. accessible names survive collapsed/icon-only mode', () => {
  const body = fnBody(SIDEBAR, 'GlobalSidebar');
  assert.ok(/aria-label=\{d\.label\}/.test(body), 'each destination button keeps an accessible name');
  assert.ok(/title=\{collapsed \? d\.label : undefined\}/.test(body), 'collapsed mode exposes a tooltip name');
  assert.ok(/\{!collapsed &&/.test(body), 'text label is hidden (not removed from a11y) when collapsed');
});

test('7. a Help & Support utility exists and routes to the configured support contact', () => {
  const body = fnBody(SIDEBAR, 'GlobalSidebar');
  assert.ok(/aria-label="Help & Support"/.test(body), 'Help & Support utility present');
  assert.ok(/supportContact \? `mailto:\$\{supportContact\}`/.test(body), 'routes to config.supportContact when present (safe placeholder)');
});

test('8. organization identity comes from config, and no product/org name is hardcoded', () => {
  const body = fnBody(SIDEBAR, 'GlobalSidebar');
  assert.ok(/config\.orgName/.test(body), 'identity from config.orgName');
  assert.ok(/orgName\.trim\(\)\[0\]/.test(body), 'collapsed mark is the org initial (config-derived, not hardcoded)');
  for (const term of ['Anchor', 'CATS', 'MHMS', 'ATLAS', 'Mental Health', 'Collier']) {
    assert.equal(SIDEBAR.includes(term), false, `no hardcoded "${term}" in reusable sidebar`);
  }
});

test('9. the sidebar consumes --platform-* theme tokens (Light/Dark), not new literal palettes', () => {
  assert.ok(/var\(--platform-sidebar-background/.test(SIDEBAR), 'uses sidebar background token');
  assert.ok(/var\(--platform-sidebar-active/.test(SIDEBAR), 'uses sidebar active token');
  assert.ok(/var\(--platform-font-body/.test(SIDEBAR), 'uses body font token');
});

test('10. the sidebar does not own Community channel navigation', () => {
  for (const banned of ['channelGroups', 'Announcements', 'Getting Started', 'Weekly Wins', 'selectChannel', 'unreadCounts']) {
    assert.equal(SIDEBAR.includes(banned), false, `global sidebar does not include Community-level nav: ${banned}`);
  }
});

// ---- behavioral: config-driven model ----
test('11. production config exposes Home + Community as enabled destinations with icons', () => {
  const ds = MHMS_ORG_CONFIG.destinations;
  assert.deepEqual(ds.map((d) => d.id), ['home', 'community']);
  for (const d of ds) {
    assert.notEqual(d.enabled, false, `${d.id} enabled`);
    assert.equal(typeof d.icon, 'string', `${d.id} has an icon id`);
  }
});

test('12. a disabled destination is safely excluded (no broken navigation)', () => {
  // Mirror the component filter to prove disabled/unsupported entries never render as nav.
  const cfg = { destinations: [
    { id: 'home', label: 'Home', enabled: true },
    { id: 'workspace', label: 'Workspace', enabled: false },
    { id: '', label: 'Broken' },
  ] };
  const rendered = cfg.destinations.filter((d) => d && d.enabled !== false && d.id);
  assert.deepEqual(rendered.map((d) => d.id), ['home'], 'only enabled, id-bearing destinations render');
});
