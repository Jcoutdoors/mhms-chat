// Stage 2 Slice 3 — organization-config migration guards. Proves consultation data has a single
// organization-level source of truth (MHMS_ORG_CONFIG.consult), the minimal future shell/Home
// config exists, the current Community experience is unchanged, and no shell/Home/destination
// feature work leaked in. Mixes data-shape assertions (import) with structural source scans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MHMS_ORG_CONFIG } from './orgConfig.js';

const INDEX = readFileSync(new URL('./index.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('./platformShell.jsx', import.meta.url), 'utf8');
const RUNTIME = readFileSync(new URL('./platformRuntime.js', import.meta.url), 'utf8');
const ROOT_BUNDLE = new URL('../chat.bundle.js', import.meta.url);

// Slice-1 exact consultation values — the migration must preserve these byte-for-byte.
const EXPECTED_CONSULT = {
  link: 'https://ccu.zoom.us/j/2303075413',
  time: '6pm MST (7pm CST / 8pm EST / 5pm PST)',
  dates: ['Jun 10', 'Jun 24', 'Jul 8', 'Jul 22', 'Aug 5', 'Aug 19'],
};

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

test('1. MHMS_ORG_CONFIG.destinations exists as an array', () => {
  assert.ok(Array.isArray(MHMS_ORG_CONFIG.destinations), 'destinations is an array');
});

test('2. destinations contain exactly the Home and Community IDs (in order)', () => {
  assert.deepEqual(MHMS_ORG_CONFIG.destinations.map(d => d.id), ['home', 'community']);
});

test('3. destination labels are nonempty strings', () => {
  for (const d of MHMS_ORG_CONFIG.destinations) {
    assert.equal(typeof d.label, 'string');
    assert.ok(d.label.trim().length > 0, `${d.id} label nonempty`);
  }
});

test('4. MHMS_ORG_CONFIG.home exists', () => {
  assert.ok(MHMS_ORG_CONFIG.home && typeof MHMS_ORG_CONFIG.home === 'object');
});

test('5. home has heading, supporting copy, and goToCommunityLabel (nonempty strings)', () => {
  for (const k of ['heading', 'supporting', 'goToCommunityLabel']) {
    assert.equal(typeof MHMS_ORG_CONFIG.home[k], 'string', `home.${k} is a string`);
    assert.ok(MHMS_ORG_CONFIG.home[k].trim().length > 0, `home.${k} nonempty`);
  }
});

test('6. MHMS_ORG_CONFIG.consult has link, time, and dates', () => {
  const c = MHMS_ORG_CONFIG.consult;
  assert.ok(c && typeof c === 'object');
  assert.equal(typeof c.link, 'string');
  assert.equal(typeof c.time, 'string');
  assert.ok(Array.isArray(c.dates));
});

test('7. consultation data equals the exact current values (no content drift)', () => {
  assert.equal(MHMS_ORG_CONFIG.consult.link, EXPECTED_CONSULT.link);
  assert.equal(MHMS_ORG_CONFIG.consult.time, EXPECTED_CONSULT.time);
  assert.deepEqual(MHMS_ORG_CONFIG.consult.dates, EXPECTED_CONSULT.dates);
});

test('8. APP_CONFIG no longer contains a consult key', () => {
  const appConfig = INDEX.slice(INDEX.indexOf('const APP_CONFIG = {'), INDEX.indexOf('\n};', INDEX.indexOf('const APP_CONFIG = {')));
  assert.equal(/(^|\s)consult:\s*\{/.test(appConfig), false, 'APP_CONFIG has no consult object');
});

test('9. index.jsx has no APP_CONFIG.consult reference', () => {
  assert.equal(/APP_CONFIG\.consult/.test(INDEX), false);
});

test('10. every consultation reader uses the organization-config source', () => {
  const readers = (INDEX.match(/MHMS_ORG_CONFIG\.consult/g) || []).length;
  assert.ok(readers >= 4, `at least four MHMS_ORG_CONFIG.consult readers (found ${readers})`);
});

test('11. consultation data lives in exactly one production source', () => {
  // The consult object literal exists only in orgConfig.js; index.jsx defines no consult object.
  assert.equal((INDEX.match(/consult:\s*\{/g) || []).length, 0, 'index.jsx defines no consult object');
});

test('12. current consultation wording is unchanged', () => {
  assert.ok(INDEX.includes('Mark hosts a live Zoom consultation every other week at'), 'Getting Started card wording intact');
  assert.ok(INDEX.includes('Live consultations with Dr. Mayfield, every other week at 6pm MST'), 'consult bar wording intact');
  assert.ok(INDEX.includes('target="_blank" rel="noopener noreferrer"'), 'link rel attributes intact');
});

// NOTE (Slice 4): the former Slice-3 guards "PlatformShell is a stateless Fragment", "no
// HomeDestination", and "no activeDestination" are intentionally superseded — Slice 4 adds
// destination selection + Home. The invariants that still matter for the config migration are
// preserved below (runtime stays App-owned; Home takes no runtime); full shell/Home behavior is
// covered by platformShell.test.mjs and homeDestination.test.mjs.
test('13. the runtime stays App-owned — shell/Home import no runtime module', () => {
  assert.equal(/platformRuntime|usePlatformRuntime/.test(SHELL), false, 'PlatformShell has no runtime');
  const HOME = readFileSync(new URL('./homeDestination.jsx', import.meta.url), 'utf8');
  assert.equal(/platformRuntime|usePlatformRuntime/.test(HOME), false, 'HomeDestination has no runtime');
});

test('14. HomeDestination exists as a dedicated module (Slice 4)', () => {
  const HOME = readFileSync(new URL('./homeDestination.jsx', import.meta.url), 'utf8');
  assert.ok(/export function HomeDestination\(/.test(HOME), 'HomeDestination is its own module');
});

test('15. ShellHeader is a dedicated presentation module, not defined in App/orchestration', () => {
  // Slice 5 adds the shell header, but it stays out of index.jsx (App) — it lives in its own module and
  // is only composed by PlatformShell, so orchestration/config code carries no shell chrome.
  assert.equal(/function\s+ShellHeader\s*\(/.test(INDEX), false, 'ShellHeader not defined in index.jsx');
  const HEADER = readFileSync(new URL('./shellHeader.jsx', import.meta.url), 'utf8');
  assert.ok(/export function ShellHeader\(/.test(HEADER), 'ShellHeader is its own exported module');
});

test('16. destination state is owned by PlatformShell, not App (index.jsx)', () => {
  const app = fnBody(INDEX, 'App');
  assert.equal(app.includes('activeDestination'), false, 'App holds no destination state');
  assert.ok(/activeDestination/.test(SHELL), 'PlatformShell owns activeDestination');
});

test('17. destination navigation is organization-config-driven (single source), not hardcoded', () => {
  // Slice 5 adds visible navigation; its labels must come from MHMS_ORG_CONFIG.destinations — the same
  // single organization source this migration established — with no second navigation configuration.
  const HEADER = readFileSync(new URL('./shellHeader.jsx', import.meta.url), 'utf8');
  assert.ok(/config\.destinations/.test(HEADER), 'ShellHeader reads config.destinations');
  assert.deepEqual(MHMS_ORG_CONFIG.destinations.map((d) => d.id), ['home', 'community'], 'unchanged destination ids');
  for (const banned of ['routes', 'navItems', 'navigation', 'menu']) {
    assert.equal(JSON.stringify(MHMS_ORG_CONFIG).includes(banned), false, `no second navigation config field: ${banned}`);
  }
});

test('18. the runtime contract is unchanged', () => {
  assert.ok(RUNTIME.includes('module.exports = { usePlatformRuntime, CONNECTED_PHASES, reconcileThreadNoteOnOpen, emptyRuntimeState, disposeBagOwned, setupStillOwns }'));
});

test('19. no new Stream listeners were added', () => {
  assert.equal((RUNTIME.match(/client\.on\(/g) || []).length, 4);
  for (const ev of ['message.new', 'notification.message_new', 'notification.thread_message_new', 'connection.recovered']) {
    assert.equal(INDEX.includes(`.on('${ev}'`), false, `${ev} not in index.jsx`);
  }
});

test('20. the committed root chat.bundle.js remains the approved Stage 1 artifact', () => {
  const hash = createHash('sha256').update(readFileSync(ROOT_BUNDLE)).digest('hex');
  assert.equal(hash, 'f1b3ee488cea66c82bab0b512226adff1553bc199c26a3a6c60d2091cf5d57bf');
});
