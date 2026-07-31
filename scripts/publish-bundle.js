#!/usr/bin/env node
// Deterministic, STAGED bundle publisher (VIF Phase 4A1) — fs layer over publishPlan.js.
//
// Publishes webpack's generated artifacts from dist/ to the repo root (the
// GitHub Pages publish source) SAFELY:
//   - validates every filename against the managed contract (publishPlan.js),
//   - rejects any managed-looking path that is not a REAL regular file
//     (symlinks, directories, sockets, devices are fatal, never followed),
//   - refuses to run if a managed ROOT artifact has uncommitted changes,
//   - stages new/changed artifacts to temporary siblings, verifies each by
//     SHA-256, and only then atomically renames them into place,
//   - removes stale numeric chunks ONLY after the new set is installed,
//   - cleans temporary files on any failure and exits nonzero,
//   - never touches non-managed files (index.html, CNAME, assets, docs, source).
//
// Recovery from a partial failure is Git, not a bespoke rollback engine:
//   git restore -- chat.bundle.js <numeric chunks>
//
// Usage:
//   node scripts/publish-bundle.js --dry-run   # validate + plan; writes NOTHING
//   node scripts/publish-bundle.js             # staged install + verify
//
// The core is exported as runPublish({distDir, rootDir, dryRun, dirtyChecker, log})
// so adversarial tests can drive it against temporary fixture directories.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  computePublishPlan, isManagedName, isNumericChunk, BUNDLE_NAME,
} = require('./publishPlan.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function short(h) { return h ? h.slice(0, 12) : '(none)'; }

// Inspect a directory: hash managed REGULAR files; treat any managed-looking
// non-regular path (symlink/dir/socket/device) as a FATAL error. Non-managed
// entries are ignored entirely (never stat/hash/touch). Returns {files, errors}.
function inspectDir(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return { files: [], errors: [`cannot read directory ${dir}`] }; }
  const files = [];
  const errors = [];
  for (const name of names) {
    if (!isManagedName(name)) continue; // not managed -> leave alone
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { errors.push(`cannot lstat managed path ${full}`); continue; }
    if (st.isSymbolicLink()) { errors.push(`managed path is a symlink (rejected, not followed): ${full}`); continue; }
    if (!st.isFile()) { errors.push(`managed path is not a regular file (rejected): ${full}`); continue; }
    files.push({ name, hash: sha256File(full) });
  }
  return { files, errors };
}

// Default dirty-artifact checker: which of `managedNames` have uncommitted
// changes in the working tree (staged or unstaged), via `git status --porcelain`.
// Only managed artifacts are considered — unrelated dirty files are ignored.
function gitDirtyManaged(rootDir, managedNames) {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain', '--', ...managedNames], { cwd: rootDir, encoding: 'utf8' });
  } catch {
    return []; // no git / not a repo: skip the guard rather than block
  }
  const dirty = new Set();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const file = line.slice(3).trim();
    const base = path.basename(file);
    if (managedNames.includes(base)) dirty.add(base);
  }
  return [...dirty];
}

function tempNameFor(name) {
  const t = `.pub-staging.${name}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  // Invariant: a staging name must NEVER be a managed artifact name.
  if (isManagedName(t)) throw new Error(`staging name collided with managed contract: ${t}`);
  return t;
}

// Core. Returns { exitCode, report, messages }. Never calls process.exit.
function runPublish(opts) {
  const distDir = opts.distDir;
  const rootDir = opts.rootDir;
  const dryRun = !!opts.dryRun;
  const dirtyChecker = opts.dirtyChecker || gitDirtyManaged;
  const log = opts.log || (() => {});
  // Test-only seams; production defaults to real fs so behavior is unchanged.
  const copyFile = opts.copyFile || ((src, dst) => fs.copyFileSync(src, dst));
  const finalHashFile = opts.finalHashFile || sha256File;
  const messages = [];
  const say = (m) => { messages.push(m); log(m); };
  const fail = (code, m) => { say(`✘ ${m}`); return { exitCode: code, report: null, messages }; };

  say(`\n== bundle publish — ${dryRun ? 'DRY-RUN (no writes)' : 'STAGED PUBLISH'} ==`);
  say(`dist: ${distDir}`);
  say(`root: ${rootDir}`);

  // 1-2. Inspect (validation + fs-type safety) BEFORE any write.
  const distI = inspectDir(distDir);
  const rootI = inspectDir(rootDir);
  const inspectErrors = [...distI.errors, ...rootI.errors];
  if (inspectErrors.length) { for (const e of inspectErrors) say(`  ✘ ${e}`); return fail(1, 'filesystem validation failed'); }

  // 3. Plan (name validity, duplicates, exactly-one-bundle handled in planner).
  const plan = computePublishPlan({ distFiles: distI.files, rootFiles: rootI.files });
  if (!plan.ok) { for (const p of plan.problems) say(`  ✘ ${p}`); return fail(1, 'plan validation failed'); }

  // 4. Dirty managed-artifact guard (managed root artifacts must be clean).
  const rootManagedNames = rootI.files.map((f) => f.name);
  const dirty = dirtyChecker(rootDir, rootManagedNames);
  if (dirty.length) {
    say(`  ✘ uncommitted changes in managed artifact(s): ${dirty.join(', ')}`);
    say(`    resolve first, e.g.:  git restore -- ${dirty.join(' ')}`);
    return fail(1, 'managed artifacts are not clean');
  }

  const distMap = new Map(distI.files.filter((f) => isManagedName(f.name)).map((f) => [f.name, f.hash]));

  // Report intent.
  say(`\ncopy/replace (${plan.toCopy.length}):`);
  for (const c of plan.toCopy) say(`  ${dryRun ? 'would ' : ''}${c.reason === 'new' ? 'copy   ' : 'replace'} ${c.name} [${c.reason}] ${short(distMap.get(c.name))}`);
  if (plan.unchanged.length) say(`unchanged (${plan.unchanged.length}): ${plan.unchanged.join(', ')}`);
  say(`remove stale numeric chunks (${plan.toRemove.length}): ${plan.toRemove.map((r) => r.name).join(', ') || '(none)'}`);

  // 5. DRY-RUN stops here: no temp files, no copies, no renames, no removals.
  if (dryRun) {
    say(`\nverify plan (${plan.verify.length}):`);
    for (const v of plan.verify) {
      const rp = path.join(rootDir, v.name);
      let rootHash = null;
      try { rootHash = fs.existsSync(rp) && fs.lstatSync(rp).isFile() ? sha256File(rp) : null; } catch { rootHash = null; }
      const state = rootHash === null ? 'absent (would copy)' : rootHash === v.distHash ? 'match' : 'differs (would replace)';
      say(`  ${v.name}: dist ${short(v.distHash)} vs root ${short(rootHash)} -> ${state}`);
    }
    say('\n✔ dry-run complete (nothing written).');
    return { exitCode: 0, report: { copied: [], replaced: [], removed: [], unchanged: plan.unchanged, verified: [] }, messages };
  }

  // 6-8. STAGED install: write temps, verify temps, then atomic renames.
  const staged = []; // { temp, finalName }
  const renamed = [];
  const numericChunkList = plan.finalSet.filter(isNumericChunk);
  const restoreCmd = `git restore -- ${BUNDLE_NAME} ${numericChunkList.join(' ')}`.trim();
  try {
    for (const c of plan.toCopy) {
      const temp = tempNameFor(c.name);
      const tempPath = path.join(rootDir, temp);
      copyFile(path.join(distDir, c.name), tempPath);
      // 7. verify staged temp against dist source.
      const th = sha256File(tempPath);
      if (th !== distMap.get(c.name)) {
        cleanup(rootDir, staged.map((s) => s.temp).concat(temp));
        return fail(2, `staging hash mismatch for ${c.name} (dist ${short(distMap.get(c.name))} != staged ${short(th)})`);
      }
      staged.push({ temp, finalName: c.name });
    }
    // 8. atomic renames into final names.
    for (const s of staged) {
      fs.renameSync(path.join(rootDir, s.temp), path.join(rootDir, s.finalName));
      renamed.push(s.finalName);
    }
  } catch (e) {
    // Clean any un-renamed temps; if some renames already happened, direct to git.
    cleanup(rootDir, staged.filter((s) => !renamed.includes(s.finalName)).map((s) => s.temp));
    say(`  ✘ staging/rename failure: ${e.message}`);
    if (renamed.length) say(`    RECOVERY: ${restoreCmd}`);
    return { exitCode: 3, report: null, messages };
  }

  // 9. Remove stale numeric chunks ONLY after successful install.
  const removed = [];
  for (const r of plan.toRemove) {
    if (!isNumericChunk(r.name)) continue; // triple-guard: never remove anything else
    try { fs.rmSync(path.join(rootDir, r.name), { force: true }); removed.push(r.name); }
    catch (e) { say(`  ✘ failed to remove stale ${r.name}: ${e.message}`); return { exitCode: 3, report: null, messages }; }
  }

  // 10. Final verification: every final artifact matches dist; no unexpected extras.
  let mismatches = 0;
  for (const v of plan.verify) {
    const rp = path.join(rootDir, v.name);
    let ok = false;
    try { ok = fs.existsSync(rp) && fs.lstatSync(rp).isFile() && finalHashFile(rp) === v.distHash; } catch { ok = false; }
    if (!ok) mismatches++;
  }
  const finalRoot = inspectDir(rootDir).files.map((f) => f.name).filter(isManagedName);
  const unexpected = finalRoot.filter((n) => !plan.finalSet.includes(n));
  if (mismatches > 0 || unexpected.length) {
    say(`  ✘ final verification failed (mismatches=${mismatches}, unexpected=${unexpected.join(',') || 'none'})`);
    say(`    RECOVERY: ${restoreCmd}`);
    return { exitCode: 4, report: null, messages };
  }

  const copied = plan.toCopy.filter((c) => c.reason === 'new').map((c) => c.name);
  const replaced = plan.toCopy.filter((c) => c.reason === 'changed').map((c) => c.name);
  say(`\ncopied:    ${copied.join(', ') || '(none)'}`);
  say(`replaced:  ${replaced.join(', ') || '(none)'}`);
  say(`removed:   ${removed.join(', ') || '(none)'}`);
  say(`unchanged: ${plan.unchanged.join(', ') || '(none)'}`);
  say(`verified:  ${plan.verify.map((v) => v.name).join(', ')}`);
  say('\n✔ publish complete and verified.');
  return { exitCode: 0, report: { copied, replaced, removed, unchanged: plan.unchanged, verified: plan.verify.map((v) => v.name) }, messages };
}

// Best-effort removal of temporary staging files. Never throws.
function cleanup(rootDir, temps) {
  for (const t of temps) { try { fs.rmSync(path.join(rootDir, t), { force: true }); } catch {} }
}

// CLI entry.
function main() {
  const dryRun = process.argv.includes('--dry-run');
  const res = runPublish({ distDir: DIST_DIR, rootDir: REPO_ROOT, dryRun, log: (m) => console.log(m) });
  process.exit(res.exitCode);
}

if (require.main === module) main();

module.exports = { runPublish, inspectDir, gitDirtyManaged, tempNameFor, cleanup, DIST_DIR, REPO_ROOT };
