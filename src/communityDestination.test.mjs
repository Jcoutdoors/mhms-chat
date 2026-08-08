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
  // profile-edit and logout reach the controller via semantic props and remain in the Community sidebar
  // (Slice 5 deliberately does NOT relocate them into the shell — shell account controls are a separate,
  // later-scoped decision).
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

test('9. shell/Home/destination code stays out of index.jsx (isolated modules)', () => {
  // PlatformShell, ShellHeader, and HomeDestination all live in their own modules; index.jsx (App +
  // CommunityDestination) defines none of them and holds no destination state — that lives in PlatformShell.
  assert.equal(/function\s+PlatformShell\s*\(/.test(INDEX), false, 'PlatformShell not defined in index.jsx');
  assert.equal(/function\s+ShellHeader\s*\(/.test(INDEX), false, 'ShellHeader not defined in index.jsx');
  assert.equal(/function\s+HomeDestination\s*\(/.test(INDEX), false, 'HomeDestination not defined in index.jsx');
  assert.equal(/activeDestination/.test(INDEX), false, 'no activeDestination state in index.jsx');
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

// ---- Stage 2 Slice 5: Community fits the shell content region beneath the persistent header ----
test('12. CommunityDestination fills the shell content region (no second viewport height)', () => {
  const cd = fnBody(INDEX, 'CommunityDestination');
  assert.equal(/100vh/.test(cd), false, 'no 100vh inside CommunityDestination');
  assert.equal(/100dvh/.test(cd), false, 'no 100dvh inside CommunityDestination — PlatformShell owns viewport height');
  assert.ok(/height: '100%'/.test(cd), 'Community fills its container with height:100%');
  assert.ok(/display: 'flex'/.test(cd), 'desktop layout remains flex-based');
  assert.equal(/calc\(/.test(cd), false, 'no magic header-height subtraction');
});

test('13. the Community mobile drawer and isMobile wiring are preserved', () => {
  // The mobile nav drawer (a fixed 100dvh overlay in the Sidebar) is unchanged by the shell integration.
  assert.ok(/position: 'fixed', top: 0, left: 0, height: '100dvh'/.test(INDEX), 'mobile drawer overlay intact');
  const app = fnBody(INDEX, 'App');
  assert.ok(/isMobile=\{isMobile\}/.test(app), 'App still passes isMobile to CommunityDestination');
  const cd = fnBody(INDEX, 'CommunityDestination');
  assert.ok(cd.includes('mobileNavOpen') && cd.includes('setMobileNavOpen'), 'Community still owns mobile drawer state');
});

// ---- Stage 3 Slice 1b correction: Community integrates into the shell (no "app inside an app") ----
test('14. the global shell owns organization identity — Community does not duplicate it', () => {
  const sidebar = fnBody(INDEX, 'Sidebar');
  assert.equal(sidebar.includes('APP_CONFIG.orgSubtitle'), false, 'no repeated org subtitle identity block in the Community rail');
  assert.equal(sidebar.includes('APP_CONFIG.orgName'), false, 'no repeated org name identity block in the Community rail');
  // a small contextual area label is acceptable in its place
  assert.ok(sidebar.includes('>Community<'), 'Community rail begins with a compact contextual label');
});

test('15. the legacy inset "app card" wrapper is removed (the shell is the frame)', () => {
  const cd = fnBody(INDEX, 'CommunityDestination');
  assert.equal(/borderRadius: isMobile \? 0 : 18/.test(cd), false, 'no giant rounded inset container');
  assert.equal(/boxShadow: isMobile \? 'none' : '0 24px 60px/.test(cd), false, 'no big legacy drop shadow around the Community container');
  assert.equal(/padding: isMobile \? 0 : 14/.test(cd), false, 'no outer inset padding reinforcing the embedded-app look');
});

test('16. Community keeps its own channel navigation as a labelled landmark (not migrated to the global sidebar)', () => {
  const sidebar = fnBody(INDEX, 'Sidebar');
  assert.ok(/<nav aria-label="Community channels">/.test(sidebar), 'Community contextual nav is a labelled landmark');
  assert.ok(/groups\.map\(group =>/.test(sidebar), 'channel groups remain Community-owned');
  assert.ok(INDEX.includes('<Sidebar groups={APP_CONFIG.channelGroups}'), 'CommunityDestination still renders its own Sidebar');
});

test('17. the global and Community navigation controls have distinct, unambiguous accessible names', () => {
  assert.ok(INDEX.includes('aria-label="Open Community channels"'), 'Community mobile control is named for channels');
  const HEADER = readFileSync(new URL('./shellHeader.jsx', import.meta.url), 'utf8');
  assert.ok(HEADER.includes('Open global navigation'), 'global control is named for global navigation');
  assert.equal(INDEX.includes('Open global navigation'), false, 'Community control does not reuse the global label');
});

test('18. the consultation feature is intact but restyled into a restrained token-based treatment', () => {
  const cd = fnBody(INDEX, 'CommunityDestination');
  assert.ok(cd.includes('MHMS_ORG_CONFIG.consult.link'), 'consultation link/behavior unchanged (data from config)');
  assert.ok(/var\(--platform-accent-soft/.test(cd), 'consult bar uses the semantic accent-soft token');
  assert.equal(cd.includes('linear-gradient(135deg, #3a55d9 0%, #2f44b8 100%)'), false, 'no bright legacy gradient strip');
});

test('19. the Community contextual rail participates in the theme via --platform-* tokens', () => {
  const sidebar = fnBody(INDEX, 'Sidebar');
  assert.ok(/var\(--platform-canvas-subtle/.test(sidebar), 'rail background is a semantic surface token');
  assert.ok(/var\(--platform-border-subtle/.test(sidebar), 'rail divider is a semantic border token');
});
