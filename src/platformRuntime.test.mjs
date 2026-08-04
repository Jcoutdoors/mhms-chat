// platformRuntime contract/behavior tests (Stage 1). Pure/behavioral — no React renderer,
// no App wiring. Run standalone: `node --test src/platformRuntime.test.mjs`.
// (Add to test:phase4b when the App-wiring commit touches package.json.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcileThreadNoteOnOpen, emptyRuntimeState, disposeBagOwned, setupStillOwns } from './platformRuntime.js';

const SRC = readFileSync(new URL('./platformRuntime.js', import.meta.url), 'utf8');
// The hook's contract return is the LAST `return {` in the file (an earlier one belongs to the
// pure reconcileThreadNoteOnOpen helper); the hook body is everything before it.
const RETURN_AT = SRC.lastIndexOf('return {');
const RETURNED = SRC.slice(RETURN_AT, SRC.indexOf('module.exports'));
const HOOK_BODY = SRC.slice(0, RETURN_AT);

// ---- active-thread reconciliation (the pure core of activeThreadChanged) ----
test('opening a thread with a matching note removes it and reports hadNote (unrelated kept)', () => {
  const notes = { t1: { threadId: 't1', preview: 'a' }, t2: { threadId: 't2', preview: 'b' } };
  const r = reconcileThreadNoteOnOpen(notes, 't1');
  assert.equal(r.hadNote, true);
  assert.equal('t1' in r.notes, false);
  assert.deepEqual(r.notes, { t2: notes.t2 });     // unrelated note preserved
  assert.ok('t1' in notes);                          // input not mutated
});

test('opening a thread with no matching note leaves notes unchanged (hadNote false)', () => {
  const notes = { t2: { threadId: 't2' } };
  const r = reconcileThreadNoteOnOpen(notes, 't1');
  assert.equal(r.hadNote, false);
  assert.equal(r.notes, notes);                      // same reference, untouched
});

test('no active thread (null) removes nothing and never touches unrelated notes', () => {
  const notes = { t1: { threadId: 't1' } };
  const r = reconcileThreadNoteOnOpen(notes, null);
  assert.equal(r.hadNote, false);
  assert.deepEqual(r.notes, notes);
  assert.deepEqual(reconcileThreadNoteOnOpen({}, null), { notes: {}, hadNote: false });
});

test('defensive: null notes input yields an empty, hadNote:false result', () => {
  assert.deepEqual(reconcileThreadNoteOnOpen(null, 't1'), { notes: {}, hadNote: false });
});

// ---- complete user-scoped teardown state (issue 1) ----
test('emptyRuntimeState resets ALL user-scoped state; activeId -> configured initial channel', () => {
  assert.deepEqual(emptyRuntimeState('cats-general'), {
    chatClient: null, channelMap: {}, activeId: 'cats-general',
    unreadCounts: {}, mentionCounts: {}, threadNotes: {},
    pendingThread: null, openThreadId: null, pendingFeatured: null,
    featuredUnavailable: false, featuredItems: [],
    channelUnreadReady: false, threadRecoveryReady: false, featuredUpdatesReady: false,
  });
  // the configured initial channel is honored (not hardcoded)
  assert.equal(emptyRuntimeState('cats-mod-3').activeId, 'cats-mod-3');
});

// ---- owned-bag disposal / stale-vs-newer ownership (issues 4) ----
function fakeBag() { let n = 0; return { dispose() { n += 1; }, get disposeCount() { return n; } }; }

test('disposeBagOwned disposes an OWNED bag and clears the owner ref', () => {
  const bag = fakeBag();
  const ownerRef = { current: bag };
  const cleared = disposeBagOwned(bag, ownerRef);
  assert.equal(bag.disposeCount, 1);
  assert.equal(ownerRef.current, null, 'owner ref cleared');
  assert.equal(cleared, true);
});

test('a stale/local bag is disposed but CANNOT clear a newer owner ref', () => {
  const stale = fakeBag();
  const newer = fakeBag();
  const ownerRef = { current: newer };            // a newer setup already installed its bag
  const cleared = disposeBagOwned(stale, ownerRef);
  assert.equal(stale.disposeCount, 1, 'stale bag disposed (its own)');
  assert.equal(newer.disposeCount, 0, 'newer bag NOT disposed');
  assert.equal(ownerRef.current, newer, 'newer owner ref untouched');
  assert.equal(cleared, false);
});

test('disposeBagOwned is a no-op for a null bag', () => {
  const ownerRef = { current: 'x' };
  assert.equal(disposeBagOwned(null, ownerRef), false);
  assert.equal(ownerRef.current, 'x');
});

// ---- setup-operation ownership: current generation AND still-owned bag ----
test('setupStillOwns is valid only for a current generation AND the currently-owned bag', () => {
  const bag = {};
  const owner = { current: bag };
  // 1. current generation + currently owned bag -> valid
  assert.equal(setupStillOwns(() => true, owner, bag), true);
  // 2. stale generation + owned bag -> invalid
  assert.equal(setupStillOwns(() => false, owner, bag), false);
  // 3. current generation + superseded bag (owner now points at a newer bag) -> invalid
  const newer = {};
  assert.equal(setupStillOwns(() => true, { current: newer }, bag), false);
});

test('a same-generation older setup is invalid once a newer bag has replaced it', () => {
  const older = {};
  const newer = {};
  const owner = { current: older };
  assert.equal(setupStillOwns(() => true, owner, older), true, 'older op valid while it owns the bag');
  owner.current = newer;                          // a newer same-generation setup installs its bag
  assert.equal(setupStillOwns(() => true, owner, older), false, 'older op now inert (isCurrent still true)');
  assert.equal(setupStillOwns(() => true, owner, newer), true, 'newer op is the valid owner');
});

test('a superseded local bag disposal cannot dispose or clear the newer bag (ownership rule)', () => {
  const older = { n: 0, dispose() { this.n += 1; } };
  const newer = { n: 0, dispose() { this.n += 1; } };
  const owner = { current: newer };               // newer already owns
  disposeBagOwned(older, owner);                  // older op disposes ITS bag
  assert.equal(older.n, 1);
  assert.equal(newer.n, 0, 'newer bag not disposed');
  assert.equal(owner.current, newer, 'newer ownership preserved');
});

// ---- mobile presentation decoupling (contract revision #2) ----
test('runtime actions do not invoke any mobile presentation behavior', () => {
  assert.equal(/closeMobileNav/.test(SRC), false, 'closeMobileNav dep removed');
  assert.equal(/setMobileNavOpen/.test(SRC), false, 'no mobile-drawer setter call remains');
});

// ---- contract surface (revisions #1, #3, #4): semantic actions, no store/setter leakage ----
test('returned contract exposes semantic actions and leaks no store or raw setter', () => {
  for (const removed of ['getFeaturedAckStore', 'setOpenThread', 'closeThread', 'clearPendingThread', 'upsertThread', 'ensureChannel']) {
    assert.equal(RETURNED.includes(removed), false, `${removed} not in returned contract`);
  }
  for (const semantic of ['activeThreadChanged', 'resolveThreadJump', 'isFeaturedAcknowledged', 'acknowledgeFeatured']) {
    assert.equal(RETURNED.includes(semantic), true, `${semantic} present in returned contract`);
  }
});

test('the internal ack store is still USED internally (retrieval + wrappers) but not returned', () => {
  assert.ok(HOOK_BODY.includes('getFeaturedAckStore()'), 'ack store used internally');
  assert.equal(RETURNED.includes('getFeaturedAckStore'), false, 'ack store not exposed');
});
