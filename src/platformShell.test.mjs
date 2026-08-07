// Stage 2 Slice 5 — PlatformShell boundary + shell-navigation guards (supersedes the Slice-4 shell,
// which had no visible navigation). PlatformShell now owns in-memory destination selection, renders the
// persistent ShellHeader above a flex content region, and conditionally presents Home or Community.
// The runtime/auth/Stream client stay App-owned and mounted; Community remains the production default;
// there is still no routing/persistence and no destination-change focus/aria-live behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const INDEX = readFileSync(new URL('./index.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('./platformShell.jsx', import.meta.url), 'utf8');
const HEADER = readFileSync(new URL('./shellHeader.jsx', import.meta.url), 'utf8');
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

test('19. PlatformShell still owns in-memory active-destination state', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/useState\(/.test(body), 'uses useState');
  assert.ok(/activeDestination/.test(body), 'tracks activeDestination');
});

test('20. the production initial destination is Community (App passes no seam override)', () => {
  assert.ok(/initialDestination\s*=\s*'community'/.test(SHELL), "default initialDestination is 'community'");
  const app = fnBody(INDEX, 'App');
  assert.equal(app.includes('initialDestination'), false, 'App does not set an initial destination');
});

test('21. an optional review seam can select Home without changing the production default', () => {
  assert.ok(/\binitialDestination\b/.test(SHELL), 'initialDestination prop exists as the review seam');
});

test('22. an unsupported initialDestination normalizes to Community', () => {
  assert.ok(/initialDestination === 'home' \? 'home' : 'community'/.test(SHELL), 'non-home normalizes to community');
});

test('23. PlatformShell renders the ShellHeader', () => {
  assert.ok(/import \{ ShellHeader \} from '\.\/shellHeader'/.test(SHELL), 'imports ShellHeader');
  assert.ok(/<ShellHeader\b/.test(SHELL), 'renders <ShellHeader>');
});

test('24. ShellHeader receives config and the active destination', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/<ShellHeader[\s\S]*?config=\{config\}[\s\S]*?activeDestination=\{activeDestination\}/.test(body),
    'ShellHeader gets config + activeDestination');
});

test('25. selecting a destination in the header updates PlatformShell state', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/onSelectDestination=\{setActiveDestination\}/.test(body), 'header selection drives shell state');
});

test('26. the Home destination renders HomeDestination', () => {
  assert.ok(/import \{ HomeDestination \} from '\.\/homeDestination'/.test(SHELL), 'imports HomeDestination');
  assert.ok(/activeDestination === 'home'/.test(SHELL), 'branches on the home destination');
  assert.ok(/<HomeDestination\b/.test(SHELL), 'renders <HomeDestination>');
});

test('27. the Community destination renders children', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/:\s*\(\s*children\s*\)/.test(body.replace(/\s+/g, ' ')) || /\{\s*children\s*\}/.test(body),
    'Community branch renders the children presentation');
});

test('28. the Home action returns to Community', () => {
  assert.ok(/onGoToCommunity=\{\(\) => setActiveDestination\('community'\)\}/.test(SHELL),
    'onGoToCommunity sets the destination back to community');
});

test('29. PlatformShell owns the viewport-height shell as a flex column', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/height: '100dvh'/.test(body), 'outer shell owns viewport height (100dvh)');
  assert.ok(/flexDirection: 'column'/.test(body), 'shell is a flex column');
});

test('30. the content region uses a flex/min-height pattern, not a hardcoded header subtraction', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/flex: 1/.test(body), 'content region flexes to fill remaining space');
  assert.ok(/minHeight: 0/.test(body), 'content region uses min-height:0');
  assert.equal(/calc\(/.test(body), false, 'no calc() header-height subtraction');
  assert.equal(/100vh\s*-/.test(body), false, 'no magic 100vh minus pixels');
});

test('31. no URL / hash / history / storage persistence exists in the shell', () => {
  const body = fnBody(SHELL, 'PlatformShell'); // scope to code, not the doc comment
  for (const api of ['pushState', 'replaceState', 'popstate', 'hashchange', 'localStorage', 'sessionStorage', 'location', 'history', 'href']) {
    assert.equal(body.includes(api), false, `no ${api}`);
  }
});

test('32. PlatformShell imports no runtime module', () => {
  assert.equal(/platformRuntime|usePlatformRuntime/.test(SHELL), false);
});

test('33. PlatformShell imports no auth controller', () => {
  assert.equal(/authController|createAuthController/.test(SHELL), false);
});

test('34. PlatformShell imports no Stream module', () => {
  assert.equal(/stream-chat|StreamChat/.test(SHELL), false);
});

test('35. usePlatformRuntime remains instantiated exactly once, in App', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('const runtime = usePlatformRuntime({'), 'runtime instantiated in App');
  assert.equal((INDEX.match(/usePlatformRuntime\(/g) || []).length, 1, 'exactly one usePlatformRuntime call');
});

test('36. the runtime stays App-owned (not created in shell, header, or Home)', () => {
  assert.equal(SHELL.includes('usePlatformRuntime'), false, 'not in PlatformShell');
  assert.equal(HEADER.includes('usePlatformRuntime'), false, 'not in ShellHeader');
  assert.equal(HOME.includes('usePlatformRuntime'), false, 'not in HomeDestination');
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('setupChannels: (args) => runtimeRef.current.setupChannels(args)'), 'controller setup seam in App');
});

test('37. CommunityDestination still receives the same runtime/callback contract', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(/<PlatformShell config=\{orgConfig\}>/.test(app), 'shell receives only config');
  for (const prop of ['runtime={runtime}', 'onEditProfile={() => controller.editProfile()}', 'onLogout={() => controller.logout()}', 'onSelectChannel={handleChannelSelect}']) {
    assert.ok(app.includes(prop), `CommunityDestination still passed ${prop}`);
  }
});

test('38. the runtime contract is unchanged', () => {
  assert.ok(RUNTIME.includes('module.exports = { usePlatformRuntime, CONNECTED_PHASES, reconcileThreadNoteOnOpen, emptyRuntimeState, disposeBagOwned, setupStillOwns }'));
});

test('39. no new Stream listeners were added', () => {
  assert.equal((RUNTIME.match(/client\.on\(/g) || []).length, 4);
  for (const ev of ['message.new', 'notification.message_new', 'notification.thread_message_new', 'connection.recovered']) {
    assert.equal(INDEX.includes(`.on('${ev}'`), false);
  }
  assert.equal(SHELL.includes('client.on(') || HEADER.includes('client.on(') || HOME.includes('client.on('), false,
    'shell/header/Home register no listeners');
});

test('40. the committed root chat.bundle.js remains the approved Stage 1 artifact', () => {
  const hash = createHash('sha256').update(readFileSync(ROOT_BUNDLE)).digest('hex');
  assert.equal(hash, 'f1b3ee488cea66c82bab0b512226adff1553bc199c26a3a6c60d2091cf5d57bf');
});
