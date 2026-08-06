// Stage 2 Slice 1 — CommunityDestination extraction guards. Structural (source-scan) tests
// proving the connected Community presentation was extracted out of App() into a top-level
// CommunityDestination component WITHOUT changing runtime/auth ownership, and that no Stage 2
// shell/Home/destination work has leaked in yet. Targeted string/regex checks (no fragile line
// numbers); call-based where a comment could otherwise satisfy a check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const INDEX = readFileSync(new URL('./index.jsx', import.meta.url), 'utf8');
const RUNTIME = readFileSync(new URL('./platformRuntime.js', import.meta.url), 'utf8');
const ROOT_BUNDLE = new URL('../chat.bundle.js', import.meta.url);

// Extract a top-level `function NAME(...) { ... }` body: declaration to the first column-0
// closing brace line (`\n}\n`). JSX/CSS braces are all indented, so this delimits correctly.
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

test('1. CommunityDestination exists as a top-level function component', () => {
  assert.ok(/\nfunction CommunityDestination\(/.test(INDEX), 'CommunityDestination declared at top level');
});

test('2. App renders (delegates to) CommunityDestination', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(/<CommunityDestination[\s/>]/.test(app), 'App returns <CommunityDestination …/>');
});

test('3. usePlatformRuntime is instantiated once, in App, NOT in CommunityDestination', () => {
  const app = fnBody(INDEX, 'App');
  const cd = fnBody(INDEX, 'CommunityDestination');
  assert.ok(app.includes('const runtime = usePlatformRuntime({'), 'runtime instantiated in App');
  assert.equal(cd.includes('usePlatformRuntime('), false, 'runtime NOT instantiated in CommunityDestination');
  assert.equal((INDEX.match(/usePlatformRuntime\(/g) || []).length, 1, 'exactly one usePlatformRuntime call');
});

test('4. the auth controller still initiates setupChannels (one site), owned by App', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('setupChannels: (args) => runtimeRef.current.setupChannels(args)'), 'controller dep initiates setup');
  assert.equal((INDEX.match(/\.setupChannels\(/g) || []).length, 1, 'exactly one setupChannels initiation site');
});

test('5. CommunityDestination owns no auth/controller lifecycle', () => {
  const cd = fnBody(INDEX, 'CommunityDestination');
  assert.equal(cd.includes('createAuthController'), false, 'no controller creation in CommunityDestination');
  assert.equal(cd.includes('controller.'), false, 'no controller.* calls in CommunityDestination');
  assert.equal(cd.includes('controller.boot'), false, 'no boot in CommunityDestination');
  // profile-edit and logout reach the controller via semantic props (Slice-5 will host them in the shell).
  assert.ok(cd.includes('onEditProfile={onEditProfile}') && cd.includes('onLogout={onLogout}'), 'account actions via semantic props');
});

test('6. submitWithMentions moved into CommunityDestination (out of App)', () => {
  const app = fnBody(INDEX, 'App');
  const cd = fnBody(INDEX, 'CommunityDestination');
  assert.ok(cd.includes('const submitWithMentions ='), 'submitWithMentions defined in CommunityDestination');
  assert.equal(app.includes('submitWithMentions'), false, 'App no longer references submitWithMentions');
});

test('7. the Community readiness gate moved into CommunityDestination (does not block App)', () => {
  const app = fnBody(INDEX, 'App');
  const cd = fnBody(INDEX, 'CommunityDestination');
  assert.ok(cd.includes('if (!chatClient || Object.keys(channelMap).length === 0)'), 'readiness gate in CommunityDestination');
  assert.equal(app.includes('Object.keys(channelMap).length === 0'), false, 'App no longer holds the readiness gate');
});

test('8. verified-auth phase gating remains in App', () => {
  const app = fnBody(INDEX, 'App');
  assert.ok(app.includes('<ProfileForm'), 'ProfileForm rendered by App');
  assert.ok(app.includes('<AuthGate'), 'AuthGate rendered by App');
  assert.ok(app.includes("=== 'signingOut'") || app.includes("phase === 'signingOut'"), 'signingOut gate in App');
  assert.ok(app.includes('signOutError'), 'signOutError gate in App');
  assert.ok(app.includes("phase !== 'community'"), 'community phase gate in App');
});

test('9. no Stage 2 shell/Home/destination implementation exists yet', () => {
  assert.equal(/function\s+PlatformShell\s*\(/.test(INDEX), false, 'no PlatformShell yet');
  assert.equal(/function\s+ShellHeader\s*\(/.test(INDEX), false, 'no ShellHeader yet');
  assert.equal(/function\s+HomeDestination\s*\(/.test(INDEX), false, 'no HomeDestination yet');
  assert.equal(/activeDestination/.test(INDEX), false, 'no activeDestination state yet');
});

test('10. runtime contract is unchanged (exports + listener ownership)', () => {
  assert.ok(RUNTIME.includes('module.exports = { usePlatformRuntime, CONNECTED_PHASES, reconcileThreadNoteOnOpen, emptyRuntimeState, disposeBagOwned, setupStillOwns }'),
    'platformRuntime exports unchanged');
  assert.equal((RUNTIME.match(/client\.on\(/g) || []).length, 4, 'runtime still registers exactly four listeners');
  for (const ev of ['message.new', 'notification.message_new', 'notification.thread_message_new', 'connection.recovered']) {
    assert.equal(INDEX.includes(`.on('${ev}'`), false, `${ev} not registered in index.jsx`);
  }
});

test('11. the committed root chat.bundle.js remains the approved Stage 1 artifact (not republished)', () => {
  const hash = createHash('sha256').update(readFileSync(ROOT_BUNDLE)).digest('hex');
  assert.equal(hash, 'f1b3ee488cea66c82bab0b512226adff1553bc199c26a3a6c60d2091cf5d57bf',
    'Slice 1 must not republish the production bundle');
});
