// publish-bundle CLI adversarial tests (Phase 4A1). Temporary fixture dirs ONLY;
// real repo-root runtime artifacts are never touched. Deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runPublish, tempNameFor, buildRecovery } from './publish-bundle.js';
import { isManagedName } from './publishPlan.js';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Structured, fail-closed dirty-check contract: {ok:true, dirty:[]} | {ok:false, error}.
const noGitDirty = () => ({ ok: true, dirty: [] });
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
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, dirtyChecker: () => ({ ok: true, dirty: ['chat.bundle.js'] }), log: quiet });
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

// ================= Re-review: fail-closed dirty check + Git recovery =================

// Build a real temporary Git repo as rootDir (committed rootSpec) + a plain distDir.
function gitFixture(distSpec = {}, committedRootSpec = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-git-'));
  const distDir = path.join(base, 'dist');
  const rootDir = path.join(base, 'repo');
  fs.mkdirSync(distDir); fs.mkdirSync(rootDir);
  for (const [n, v] of Object.entries(distSpec)) fs.writeFileSync(path.join(distDir, n), v);
  const git = (...args) => execFileSync('git', args, { cwd: rootDir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t.test'); git('config', 'user.name', 'T');
  for (const [n, v] of Object.entries(committedRootSpec)) fs.writeFileSync(path.join(rootDir, n), v);
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  return { base, distDir, rootDir, git: (...a) => execFileSync('git', a, { cwd: rootDir, encoding: 'utf8' }) };
}
const read = (dir, n) => fs.readFileSync(path.join(dir, n), 'utf8');
const exists = (dir, n) => fs.existsSync(path.join(dir, n));

// re#1 + re#2: Git dirty-check command failure fails closed — real publish AND dry-run.
test('re#1/#2 non-Git root => dirty check fails closed (real + dry-run), no writes', () => {
  const fx = fixture({ 'chat.bundle.js': 'B' }, {}); // rootDir is NOT a git repo
  for (const dryRun of [false, true]) {
    const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, log: quiet, dryRun }); // default (real) gitDirtyManaged
    assert.equal(res.exitCode, 1, `dryRun=${dryRun}`);
    assert.ok(res.messages.join('\n').includes('git_status_failed'));
    assert.deepEqual(listManaged(fx.rootDir), []); // nothing written
  }
});

// re#9: a clean Git repo proceeds to a successful publish.
test('re#9 clean Git state proceeds to publish', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1', 'index.html': '<x>' });
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, log: quiet }); // real dirty check, clean
  assert.equal(res.exitCode, 0);
  assert.equal(read(fx.rootDir, 'chat.bundle.js'), 'V2');
});

// re#10: a dirty managed artifact blocks before any write (real Git).
test('re#10 dirty managed artifact blocks before any write (real Git)', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1' });
  fs.writeFileSync(path.join(fx.rootDir, 'chat.bundle.js'), 'LOCAL-EDIT'); // uncommitted change
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, log: quiet });
  assert.equal(res.exitCode, 1);
  assert.ok(res.messages.join('\n').includes('uncommitted changes'));
  assert.equal(read(fx.rootDir, 'chat.bundle.js'), 'LOCAL-EDIT'); // not overwritten
});

// re#3: recovery lists a pre-existing stale chunk (restore), not clean.
test('re#3 recovery includes a pre-existing stale chunk in git restore', () => {
  const fx = fixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1', '387.chunk.js': 'C1' });
  const res = run(fx, { finalHashFile: () => 'wrong' }); // force post-install failure
  assert.equal(res.exitCode, 4);
  const blob = res.messages.join('\n');
  assert.ok(/git restore -- .*chat\.bundle\.js.*387\.chunk\.js/.test(blob), 'restore lists stale pre-existing chunk');
  assert.equal(blob.includes('git clean'), false, 'no new files to clean');
});

// re#4: recovery cleans a newly installed chunk that did not exist before.
test('re#4 recovery cleans a newly installed chunk', () => {
  const fx = fixture({ 'chat.bundle.js': 'V2', '555.chunk.js': 'N' }, { 'chat.bundle.js': 'V1' });
  const res = run(fx, { finalHashFile: () => 'wrong' });
  assert.equal(res.exitCode, 4);
  assert.ok(res.messages.join('\n').includes('git clean -f -- 555.chunk.js'));
});

// re#5: stale-removal failure prints recovery.
test('re#5 stale-removal failure prints recovery', () => {
  const fx = fixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1', '999.chunk.js': 'stale' });
  const res = run(fx, { removeFile: () => { throw new Error('EPERM'); } });
  assert.equal(res.exitCode, 3);
  const blob = res.messages.join('\n');
  assert.ok(blob.includes('RECOVERY'));
  assert.ok(blob.includes('git restore --'));
});

// re#6: partial rename failure prints recovery.
test('re#6 partial final-rename failure prints recovery', () => {
  const fx = fixture({ 'chat.bundle.js': 'B', '555.chunk.js': 'N' }, {}); // two new files to rename
  let calls = 0;
  const renameFail2nd = (s, d) => { calls++; if (calls >= 2) throw new Error('rename EIO'); fs.renameSync(s, d); };
  const res = run(fx, { renameFile: renameFail2nd });
  assert.equal(res.exitCode, 3);
  assert.ok(res.messages.join('\n').includes('RECOVERY'));
});

// re#7: final inspectDir error is fatal with recovery.
test('re#7 final inspection error is fatal with recovery', () => {
  const fx = fixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1' });
  const badFinalInspect = () => ({ files: [], errors: ['managed path is a symlink (rejected, not followed): /x'] });
  const res = run(fx, { finalInspect: badFinalInspect });
  assert.equal(res.exitCode, 4);
  const blob = res.messages.join('\n');
  assert.ok(blob.includes('final filesystem inspection failed'));
  assert.ok(blob.includes('RECOVERY'));
});

// re#8: after a partial publish (replace + stale remove + new add) that fails final
// verify, the printed Git recovery restores the exact committed pre-publication set.
test('re#8 Git recovery restores committed pre-publication set after final-verify failure', () => {
  const fx = gitFixture(
    { 'chat.bundle.js': 'V2', '555.chunk.js': 'NEW' },
    { 'chat.bundle.js': 'V1', '387.chunk.js': 'C1' },
  );
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, log: quiet, finalHashFile: () => 'wrong' });
  assert.equal(res.exitCode, 4);
  // The tool has already mutated the tree: bundle replaced, 387 removed, 555 added.
  assert.equal(read(fx.rootDir, 'chat.bundle.js'), 'V2');
  assert.equal(exists(fx.rootDir, '387.chunk.js'), false);
  assert.equal(exists(fx.rootDir, '555.chunk.js'), true);
  // Recovery instruction must name both restore and clean parts.
  const rec = buildRecovery(['chat.bundle.js', '387.chunk.js'], ['555.chunk.js']);
  assert.ok(res.messages.join('\n').includes('git restore -- chat.bundle.js 387.chunk.js'));
  assert.ok(res.messages.join('\n').includes('git clean -f -- 555.chunk.js'));
  // Execute the recovery and confirm the committed pre-publication state is restored.
  fx.git('restore', '--', 'chat.bundle.js', '387.chunk.js');
  fx.git('clean', '-f', '--', '555.chunk.js');
  assert.equal(read(fx.rootDir, 'chat.bundle.js'), 'V1', 'bundle restored');
  assert.equal(read(fx.rootDir, '387.chunk.js'), 'C1', 'stale chunk restored');
  assert.equal(exists(fx.rootDir, '555.chunk.js'), false, 'new chunk cleaned');
  // And the repo is clean again.
  assert.equal(fx.git('status', '--porcelain').trim(), '');
});

// ============ Re-review 2: deleted / staged / untracked managed artifacts ============

const noTemps = (dir) => assert.deepEqual(stagingTemps(dir), []);
function expectBlocked(fx, extra = {}) {
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, log: quiet, ...extra });
  assert.equal(res.exitCode, 1, 'must block');
  assert.ok(res.messages.join('\n').includes('uncommitted changes'), 'reports uncommitted managed change');
  noTemps(fx.rootDir); // no writes
  return res;
}

// del#1 unstaged deletion of tracked chat.bundle.js blocks publication
test('del#1 unstaged deletion of tracked chat.bundle.js blocks', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1', '387.chunk.js': 'C1' });
  fs.rmSync(path.join(fx.rootDir, 'chat.bundle.js'));            // worktree deletion (unstaged)
  const res = expectBlocked(fx);
  assert.ok(res.messages.join('\n').includes('chat.bundle.js'));
  assert.equal(exists(fx.rootDir, 'chat.bundle.js'), false, 'not recreated by a blocked publish');
  assert.equal(read(fx.rootDir, '387.chunk.js'), 'C1');         // untouched
});

// del#2 staged deletion of tracked chat.bundle.js blocks
test('del#2 staged deletion of tracked chat.bundle.js blocks', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1' });
  fx.git('rm', '-q', 'chat.bundle.js');                         // staged deletion
  const res = expectBlocked(fx);
  assert.ok(res.messages.join('\n').includes('chat.bundle.js'));
});

// del#3 unstaged deletion of a tracked numeric chunk blocks
test('del#3 unstaged deletion of a tracked numeric chunk blocks', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V1' }, { 'chat.bundle.js': 'V1', '387.chunk.js': 'C1' });
  fs.rmSync(path.join(fx.rootDir, '387.chunk.js'));
  const res = expectBlocked(fx);
  assert.ok(res.messages.join('\n').includes('387.chunk.js'));
});

// del#4 staged deletion of a tracked numeric chunk blocks
test('del#4 staged deletion of a tracked numeric chunk blocks', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V1' }, { 'chat.bundle.js': 'V1', '387.chunk.js': 'C1' });
  fx.git('rm', '-q', '387.chunk.js');
  const res = expectBlocked(fx);
  assert.ok(res.messages.join('\n').includes('387.chunk.js'));
});

// del#5 the same deleted-file condition blocks a DRY-RUN
test('del#5 a deleted tracked managed artifact also blocks dry-run', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1' });
  fs.rmSync(path.join(fx.rootDir, 'chat.bundle.js'));
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, log: quiet, dryRun: true });
  assert.equal(res.exitCode, 1);
  assert.ok(res.messages.join('\n').includes('uncommitted changes'));
  noTemps(fx.rootDir);
});

// del#6 an untracked numeric chunk at root blocks publication
test('del#6 an untracked numeric chunk at root blocks', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1' });
  fs.writeFileSync(path.join(fx.rootDir, '999.chunk.js'), 'UNTRACKED'); // untracked managed chunk
  const res = expectBlocked(fx);
  assert.ok(res.messages.join('\n').includes('999.chunk.js'));
  assert.equal(read(fx.rootDir, 'chat.bundle.js'), 'V1', 'no writes');
});

// del#7 an untracked NON-numeric vendor.chunk.js does NOT block and stays untouched
test('del#7 untracked vendor.chunk.js does not block and is untouched', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1' });
  fs.writeFileSync(path.join(fx.rootDir, 'vendor.chunk.js'), 'VENDOR'); // non-managed
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, log: quiet });
  assert.equal(res.exitCode, 0, 'clean managed set -> publishes');
  assert.equal(read(fx.rootDir, 'chat.bundle.js'), 'V2', 'bundle updated');
  assert.equal(read(fx.rootDir, 'vendor.chunk.js'), 'VENDOR', 'non-managed file untouched');
});

// del#8 a clean repository publishes successfully
test('del#8 a clean repository publishes successfully', () => {
  const fx = gitFixture({ 'chat.bundle.js': 'V2' }, { 'chat.bundle.js': 'V1' });
  const res = runPublish({ distDir: fx.distDir, rootDir: fx.rootDir, log: quiet });
  assert.equal(res.exitCode, 0);
  assert.equal(read(fx.rootDir, 'chat.bundle.js'), 'V2');
});
