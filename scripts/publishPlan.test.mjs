// publishPlan tests (Phase 4A1, hardened). Pure planner + filename contract.
// No filesystem. Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLE_NAME, MANAGED_CHUNK_RE, validateName, isManagedName, isNumericChunk, computePublishPlan } from './publishPlan.js';

test('managed contract: only chat.bundle.js and ^[0-9]+\\.chunk\\.js$', () => {
  assert.equal(isManagedName('chat.bundle.js'), true);
  assert.equal(isManagedName('387.chunk.js'), true);
  assert.equal(isManagedName('0.chunk.js'), true);
  // NON-managed look-alikes must be left untouched:
  for (const n of ['vendor.chunk.js', 'custom.chunk.js', 'chunk.js', 'a.chunk.js.bak', 'chunky.js', 'index.html', 'CNAME', 'README.md', '387.chunk.JS', 'chat.bundle.js.map']) {
    assert.equal(isManagedName(n), false, n);
  }
  assert.equal(MANAGED_CHUNK_RE.test('387.chunk.js'), true);
  assert.equal(isNumericChunk('387.chunk.js'), true);
  assert.equal(isNumericChunk('chat.bundle.js'), false);
});

test('validateName rejects structurally unsafe names', () => {
  for (const [n, reason] of [['', 'empty'], ['.', 'dot-segment'], ['..', 'dot-segment'], ['a/b.js', 'path-separator'], ['a\\b.js', 'path-separator'], ['/abs/chat.bundle.js', 'path-separator'], ['x\0y', 'null-byte']]) {
    const v = validateName(n);
    assert.equal(v.ok, false, `${JSON.stringify(n)} should be invalid`);
    assert.equal(v.reason, reason);
  }
  assert.equal(validateName(42).ok, false);
  assert.equal(validateName('chat.bundle.js').ok, true);
});

// #1
test('#1 missing dist/chat.bundle.js => plan not ok', () => {
  const p = computePublishPlan({ distFiles: [{ name: '387.chunk.js', hash: 'h' }], rootFiles: [] });
  assert.equal(p.ok, false);
  assert.ok(p.problems.some((x) => x.includes(BUNDLE_NAME)));
});

// #5 path traversal, #6 nested path, #7 absolute path — all rejected as invalid input
test('#5/#6/#7 traversal, nested, and absolute names are rejected', () => {
  for (const bad of ['../evil.chunk.js', 'a/387.chunk.js', '/abs/chat.bundle.js', '..\\387.chunk.js']) {
    const p = computePublishPlan({ distFiles: [{ name: 'chat.bundle.js', hash: 'B' }, { name: bad, hash: 'x' }], rootFiles: [] });
    assert.equal(p.ok, false, bad);
    assert.ok(p.problems.some((m) => m.includes('invalid filename')), bad);
  }
});

// #8 duplicate planner names rejected
test('#8 duplicate filenames in a list are rejected', () => {
  const p = computePublishPlan({
    distFiles: [{ name: 'chat.bundle.js', hash: 'B' }, { name: '387.chunk.js', hash: 'A' }, { name: '387.chunk.js', hash: 'A2' }],
    rootFiles: [],
  });
  assert.equal(p.ok, false);
  assert.ok(p.problems.some((m) => m.includes('duplicate')));
});

// #9 numeric chunk accepted (planned for copy)
test('#9 a numeric chunk is accepted and planned', () => {
  const p = computePublishPlan({ distFiles: [{ name: 'chat.bundle.js', hash: 'B' }, { name: '555.chunk.js', hash: 'N' }], rootFiles: [{ name: 'chat.bundle.js', hash: 'B' }] });
  assert.equal(p.ok, true);
  assert.deepEqual(p.toCopy, [{ name: '555.chunk.js', reason: 'new' }]);
  assert.deepEqual(p.finalSet.sort(), ['555.chunk.js', 'chat.bundle.js']);
});

// #10 non-numeric *.chunk.js preserved (ignored, never copied/removed)
test('#10 non-numeric *.chunk.js is preserved (ignored by the plan)', () => {
  const p = computePublishPlan({
    distFiles: [{ name: 'chat.bundle.js', hash: 'B' }],
    rootFiles: [{ name: 'chat.bundle.js', hash: 'B' }, { name: 'vendor.chunk.js', hash: 'V' }],
  });
  assert.equal(p.ok, true);
  const touched = [...p.toCopy, ...p.toRemove].map((f) => f.name).concat(p.unchanged);
  assert.equal(touched.includes('vendor.chunk.js'), false);
});

// #11 unrelated root files preserved
test('#11 unrelated root files are never in any plan list', () => {
  const p = computePublishPlan({
    distFiles: [{ name: 'chat.bundle.js', hash: 'B' }],
    rootFiles: [{ name: 'chat.bundle.js', hash: 'B' }, { name: 'index.html', hash: 'x' }, { name: 'CNAME', hash: 'y' }, { name: 'chunk.js', hash: 'z' }, { name: 'a.chunk.js.bak', hash: 'w' }],
  });
  assert.equal(p.ok, true);
  const touched = [...p.toCopy, ...p.toRemove].map((f) => f.name).concat(p.unchanged);
  for (const n of ['index.html', 'CNAME', 'chunk.js', 'a.chunk.js.bak']) assert.equal(touched.includes(n), false, n);
});

test('stale numeric chunk (root, absent from dist) is flagged for removal; bundle never stale', () => {
  const p = computePublishPlan({
    distFiles: [{ name: 'chat.bundle.js', hash: 'B2' }],
    rootFiles: [{ name: 'chat.bundle.js', hash: 'B1' }, { name: '999.chunk.js', hash: 'old' }],
  });
  assert.deepEqual(p.toRemove, [{ name: '999.chunk.js', reason: 'stale' }]);
  assert.deepEqual(p.toCopy, [{ name: 'chat.bundle.js', reason: 'changed' }]);
});

test('exactly one bundle required (a second bundle cannot occur — duplicates rejected)', () => {
  const p = computePublishPlan({ distFiles: [{ name: 'chat.bundle.js', hash: 'B' }, { name: 'chat.bundle.js', hash: 'C' }], rootFiles: [] });
  assert.equal(p.ok, false);
  assert.ok(p.problems.some((m) => m.includes('duplicate')));
});
