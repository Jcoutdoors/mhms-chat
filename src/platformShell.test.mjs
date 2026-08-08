// Stage 3 Slice 1b — PlatformShell (global shell) guards. Supersedes the Slice-5 header-only shell.
// PlatformShell is the single owner of shell presentation state (active destination, desktop collapse,
// mobile global-drawer, responsive breakpoint) and composes GlobalSidebar (primary nav) + ShellHeader
// (utility) + a <main> content landmark. It closes the Stage 2 focus/aria-live debt. Runtime/auth stay
// App-owned; Community keeps its own contextual navigation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const INDEX = readFileSync(new URL('./index.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('./platformShell.jsx', import.meta.url), 'utf8');
const HEADER = readFileSync(new URL('./shellHeader.jsx', import.meta.url), 'utf8');
const SIDEBAR = readFileSync(new URL('./globalSidebar.jsx', import.meta.url), 'utf8');
const HOME = readFileSync(new URL('./homeDestination.jsx', import.meta.url), 'utf8');
const RUNTIME = readFileSync(new URL('./platformRuntime.js', import.meta.url), 'utf8');
const ROOT_BUNDLE = new URL('../chat.bundle.js', import.meta.url);

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

// ---- ownership of shell state ----
test('1. PlatformShell owns active destination + collapse + mobile-drawer state (single owner)', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/const \[activeDestination, setActiveDestination\] = useState\(/.test(body), 'owns activeDestination');
  assert.ok(/const \[collapsed, setCollapsed\] = useState\(/.test(body), 'owns desktop collapsed');
  assert.ok(/const \[globalNavOpen, setGlobalNavOpen\] = useState\(/.test(body), 'owns mobile global-drawer');
});

test('2. production defaults to Community; App passes no initialDestination; unsupported normalizes', () => {
  assert.ok(/initialDestination = 'community'/.test(SHELL), "default initialDestination is 'community'");
  assert.ok(/initialDestination === 'home' \? 'home' : 'community'/.test(SHELL), 'unsupported normalizes to community');
  const app = fnBody(INDEX, 'App');
  assert.equal(app.includes('initialDestination'), false, 'App passes no initial destination');
});

// ---- composition ----
test('3. PlatformShell renders GlobalSidebar as the primary destination nav', () => {
  assert.ok(/import \{ GlobalSidebar \} from '\.\/globalSidebar'/.test(SHELL), 'imports GlobalSidebar');
  assert.ok(/<GlobalSidebar[\s\S]*?activeDestination=\{activeDestination\}[\s\S]*?onSelectDestination=\{selectDestination\}/.test(SHELL), 'sidebar gets active + selection');
  assert.ok(/collapsed=\{collapsed\}/.test(SHELL), 'sidebar gets the collapsed flag');
});

test('4. PlatformShell renders the ShellHeader utility header with an accessible toggle', () => {
  assert.ok(/import \{ ShellHeader \} from '\.\/shellHeader'/.test(SHELL), 'imports ShellHeader');
  assert.ok(/<ShellHeader[\s\S]*?onToggleSidebar=\{onToggleSidebar\}[\s\S]*?toggleRef=\{toggleRef\}/.test(SHELL), 'header gets toggle + ref');
  assert.ok(/navControlsId=\{NAV_ID\}/.test(SHELL), 'toggle points at the sidebar/drawer id');
});

test('5. Home renders HomeDestination; Community renders children; Home action returns to Community', () => {
  assert.ok(/import \{ HomeDestination \} from '\.\/homeDestination'/.test(SHELL));
  assert.ok(/activeDestination === 'home'\s*\?\s*<HomeDestination/.test(SHELL), 'home branch renders HomeDestination');
  assert.ok(/:\s*children/.test(SHELL), 'community branch renders children');
  assert.ok(/onGoToCommunity=\{\(\) => selectDestination\('community'\)\}/.test(SHELL), 'home action returns to community');
});

// ---- accessibility: closes the Stage 2 deferred debt ----
test('6. the content region is a focusable <main> landmark labelled by the active area', () => {
  assert.ok(/<main[\s\S]*?tabIndex=\{-1\}[\s\S]*?aria-label=\{activeLabel \|\| undefined\}/.test(SHELL), 'main is a labelled, focusable landmark');
});

test('7. destination changes move focus to <main> (post-mount only) and announce via aria-live', () => {
  // focus management, keyed on the destination and guarded against the initial mount
  assert.ok(/if \(!didMountRef\.current\) \{ didMountRef\.current = true; return; \}/.test(SHELL), 'skips initial mount (no focus theft on load)');
  assert.ok(/mainRef\.current\.focus\(\)/.test(SHELL), 'moves focus to the content landmark');
  assert.ok(/\}, \[activeDestination\]\);/.test(SHELL), 'keyed on destination change');
  // polite announcement of the new area
  assert.ok(/role="status" aria-live="polite"/.test(SHELL), 'polite live region present');
  assert.ok(/setAnnounce\(activeLabel\)/.test(SHELL), 'announces the destination label');
});

test('8. the mobile drawer is a modal dialog with Escape close and managed focus', () => {
  assert.ok(/role="dialog"/.test(SHELL) && /aria-modal="true"/.test(SHELL), 'drawer is a modal dialog');
  assert.ok(/e\.key === 'Escape'/.test(SHELL), 'Escape closes the drawer');
  assert.ok(/closeBtnRef\.current\.focus\(\)/.test(SHELL), 'focus moves into the drawer on open');
  assert.ok(/aria-label="Close navigation"/.test(SHELL), 'accessible close control');
  // focus returns to the toggle on an explicit close, but not when navigation caused the close
  assert.ok(/toggleRef\.current\.focus\(\)/.test(SHELL), 'focus returns to the toggle');
  assert.ok(/closedByNavRef/.test(SHELL), 'navigation-driven close does not yank focus back to the toggle');
});

test('9. selecting a destination on mobile closes the global drawer', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/const selectDestination = useCallback\(\(id\) => \{[\s\S]*?setActiveDestination\(id\);[\s\S]*?setGlobalNavOpen\(/.test(body), 'selection also closes the drawer');
});

// ---- theme ----
test('10. the shell consumes --platform-* tokens and no --anchor-*', () => {
  assert.ok(/var\(--platform-canvas/.test(SHELL), 'shell canvas token');
  assert.equal(/var\(--anchor-/.test(SHELL), false, 'no legacy --anchor-* tokens');
});

// ---- non-interference: runtime/auth ownership unchanged ----
test('11. PlatformShell imports no runtime/auth/Stream module', () => {
  assert.equal(/platformRuntime|usePlatformRuntime/.test(SHELL), false, 'no runtime');
  assert.equal(/authController|createAuthController/.test(SHELL), false, 'no auth controller');
  assert.equal(/stream-chat|StreamChat/.test(SHELL), false, 'no Stream');
});

test('12. usePlatformRuntime remains instantiated exactly once, in App', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('const runtime = usePlatformRuntime({'), 'runtime instantiated in App');
  assert.equal((INDEX.match(/usePlatformRuntime\(/g) || []).length, 1, 'exactly one usePlatformRuntime call');
});

test('13. the runtime stays App-owned (not created in shell, sidebar, header, or Home)', () => {
  for (const [name, src] of [['PlatformShell', SHELL], ['GlobalSidebar', SIDEBAR], ['ShellHeader', HEADER], ['HomeDestination', HOME]]) {
    assert.equal(src.includes('usePlatformRuntime'), false, `runtime not in ${name}`);
  }
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('setupChannels: (args) => runtimeRef.current.setupChannels(args)'), 'controller setup seam in App');
});

test('14. CommunityDestination still receives the same runtime/callback contract inside the shell', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(/<PlatformShell config=\{orgConfig\}>/.test(app), 'shell receives only config');
  for (const prop of ['runtime={runtime}', 'onEditProfile={() => controller.editProfile()}', 'onLogout={() => controller.logout()}', 'onSelectChannel={handleChannelSelect}']) {
    assert.ok(app.includes(prop), `CommunityDestination still passed ${prop}`);
  }
});

test('15. Community keeps its own contextual channel navigation (not migrated into the global sidebar)', () => {
  // The global sidebar carries no channel-level navigation; Community still renders its own Sidebar.
  for (const banned of ['channelGroups', 'Getting Started', 'Announcements', 'selectChannel']) {
    assert.equal(SIDEBAR.includes(banned), false, `global sidebar excludes ${banned}`);
  }
  assert.ok(INDEX.includes('<Sidebar groups={APP_CONFIG.channelGroups}'), 'Community still owns its channel Sidebar');
});

test('16. the runtime contract is unchanged', () => {
  assert.ok(RUNTIME.includes('module.exports = { usePlatformRuntime, CONNECTED_PHASES, reconcileThreadNoteOnOpen, emptyRuntimeState, disposeBagOwned, setupStillOwns }'));
});

test('17. no new Stream listeners were added', () => {
  assert.equal((RUNTIME.match(/client\.on\(/g) || []).length, 4);
  for (const ev of ['message.new', 'notification.message_new', 'notification.thread_message_new', 'connection.recovered']) {
    assert.equal(INDEX.includes(`.on('${ev}'`), false);
  }
  assert.equal(SHELL.includes('client.on(') || SIDEBAR.includes('client.on(') || HEADER.includes('client.on('), false, 'shell surfaces register no listeners');
});

test('18. the committed root chat.bundle.js remains the approved Stage 1 artifact', () => {
  const hash = createHash('sha256').update(readFileSync(ROOT_BUNDLE)).digest('hex');
  assert.equal(hash, 'f1b3ee488cea66c82bab0b512226adff1553bc199c26a3a6c60d2091cf5d57bf');
});
