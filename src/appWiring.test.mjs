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
// Slice the ActiveThreadWatcher component body for focused assertions.
function activeThreadWatcherBody() {
  const start = INDEX.indexOf('function ActiveThreadWatcher(');
  assert.ok(start > 0, 'ActiveThreadWatcher present');
  return INDEX.slice(start, INDEX.indexOf('\n}\n', start) + 3);
}

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

test('10. ActiveThreadWatcher performs no duplicate thread markRead', () => {
  assert.equal(activeThreadWatcherBody().includes('markRead'), false, 'runtime owns thread markRead');
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

test('16. the committed root chat.bundle.js is unchanged (production bundle not modified)', () => {
  const hash = createHash('sha256').update(readFileSync(ROOT_BUNDLE)).digest('hex');
  assert.equal(hash, '9c7fbc64ccbc10c72396079ff7ccc9b103ee417d7402e7afaa20e6127d2b703b',
    'committed root chat.bundle.js must remain the reviewed production bundle');
});
