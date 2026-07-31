#!/usr/bin/env node
// Deterministic, STAGED bundle publisher (VIF Phase 4A1) — fs layer over publishPlan.js.
//
// Publishes webpack's generated artifacts from dist/ to the repo root (the
// GitHub Pages publish source) SAFELY:
//   - validates every filename against the managed contract (publishPlan.js),
//   - rejects any managed-looking path that is not a REAL regular file
//     (symlinks, directories, sockets, devices are fatal, never followed),
//   - FAILS CLOSED if Git state cannot be determined and refuses to publish over
//     a dirty managed root artifact,
//   - stages new/changed artifacts to temporary siblings, verifies each by
//     SHA-256, and only then atomically renames them into place,
//   - removes stale numeric chunks ONLY after the new set is installed,
//   - on ANY post-install failure prints exact Git recovery for the captured
//     pre-publication set (it does NOT claim to auto-rollback),
//   - cleans temporary files on any failure and exits nonzero,
//   - never touches non-managed files (index.html, CNAME, assets, docs, source).
//
// Recovery is Git, not a bespoke engine. It restores the pre-publication tracked
// artifacts and cleans any newly installed (untracked) chunk:
//   git restore -- chat.bundle.js <pre-existing numeric chunks>
//   git clean -f -- <newly installed chunks>
//
// Usage:
//   node scripts/publish-bundle.js --dry-run   # validate + plan; writes NOTHING
//   node scripts/publish-bundle.js             # staged install + verify
//
// The core is exported as runPublish({...}) so adversarial tests can drive it
// against temporary fixture directories and temporary Git repositories.

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
// entries are ignored entirely. Returns {files, errors}.
function inspectDir(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return { files: [], errors: [`cannot read directory ${dir}`] }; }
  const files = [];
  const errors = [];
  for (const name of names) {
    if (!isManagedName(name)) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { errors.push(`cannot lstat managed path ${full}`); continue; }
    if (st.isSymbolicLink()) { errors.push(`managed path is a symlink (rejected, not followed): ${full}`); continue; }
    if (!st.isFile()) { errors.push(`managed path is not a regular file (rejected): ${full}`); continue; }
    files.push({ name, hash: sha256File(full) });
  }
  return { files, errors };
}

// STRUCTURED, fail-closed dirty check. Returns:
//   { ok:true, dirty:[names] }            — Git queried successfully
//   { ok:false, error:'git_status_failed' } — Git unavailable / not a repo / status failed
// Uses porcelain -z (NUL-delimited) and parses deliberately. Never surfaces raw
// output for unrelated repository state.
function gitDirtyManaged(rootDir, managedNames) {
  // Recovery is Git-based, so Git MUST be available even for a pure-add publish:
  // confirm we are inside a work tree first, and fail closed otherwise.
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: rootDir, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {
    return { ok: false, error: 'git_status_failed' };
  }
  if (!managedNames.length) return { ok: true, dirty: [] };
  let out;
  try {
    out = execFileSync('git', ['status', '--porcelain', '-z', '--', ...managedNames], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return { ok: false, error: 'git_status_failed' };
  }
  const dirty = new Set();
  // -z records: "XY <path>\0" (and for renames a second "<path>\0"). We pass an
  // explicit managed pathspec, so every emitted path is a managed artifact.
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const p = rec.length >= 4 && rec[2] === ' ' ? rec.slice(3) : rec; // status-prefixed or bare rename source
    const base = path.basename(p);
    if (managedNames.includes(base)) dirty.add(base);
  }
  return { ok: true, dirty: [...dirty] };
}

function tempNameFor(name) {
  const t = `.pub-staging.${name}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  if (isManagedName(t)) throw new Error(`staging name collided with managed contract: ${t}`);
  return t;
}

// Deterministic ordering for recovery output: bundle first, then numeric chunks
// ascending, then anything else lexically. Purely cosmetic (stable messages).
function orderManaged(names) {
  const bundle = names.filter((n) => n === BUNDLE_NAME);
  const rest = names.filter((n) => n !== BUNDLE_NAME).sort((a, b) => {
    const na = parseInt(a, 10); const nb = parseInt(b, 10);
    return (Number.isNaN(na) || Number.isNaN(nb)) ? a.localeCompare(b) : na - nb;
  });
  return [...bundle, ...rest];
}

// Build the Git recovery instruction from the PRE-PUBLICATION captured set.
// Restores pre-existing tracked artifacts; cleans newly installed (untracked) chunks.
function buildRecovery(preManagedNames, newlyInstalledNames) {
  const restore = orderManaged(preManagedNames.length ? preManagedNames.slice() : [BUNDLE_NAME]);
  const lines = [`  git restore -- ${restore.join(' ')}`];
  if (newlyInstalledNames.length) lines.push(`  git clean -f -- ${orderManaged(newlyInstalledNames.slice()).join(' ')}`);
  return lines.join('\n');
}

// Best-effort removal of temporary staging files. Never throws.
function cleanup(rootDir, temps) {
  for (const t of temps) { try { fs.rmSync(path.join(rootDir, t), { force: true }); } catch {} }
}

// Core. Returns { exitCode, report, messages }. Never calls process.exit.
function runPublish(opts) {
  const { distDir, rootDir } = opts;
  const dryRun = !!opts.dryRun;
  const dirtyChecker = opts.dirtyChecker || gitDirtyManaged;
  const log = opts.log || (() => {});
  // Test-only seams; production defaults are real fs so behavior is unchanged.
  const copyFile = opts.copyFile || ((s, d) => fs.copyFileSync(s, d));
  const renameFile = opts.renameFile || ((s, d) => fs.renameSync(s, d));
  const removeFile = opts.removeFile || ((p) => fs.rmSync(p, { force: true }));
  const finalHashFile = opts.finalHashFile || sha256File;
  const finalInspect = opts.finalInspect || inspectDir;

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

  // 3. Plan.
  const plan = computePublishPlan({ distFiles: distI.files, rootFiles: rootI.files });
  if (!plan.ok) { for (const p of plan.problems) say(`  ✘ ${p}`); return fail(1, 'plan validation failed'); }

  const rootManagedNames = rootI.files.map((f) => f.name); // pre-publication managed set

  // 4. Dirty managed-artifact guard — FAIL CLOSED (applies to dry-run too).
  const dirtyRes = dirtyChecker(rootDir, rootManagedNames);
  if (!dirtyRes || dirtyRes.ok !== true) {
    return fail(1, `cannot determine Git state (${(dirtyRes && dirtyRes.error) || 'git_status_failed'}) — refusing to publish`);
  }
  if (dirtyRes.dirty.length) {
    say(`  ✘ uncommitted changes in managed artifact(s): ${dirtyRes.dirty.join(', ')}`);
    say(`    resolve first, e.g.:  git restore -- ${dirtyRes.dirty.join(' ')}`);
    return fail(1, 'managed artifacts are not clean');
  }

  const distMap = new Map(distI.files.map((f) => [f.name, f.hash]));

  // Report intent.
  say(`\ncopy/replace (${plan.toCopy.length}):`);
  for (const c of plan.toCopy) say(`  ${dryRun ? 'would ' : ''}${c.reason === 'new' ? 'copy   ' : 'replace'} ${c.name} [${c.reason}] ${short(distMap.get(c.name))}`);
  if (plan.unchanged.length) say(`unchanged (${plan.unchanged.length}): ${plan.unchanged.join(', ')}`);
  say(`remove stale numeric chunks (${plan.toRemove.length}): ${plan.toRemove.map((r) => r.name).join(', ') || '(none)'}`);

  // 5. DRY-RUN stops here: no temps, no copies, no renames, no removals.
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

  // --- capture the PRE-PUBLICATION set for recovery (before any write) ---
  const preManagedNames = rootManagedNames.slice();
  const newlyInstalled = plan.toCopy.filter((c) => c.reason === 'new').map((c) => c.name);
  const recovery = buildRecovery(preManagedNames, newlyInstalled);
  const failInstalled = (code, m) => { say(`✘ ${m}`); say('  RECOVERY (restores the committed pre-publication artifacts; no automatic rollback was performed):'); say(recovery); return { exitCode: code, report: null, messages }; };

  let installBegun = false;
  const staged = [];   // { temp, finalName }
  const renamed = [];

  // 6-7. Stage temps + verify each against dist (pre-install; no recovery needed).
  for (const c of plan.toCopy) {
    const temp = tempNameFor(c.name);
    const tempPath = path.join(rootDir, temp);
    try {
      copyFile(path.join(distDir, c.name), tempPath);
    } catch (e) {
      cleanup(rootDir, staged.map((s) => s.temp).concat(temp));
      return fail(3, `staging copy failed for ${c.name}: ${e.message}`);
    }
    const th = sha256File(tempPath);
    if (th !== distMap.get(c.name)) {
      cleanup(rootDir, staged.map((s) => s.temp).concat(temp));
      return fail(2, `staging hash mismatch for ${c.name} (dist ${short(distMap.get(c.name))} != staged ${short(th)})`);
    }
    staged.push({ temp, finalName: c.name });
  }

  // 8. Atomic renames into final names. Any failure after the FIRST rename is post-install.
  for (const s of staged) {
    try {
      renameFile(path.join(rootDir, s.temp), path.join(rootDir, s.finalName));
      installBegun = true;
      renamed.push(s.finalName);
    } catch (e) {
      cleanup(rootDir, staged.filter((x) => !renamed.includes(x.finalName)).map((x) => x.temp));
      if (installBegun) return failInstalled(3, `rename failed for ${s.finalName}: ${e.message}`);
      return fail(3, `rename failed for ${s.finalName}: ${e.message}`);
    }
  }

  // 9. Remove stale numeric chunks ONLY after successful install. Any mutation here is post-install.
  const removed = [];
  if (plan.toRemove.length) installBegun = true;
  for (const r of plan.toRemove) {
    if (!isNumericChunk(r.name)) continue; // triple-guard
    try { removeFile(path.join(rootDir, r.name)); removed.push(r.name); }
    catch (e) { return failInstalled(3, `failed to remove stale ${r.name}: ${e.message}`); }
  }

  // 10. Final inspection + verification (errors here are post-install failures).
  const finalI = finalInspect(rootDir);
  if (finalI.errors && finalI.errors.length) {
    for (const e of finalI.errors) say(`  ✘ ${e}`);
    return failInstalled(4, 'final filesystem inspection failed');
  }
  let mismatches = 0;
  for (const v of plan.verify) {
    const rp = path.join(rootDir, v.name);
    let ok = false;
    try { ok = fs.existsSync(rp) && fs.lstatSync(rp).isFile() && finalHashFile(rp) === v.distHash; } catch { ok = false; }
    if (!ok) mismatches++;
  }
  const finalManaged = finalI.files.map((f) => f.name).filter(isManagedName);
  const unexpected = finalManaged.filter((n) => !plan.finalSet.includes(n));
  if (mismatches > 0 || unexpected.length) {
    return failInstalled(4, `final verification failed (mismatches=${mismatches}, unexpected=${unexpected.join(',') || 'none'})`);
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

// CLI entry.
function main() {
  const dryRun = process.argv.includes('--dry-run');
  const res = runPublish({ distDir: DIST_DIR, rootDir: REPO_ROOT, dryRun, log: (m) => console.log(m) });
  process.exit(res.exitCode);
}

if (require.main === module) main();

module.exports = { runPublish, inspectDir, gitDirtyManaged, tempNameFor, buildRecovery, cleanup, DIST_DIR, REPO_ROOT };
