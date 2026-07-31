// publish-bundle CLI adversarial tests (Phase 4A1). Temporary fixture dirs ONLY;
// real repo-root runtime artifacts are never touched. Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runPublish, tempNameFor } from './publish-bundle.js';
import { isManagedName } from './publishPlan.js';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const noGitDirty = () => [];        // tests never depend on git
const quiet = () => {};

// Build { distDir, rootDir } under a fresh temp base. Specs map name -> content
// string; a value of DIR makes a directory; a [SYMLINK, target] makes a symlink.
const DIR = Symbol('dir');
const SYMLINK = Symbol('symlink');
function fixture(distSpec = {}, rootSpec = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-cli-'));
  const distDir = path.join(base, 'dist');
  const rootDir = path.join(base, 'root');
  fs.mkdirSync(distDir); fs.mkdirSync(rootDir);
  const apply = (dir, spec) => {
    for (const [name, val] of Object.entries(spec)) {
      const p = path.join(dir, name);
      if (val === DIR) fs.mkdirSync(p);
      else if (Array.isArray(val) && val[0] === SYMLINK) fs.symlinkSync(val[1], p);
      else fs.writeFileSync(p, val);
    }
  };
  apply(distDir, distSpec); apply(rootDir, rootSpec);
  return { base, distDir, rootDir };
}
function listManaged(dir) { return fs.readdirSync(dir).filter(isManagedName).sort(); }
function stagingTemps(dir) { return fs.readdirSync(dir).filter((n) => n.startsWith('.pub-staging.')); }
function run(fx, extra = {}) { return runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, dirtyChecker: noGitDirty, log: quiet, ...extra }); }

// #12
test('#12 staging temp names never match the managed contract', () => {
  for (const n of ['chat.bundle.js', '387.chunk.js', '0.chunk.js']) {
    for (let i = 0; i < 5; i++) assert.equal(isManagedName(tempNameFor(n)), false, `${n} -> temp is managed?!`);
  }
});

// #2
test('#2 a directory at a managed dist path is a fatal error (no writes)', () => {
  const fx = fixture({ 'chat.bundle.js': DIR }, {});
  const res = run(fx);
  assert.equal(res.exitCode, 1);
  assert.ok(res.messages.join('\n').includes('not a regular file'));
  assert.deepEqual(listManaged(fx.rootDir), []);
});

// #3
test('#3 a symlink in dist is rejected and never followed', () => {
  const fx = fixture({ 'chat.bundle.js': 'B', 'real': 'x', '387.chunk.js': [SYMLINK, 'real'] }, {});
  const res = run(fx);
  assert.equal(res.exitCode, 1);
  assert.ok(res.messages.join('\n').toLowerCase().includes('symlink'));
  assert.deepEqual(listManaged(fx.rootDir), []); // nothing installed
});

// #4
test('#4 a managed symlink at root is rejected', () => {
  const fx = fixture({ 'chat.bundle.js': 'B' }, { 'real': 'x', 'chat.bundle.js': [SYMLINK, 'real'] });
  const res = run(fx);
  assert.equal(res.exitCode, 1);
  assert.ok(res.messages.join('\n').toLowerCase().includes('symlink'));
});

// #13
test('#13 staging hash mismatch => nonzero, temps cleaned, no final install', () => {
  const fx = fixture({ 'chat.bundle.js': 'GOOD' }, {});
  const badCopy = (src, dst) => fs.writeFileSync(dst, 'CORRUPT'); // writes wrong bytes
  const res = run(fx, { copyFile: badCopy });
  assert.equal(res.exitCode, 2);
  assert.deepEqual(stagingTemps(fx.rootDir), []);            // #15 cleanup
  assert.deepEqual(listManaged(fx.rootDir), []);            // not installed
});

// #14
test('#14 staging copy failure => nonzero, temps cleaned', () => {
  const fx = fixture({ 'chat.bundle.js': 'B' }, {});
  const throwCopy = () => { throw new Error('EIO simulated'); };
  const res = run(fx, { copyFile: throwCopy });
  assert.equal(res.exitCode, 3);
  assert.deepEqual(stagingTemps(fx.rootDir), []);            // #15 cleanup
  assert.deepEqual(listManaged(fx.rootDir), []);
});

// #16
test('#16 stale numeric chunk is NOT removed when staging fails', () => {
  const fx = fixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1', '999.chunk.js': 'stale' });
  const throwCopy = () => { throw new Error('boom'); };
  const res = run(fx, { copyFile: throwCopy });
  assert.notEqual(res.exitCode, 0);
  assert.equal(fs.existsSync(path.join(fx.rootDir, '999.chunk.js')), true, 'stale must survive a failed publish');
});

// #17
test('#17 stale numeric chunk removed only after a successful install', () => {
  const fx = fixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1', '999.chunk.js': 'stale' });
  const res = run(fx);
  assert.equal(res.exitCode, 0);
  assert.equal(fs.existsSync(path.join(fx.rootDir, '999.chunk.js')), false, 'stale removed');
  assert.equal(sha(fs.readFileSync(path.join(fx.rootDir, 'chat.bundle.js'))), sha(Buffer.from('V2')));
  assert.deepEqual(res.report.removed, ['999.chunk.js']);
  assert.deepEqual(res.report.replaced, ['chat.bundle.js']);
});

// #18
test('#18 final hash mismatch returns nonzero with git-restore recovery', () => {
  const fx = fixture({ 'chat.bundle.js': 'B', '555.chunk.js': 'N' }, {});
  const wrongFinalHash = () => 'deadbeef'; // final verify always mismatches
  const res = run(fx, { finalHashFile: wrongFinalHash });
  assert.equal(res.exitCode, 4);
  assert.ok(res.messages.join('\n').includes('git restore -- chat.bundle.js'));
});

// #19
test('#19 dry-run performs no writes and no timestamp changes', () => {
  const fx = fixture({ 'chat.bundle.js': 'NEW', '555.chunk.js': 'N' }, { 'chat.bundle.js': 'OLD', 'index.html': '<x>' });
  const before = fs.readdirSync(fx.rootDir).map((n) => [n, fs.statSync(path.join(fx.rootDir, n)).mtimeMs]).sort();
  const res = run(fx, { dryRun: true });
  assert.equal(res.exitCode, 0);
  assert.deepEqual(stagingTemps(fx.rootDir), []);
  const after = fs.readdirSync(fx.rootDir).map((n) => [n, fs.statSync(path.join(fx.rootDir, n)).mtimeMs]).sort();
  assert.deepEqual(after, before, 'no files added/removed, no mtimes changed');
  assert.equal(fs.readFileSync(path.join(fx.rootDir, 'chat.bundle.js'), 'utf8'), 'OLD', 'not replaced');
  assert.equal(fs.existsSync(path.join(fx.rootDir, '555.chunk.js')), false, 'not copied');
});

// #20
test('#20 a dirty managed root artifact causes failure before any write', () => {
  const fx = fixture({ 'chat.bundle.js': 'B2' }, { 'chat.bundle.js': 'B1' });
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, dirtyChecker: () => ['chat.bundle.js'], log: quiet });
  assert.equal(res.exitCode, 1);
  assert.ok(res.messages.join('\n').includes('uncommitted changes'));
  assert.equal(fs.readFileSync(path.join(fx.rootDir, 'chat.bundle.js'), 'utf8'), 'B1', 'not modified');
});

// #21
test('#21 a newly emitted numeric chunk installs correctly and verifies', () => {
  const fx = fixture({ 'chat.bundle.js': 'SAME', '555.chunk.js': 'FRESH' }, { 'chat.bundle.js': 'SAME' });
  const res = run(fx);
  assert.equal(res.exitCode, 0);
  assert.equal(sha(fs.readFileSync(path.join(fx.rootDir, '555.chunk.js'))), sha(Buffer.from('FRESH')));
  assert.deepEqual(res.report.copied, ['555.chunk.js']);
  assert.deepEqual(res.report.unchanged, ['chat.bundle.js']);
  assert.deepEqual(listManaged(fx.rootDir), ['555.chunk.js', 'chat.bundle.js']);
});

// unrelated root files preserved through a real install (#11 at fs level)
test('unrelated root files (index.html/CNAME) survive a real publish', () => {
  const fx = fixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1', 'index.html': '<html>', 'CNAME': 'chat.example' });
  const res = run(fx);
  assert.equal(res.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(fx.rootDir, 'index.html'), 'utf8'), '<html>');
  assert.equal(fs.readFileSync(path.join(fx.rootDir, 'CNAME'), 'utf8'), 'chat.example');
});
