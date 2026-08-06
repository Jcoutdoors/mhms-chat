// Stage 2 Slice 4 — PlatformShell boundary guards (supersedes the Slice-2 Fragment-only shell).
// PlatformShell now owns in-memory active-destination selection and conditionally presents Home
// or Community, while the runtime/auth/Stream client stay App-owned and mounted. Community remains
// the production default; Home is reachable only via the internal `initialDestination` review seam.
// No visible shell header/navigation, no URL/hash/history/storage persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const INDEX = readFileSync(new URL('./index.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('./platformShell.jsx', import.meta.url), 'utf8');
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

test('13. PlatformShell owns in-memory active-destination state', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/useState\(/.test(body), 'uses useState');
  assert.ok(/activeDestination/.test(body), 'tracks activeDestination');
});

test('14. the production initial destination is Community (App passes no seam override)', () => {
  // default param keeps Community the initial destination
  assert.ok(/initialDestination\s*=\s*'community'/.test(SHELL), "default initialDestination is 'community'");
  assert.ok(/initialDestination === 'home' \? 'home' : 'community'/.test(SHELL), 'non-home normalizes to community');
  // App does NOT pass initialDestination in production
  const app = fnBody(INDEX, 'App');
  assert.equal(app.includes('initialDestination'), false, 'App does not set an initial destination');
});

test('15. an optional review seam can select Home without changing the production default', () => {
  assert.ok(/\binitialDestination\b/.test(SHELL), 'initialDestination prop exists as the review seam');
});

test('16. Community (children) renders for the community destination', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/return <>\{children\}<\/>/.test(body.replace(/\s+/g, ' ')), 'renders children when Community is active');
});

test('17. HomeDestination renders for the home destination', () => {
  assert.ok(/import \{ HomeDestination \} from '\.\/homeDestination'/.test(SHELL), 'imports HomeDestination');
  assert.ok(/<HomeDestination\b/.test(SHELL), 'renders <HomeDestination>');
});

test('18. the Home action returns to Community', () => {
  assert.ok(/onGoToCommunity=\{\(\) => setActiveDestination\('community'\)\}/.test(SHELL),
    'onGoToCommunity sets the destination back to community');
});

test('19. no URL / hash / history / storage persistence exists in the shell', () => {
  const body = fnBody(SHELL, 'PlatformShell'); // scope to code, not the doc comment
  for (const api of ['pushState', 'replaceState', 'popstate', 'hashchange', 'localStorage', 'sessionStorage', 'location', 'history']) {
    assert.equal(body.includes(api), false, `no ${api}`);
  }
});

test('20. no visible shell header or destination navigation exists', () => {
  assert.equal(/function\s+ShellHeader\s*\(/.test(INDEX + SHELL), false, 'no ShellHeader');
  // PlatformShell itself renders no nav chrome (the only <button> is inside HomeDestination).
  const body = fnBody(SHELL, 'PlatformShell');
  for (const chrome of ['<button', '<nav', 'aria-current', 'role="tab"']) {
    assert.equal(body.includes(chrome), false, `no shell chrome: ${chrome}`);
  }
});

test('21. PlatformShell imports no runtime module', () => {
  assert.equal(/platformRuntime|usePlatformRuntime/.test(SHELL), false);
});

test('22. PlatformShell imports no auth controller', () => {
  assert.equal(/authController|createAuthController/.test(SHELL), false);
});

test('23. usePlatformRuntime remains instantiated exactly once, in App', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('const runtime = usePlatformRuntime({'), 'runtime instantiated in App');
  assert.equal((INDEX.match(/usePlatformRuntime\(/g) || []).length, 1, 'exactly one usePlatformRuntime call');
});

test('24. the runtime stays App-owned (not created in shell or Home)', () => {
  assert.equal(SHELL.includes('usePlatformRuntime'), false, 'not in PlatformShell');
  assert.equal(HOME.includes('usePlatformRuntime'), false, 'not in HomeDestination');
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('setupChannels: (args) => runtimeRef.current.setupChannels(args)'), 'controller setup seam in App');
});

test('25. CommunityDestination still receives the same prop contract', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(/<PlatformShell config=\{orgConfig\} homeProps=\{\{ currentUser \}\}>/.test(app), 'shell receives config + homeProps');
  for (const prop of ['runtime={runtime}', 'onEditProfile={() => controller.editProfile()}', 'onLogout={() => controller.logout()}', 'onSelectChannel={handleChannelSelect}']) {
    assert.ok(app.includes(prop), `CommunityDestination still passed ${prop}`);
  }
});

test('26. no new Stream listeners were added', () => {
  assert.equal((RUNTIME.match(/client\.on\(/g) || []).length, 4);
  for (const ev of ['message.new', 'notification.message_new', 'notification.thread_message_new', 'connection.recovered']) {
    assert.equal(INDEX.includes(`.on('${ev}'`), false);
  }
  assert.equal(SHELL.includes('client.on(') || HOME.includes('client.on('), false, 'shell/Home register no listeners');
});

test('27. the runtime contract is unchanged', () => {
  assert.ok(RUNTIME.includes('module.exports = { usePlatformRuntime, CONNECTED_PHASES, reconcileThreadNoteOnOpen, emptyRuntimeState, disposeBagOwned, setupStillOwns }'));
});

test('28. the committed root chat.bundle.js remains the approved Stage 1 artifact', () => {
  const hash = createHash('sha256').update(readFileSync(ROOT_BUNDLE)).digest('hex');
  assert.equal(hash, 'f1b3ee488cea66c82bab0b512226adff1553bc199c26a3a6c60d2091cf5d57bf');
});
