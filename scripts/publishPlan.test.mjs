// publishPlan tests (Phase 4A1). Pure planner; no filesystem. Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLE_NAME, isManagedArtifact, computePublishPlan } from './publishPlan.js';

test('isManagedArtifact matches only webpack outputs', () => {
  assert.equal(isManagedArtifact('chat.bundle.js'), true);
  assert.equal(isManagedArtifact('387.chunk.js'), true);
  assert.equal(isManagedArtifact('abc.chunk.js'), true);
  // Everything else at the repo root is NOT managed and must never be touched.
  for (const n of ['index.html', 'CNAME', 'favicon.ico', 'atlas-hero-white.png', 'README.md', 'src/index.jsx', 'webpack.config.js', 'package.json']) {
    assert.equal(isManagedArtifact(n), false, n);
  }
});

test('new chunk copied, stale chunk removed, unchanged left alone', () => {
  const plan = computePublishPlan({
    distFiles: [
      { name: 'chat.bundle.js', hash: 'BUNDLE_NEW' },
      { name: '387.chunk.js', hash: 'H387' },     // unchanged
      { name: '999.chunk.js', hash: 'H999' },     // new
    ],
    rootFiles: [
      { name: 'chat.bundle.js', hash: 'BUNDLE_OLD' }, // changed
      { name: '387.chunk.js', hash: 'H387' },          // unchanged
      { name: '760.chunk.js', hash: 'H760' },          // stale (not in dist)
      { name: 'index.html', hash: 'X' },               // not managed -> ignored
    ],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.toCopy.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: '999.chunk.js', reason: 'new' },
    { name: 'chat.bundle.js', reason: 'changed' },
  ]);
  assert.deepEqual(plan.unchanged, ['387.chunk.js']);
  assert.deepEqual(plan.toRemove, [{ name: '760.chunk.js', reason: 'stale' }]);
  // index.html is never in any list.
  const allNames = [...plan.toCopy, ...plan.toRemove].map((f) => f.name).concat(plan.unchanged);
  assert.equal(allNames.includes('index.html'), false);
});

test('missing generated bundle in dist is a fatal problem', () => {
  const plan = computePublishPlan({
    distFiles: [{ name: '387.chunk.js', hash: 'H' }], // no chat.bundle.js
    rootFiles: [{ name: 'chat.bundle.js', hash: 'H' }],
  });
  assert.equal(plan.ok, false);
  assert.ok(plan.problems.some((p) => p.includes(BUNDLE_NAME)));
});

test('a dist artifact with no hash is flagged', () => {
  const plan = computePublishPlan({
    distFiles: [{ name: 'chat.bundle.js', hash: '' }],
    rootFiles: [],
  });
  assert.equal(plan.ok, false);
  assert.ok(plan.problems.some((p) => p.includes('no hash')));
});

test('identical dist and root => nothing to copy or remove', () => {
  const files = [
    { name: 'chat.bundle.js', hash: 'B' },
    { name: '387.chunk.js', hash: 'C' },
  ];
  const plan = computePublishPlan({ distFiles: files, rootFiles: files });
  assert.equal(plan.ok, true);
  assert.equal(plan.toCopy.length, 0);
  assert.equal(plan.toRemove.length, 0);
  assert.deepEqual(plan.unchanged.sort(), ['387.chunk.js', 'chat.bundle.js']);
  assert.equal(plan.verify.length, 2);
});
