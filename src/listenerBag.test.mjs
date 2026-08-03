// listenerBag tests (Phase 4B2). Pure, deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createListenerBag } from './listenerBag.js';

test('dispose invokes every handle once and empties the bag', () => {
  const calls = [];
  const bag = createListenerBag();
  bag.add(() => calls.push('a'));
  bag.add(() => calls.push('b'));
  bag.add(() => calls.push('c'));
  assert.equal(bag.size, 3);
  bag.dispose();
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.equal(bag.size, 0);
  assert.equal(bag.disposed, true);
});

test('dispose is idempotent (handles never fire twice)', () => {
  let n = 0;
  const bag = createListenerBag();
  bag.add(() => { n += 1; });
  bag.dispose();
  bag.dispose();
  assert.equal(n, 1);
});

test('a handle added AFTER disposal is disposed immediately and not retained', () => {
  const calls = [];
  const bag = createListenerBag();
  bag.dispose();
  bag.add(() => calls.push('late')); // stale registration -> immediate cleanup
  assert.deepEqual(calls, ['late']);
  assert.equal(bag.size, 0);
});

test('non-function handles are ignored', () => {
  const bag = createListenerBag();
  bag.add(null);
  bag.add(undefined);
  bag.add(42);
  bag.add({});
  assert.equal(bag.size, 0);
  bag.dispose(); // must not throw
});

test('a throwing handle does not strand the others', () => {
  const calls = [];
  const bag = createListenerBag();
  bag.add(() => calls.push('before'));
  bag.add(() => { throw new Error('boom'); });
  bag.add(() => calls.push('after'));
  bag.dispose(); // must not throw
  assert.deepEqual(calls, ['before', 'after']);
});
