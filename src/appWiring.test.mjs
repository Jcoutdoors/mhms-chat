// Stage 1 App-wiring ownership-boundary guards. Structural (source-scan) tests that the
// PlatformRuntime ownership migration is in place and index.jsx no longer duplicates the
// connected runtime. Targeted string checks (no fragile line numbers / whitespace).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const INDEX = readFileSync(new URL('./index.jsx', import.meta.url), 'utf8');
const RUNTIME = readFileSync(new URL('./platformRuntime.js', import.meta.url), 'utf8');
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ROOT_BUNDLE = new URL('../chat.bundle.js', import.meta.url);

const LISTENERS = ['message.new', 'notification.message_new', 'notification.thread_message_new', 'connection.recovered'];
// Robustly extract a top-level `function NAME(...) { ... }` body from source: from the
// declaration to the first top-level closing brace line (`\n}\n`). Scoped to the named
// component so it cannot match unrelated components or comments.
function componentBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}
function activeThreadWatcherBody() { return componentBody(INDEX, 'ActiveThreadWatcher'); }

test('1. index.jsx imports usePlatformRuntime', () => {
  assert.ok(/import\s*\{\s*usePlatformRuntime\s*\}\s*from\s*'\.\/platformRuntime'/.test(INDEX));
});

test('2. index.jsx instantiates PlatformRuntime at the App level', () => {
  assert.ok(INDEX.includes('const runtime = usePlatformRuntime({'), 'runtime instantiated');
});

test('3. the auth controller still initiates setupChannels (controller-owned seam)', () => {
  assert.ok(INDEX.includes('setupChannels: (args) => runtimeRef.current.setupChannels(args)'),
    'controller dep initiates runtime.setupChannels');
});

test('4. setupChannels is NOT initiated by ordinary render or a generic authPhase effect', () => {
  // No effect body invokes runtime.setupChannels; the only reference is the controller dep above.
  const calls = (INDEX.match(/\.setupChannels\(/g) || []).length;
  assert.equal(calls, 1, 'exactly one setupChannels initiation site (the controller dep)');
  assert.equal(/useEffect\([^)]*\)\s*=>\s*\{[^}]*setupChannels\(/.test(INDEX), false, 'no effect calls setupChannels');
});

test('5. the old duplicated setupChannels implementation is removed from index.jsx', () => {
  assert.equal(/function setupChannels\s*\(/.test(INDEX), false, 'no local setupChannels impl');
  assert.equal(INDEX.includes('setupChannelsImplRef'), false, 'no stale setup ref');
});

test('6. the four runtime listener registrations are absent from index.jsx', () => {
  for (const ev of LISTENERS) {
    assert.equal(INDEX.includes(`.on('${ev}'`), false, `${ev} not registered in index.jsx`);
  }
});

test('7. PlatformRuntime is the only connected-runtime listener owner', () => {
  for (const ev of LISTENERS) {
    assert.ok(RUNTIME.includes(`client.on('${ev}'`), `${ev} registered in the runtime`);
  }
  const runtimeOns = (RUNTIME.match(/client\.on\(/g) || []).length;
  assert.equal(runtimeOns, 4, 'exactly four runtime listener registrations');
});

test('8. ActiveThreadWatcher calls activeThreadChanged', () => {
  const body = activeThreadWatcherBody();
  assert.ok(body.includes('onActiveThreadChanged(threadId)'), 'reports active thread to the runtime');
  assert.ok(INDEX.includes('onActiveThreadChanged={runtime.activeThreadChanged}'), 'wired to runtime.activeThreadChanged');
});

test('9. ActiveThreadWatcher no longer receives raw thread-note setters or refs', () => {
  const body = activeThreadWatcherBody();
  for (const leaked of ['setThreadNotes', 'setOpenThreadId', 'threadNotesRef', 'removeThreadNote']) {
    assert.equal(body.includes(leaked), false, `${leaked} not used by the watcher`);
  }
});

test('10. PlatformRuntime is the SOLE owner of thread-level markRead for note reconciliation', () => {
  // These check CALLS (`markRead(`), not the substring, so component comments mentioning
  // "markRead" cannot satisfy or break the guard.
  // (a) ActiveThreadWatcher (reporter only) issues no markRead call of any kind.
  assert.equal(activeThreadWatcherBody().includes('markRead('), false, 'watcher makes no markRead call');
  // (b) ThreadJumpHandler no longer issues a thread-level markRead after opening a thread.
  const jump = componentBody(INDEX, 'ThreadJumpHandler');
  assert.equal(/markRead\(\s*\{\s*[\s\S]*?thread_id/.test(jump), false, 'ThreadJumpHandler makes no thread markRead');
  assert.equal(jump.includes('markRead('), false, 'ThreadJumpHandler makes no markRead call at all');
  // (c) index.jsx contains no thread-level markRead call anywhere.
  assert.equal(/markRead\(\s*\{\s*[\s\S]*?thread_id/.test(INDEX), false, 'no thread markRead anywhere in index.jsx');
  // (d) the runtime owns exactly the thread-level markRead tied to note reconciliation.
  assert.ok(/markRead\(\{\s*thread_id/.test(RUNTIME), 'runtime performs the thread-level markRead');
});

test('11. ThreadJumpHandler resolves both terminal outcomes via resolveThreadJump', () => {
  assert.equal((INDEX.match(/runtime\.resolveThreadJump\(\)/g) || []).length, 2, 'onOpened + onFailed');
  assert.equal(INDEX.includes('setPendingThread(null)'), false, 'no raw pending-thread setter');
});

test('12. Featured acknowledgment-store internals are not exposed in index.jsx', () => {
  assert.equal(INDEX.includes('getFeaturedAckStore'), false, 'no ack-store accessor');
  assert.equal(INDEX.includes('createFeaturedAckStore'), false, 'ack-store factory not imported/used');
});

test('13. Featured navigation uses the semantic runtime actions', () => {
  assert.ok(INDEX.includes('runtime.openFeaturedTarget('), 'openFeaturedTarget');
  assert.ok(INDEX.includes('onDone={runtime.completeFeaturedJump}'), 'completeFeaturedJump');
  assert.ok(INDEX.includes('onUnavailable={runtime.markFeaturedUnavailable}'), 'markFeaturedUnavailable');
  assert.ok(INDEX.includes('runtime.isFeaturedAcknowledged('), 'isFeaturedAcknowledged');
  assert.ok(INDEX.includes('runtime.acknowledgeFeatured('), 'acknowledgeFeatured');
});

test('14. mobile drawer closing is composed OUTSIDE PlatformRuntime', () => {
  // The view wraps runtime.selectChannel and closes the App-owned drawer; the runtime module
  // never references mobile presentation.
  assert.ok(INDEX.includes('await runtime.selectChannel(id)'), 'view calls runtime.selectChannel');
  assert.ok(INDEX.includes('setMobileNavOpen(false)'), 'view closes the drawer');
  assert.equal(/closeMobileNav|setMobileNavOpen/.test(RUNTIME), false, 'runtime has no mobile coupling');
});

test('15. runtime tests are included in the normal test gate', () => {
  assert.ok(PKG.scripts['test:phase4b'].includes('src/platformRuntime.test.mjs'), 'platformRuntime tests gated');
  assert.ok(PKG.scripts['test:phase4b'].includes('src/appWiring.test.mjs'), 'wiring tests gated');
});

// Release-artifact pin. The former pre-cutover hash (9c7fbc64…) was intentionally
// superseded when the reviewed Stage 1 bundle was published to the approved origin. This
// guard now pins the approved Stage 1 production artifact. Future intentional bundle
// releases MUST update this release pin as part of release closeout.
test('16. the committed root chat.bundle.js matches the approved Stage 1 production artifact', () => {
  const hash = createHash('sha256').update(readFileSync(ROOT_BUNDLE)).digest('hex');
  assert.equal(hash, 'f1b3ee488cea66c82bab0b512226adff1553bc199c26a3a6c60d2091cf5d57bf',
    'committed root chat.bundle.js must equal the approved Stage 1 production bundle');
});
