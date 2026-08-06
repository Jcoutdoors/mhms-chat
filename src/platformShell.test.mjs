// Stage 2 Slice 2 — PlatformShell boundary guards. Structural (source-scan) tests proving the
// authenticated Community presentation is now composed THROUGH a minimal PlatformShell boundary,
// with Community still the only, always-active destination and NO visible shell/Home/navigation,
// destination state, persistence, or URL/history behavior. Scoped, call/regex-based checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const INDEX = readFileSync(new URL('./index.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('./platformShell.jsx', import.meta.url), 'utf8');
const RUNTIME = readFileSync(new URL('./platformRuntime.js', import.meta.url), 'utf8');
const ROOT_BUNDLE = new URL('../chat.bundle.js', import.meta.url);

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

test('1. PlatformShell exists as an exported component', () => {
  assert.ok(/export function PlatformShell\(/.test(SHELL), 'PlatformShell declared + exported');
  assert.ok(/import \{ PlatformShell \} from '\.\/platformShell'/.test(INDEX), 'index imports PlatformShell');
});

test('2. App delegates the authenticated Community presentation THROUGH PlatformShell', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(/<PlatformShell>\s*<CommunityDestination/.test(app), 'PlatformShell wraps CommunityDestination');
  assert.ok(/<\/PlatformShell>/.test(app), 'PlatformShell closed');
});

test('3. CommunityDestination remains the only authenticated destination', () => {
  assert.equal((INDEX.match(/<CommunityDestination[\s/>]/g) || []).length, 1, 'exactly one CommunityDestination render');
  // No other destination component is rendered inside the shell.
  assert.equal(INDEX.includes('<HomeDestination'), false, 'no Home rendered');
});

test('4. no HomeDestination exists yet', () => {
  assert.equal(/function\s+HomeDestination\s*\(/.test(INDEX + SHELL), false);
});

test('5. no ShellHeader exists yet', () => {
  assert.equal(/function\s+ShellHeader\s*\(/.test(INDEX + SHELL), false);
});

test('6. PlatformShell renders no visible destination chrome (pure pass-through)', () => {
  const body = fnBody(SHELL, 'PlatformShell');
  assert.ok(/return\s*<>\{children\}<\/>/.test(body.replace(/\s+/g, ' ')), 'renders a Fragment of children');
  // Scope chrome checks to the render body (comments elsewhere may name destinations).
  for (const chrome of ['<button', 'onClick', 'aria-current', '<nav', 'Home', 'Community', 'role="tab"']) {
    assert.equal(body.includes(chrome), false, `no shell chrome in render body: ${chrome}`);
  }
});

test('7. no destination state, persistence, or URL/history behavior was introduced', () => {
  assert.equal(/activeDestination/.test(INDEX + SHELL), false, 'no activeDestination state');
  for (const api of ['pushState', 'replaceState', 'popstate', 'hashchange', 'localStorage', 'sessionStorage', 'useState', 'useEffect']) {
    assert.equal(SHELL.includes(api), false, `PlatformShell has no ${api}`);
  }
});

test('8. usePlatformRuntime remains instantiated once, in App, not in PlatformShell', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('const runtime = usePlatformRuntime({'), 'runtime instantiated in App');
  assert.equal((INDEX.match(/usePlatformRuntime\(/g) || []).length, 1, 'exactly one usePlatformRuntime call');
  assert.equal(SHELL.includes('usePlatformRuntime'), false, 'PlatformShell does not touch the runtime');
});

test('9. the auth controller still initiates setupChannels (one site) in App', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('setupChannels: (args) => runtimeRef.current.setupChannels(args)'));
  assert.equal((INDEX.match(/\.setupChannels\(/g) || []).length, 1, 'one setupChannels initiation site');
});

test('10. no new Stream listeners were added', () => {
  assert.equal((RUNTIME.match(/client\.on\(/g) || []).length, 4, 'runtime still registers exactly four listeners');
  for (const ev of ['message.new', 'notification.message_new', 'notification.thread_message_new', 'connection.recovered']) {
    assert.equal(INDEX.includes(`.on('${ev}'`), false, `${ev} not in index.jsx`);
  }
  assert.equal(SHELL.includes('client.on('), false, 'PlatformShell registers no listeners');
});

test('11. the runtime contract is unchanged', () => {
  assert.ok(RUNTIME.includes('module.exports = { usePlatformRuntime, CONNECTED_PHASES, reconcileThreadNoteOnOpen, emptyRuntimeState, disposeBagOwned, setupStillOwns }'));
});

test('12. verified-auth phase gating remains in App', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('<ProfileForm') && app.includes('<AuthGate'));
  assert.ok(app.includes('signOutError') && app.includes("phase !== 'community'"));
});

test('13. CommunityDestination ownership is unchanged (no auth/runtime/controller lifecycle)', () => {
  const cd = fnBody(INDEX, 'CommunityDestination');
  for (const banned of ['usePlatformRuntime(', 'createAuthController', 'connectVerified', 'disconnectVerified', 'controller.', 'client.on(']) {
    assert.equal(cd.includes(banned), false, `CommunityDestination has no ${banned}`);
  }
});

test('14. the committed root chat.bundle.js remains the approved Stage 1 artifact', () => {
  const hash = createHash('sha256').update(readFileSync(ROOT_BUNDLE)).digest('hex');
  assert.equal(hash, 'f1b3ee488cea66c82bab0b512226adff1553bc199c26a3a6c60d2091cf5d57bf');
});
