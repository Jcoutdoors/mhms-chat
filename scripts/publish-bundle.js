#!/usr/bin/env node
// Deterministic bundle publisher (VIF Phase 4A1) — fs CLI over publishPlan.js.
//
// Syncs webpack's generated artifacts from dist/ to the repository root (the
// GitHub Pages publish source), removing only STALE generated chunks, and
// verifies every published file by SHA-256. It never touches non-generated files
// (index.html, CNAME, assets, Markdown, source, config are outside the managed
// set by construction — see publishPlan.js).
//
// Usage:
//   node scripts/publish-bundle.js --dry-run   # report only, writes nothing
//   node scripts/publish-bundle.js             # copy + remove stale + verify
//
// Exit codes: 0 on success (or clean dry-run); non-zero on missing output,
// hash mismatch, or any problem. Prints a clear copied/removed/verified report.
//
// Note: this is the publication step. Phase 4A1 runs it ONLY with --dry-run and
// never against main; the real publish happens at the Phase 4C release gate.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { computePublishPlan, isManagedArtifact, BUNDLE_NAME } = require('./publishPlan.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const DRY_RUN = process.argv.includes('--dry-run');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// List managed generated artifacts in a directory as [{name, hash}]. Missing dir -> [].
function listManaged(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => isManagedArtifact(n))
    .filter((n) => { try { return fs.statSync(path.join(dir, n)).isFile(); } catch { return false; } })
    .map((n) => ({ name: n, hash: sha256(path.join(dir, n)) }));
}

function short(h) { return h ? h.slice(0, 12) : '(none)'; }

function main() {
  const distFiles = listManaged(DIST_DIR);
  const rootFiles = listManaged(REPO_ROOT);
  const plan = computePublishPlan({ distFiles, rootFiles });

  const mode = DRY_RUN ? 'DRY-RUN (no writes)' : 'PUBLISH';
  console.log(`\n== bundle publish — ${mode} ==`);
  console.log(`dist:  ${DIST_DIR}`);
  console.log(`root:  ${REPO_ROOT}`);

  if (!plan.ok) {
    console.error('\nPROBLEMS:');
    for (const p of plan.problems) console.error(`  ✘ ${p}`);
    process.exit(1);
  }

  const distMap = new Map(distFiles.map((f) => [f.name, f.hash]));

  // --- report / apply COPY ---
  console.log(`\ncopy (${plan.toCopy.length}):`);
  for (const c of plan.toCopy) {
    console.log(`  ${DRY_RUN ? 'would copy' : 'copied  '} ${c.name}  [${c.reason}]  ${short(distMap.get(c.name))}`);
    if (!DRY_RUN) fs.copyFileSync(path.join(DIST_DIR, c.name), path.join(REPO_ROOT, c.name));
  }
  if (plan.unchanged.length) console.log(`unchanged (${plan.unchanged.length}): ${plan.unchanged.join(', ')}`);

  // --- report / apply REMOVE (stale managed chunks only) ---
  console.log(`\nremove stale (${plan.toRemove.length}):`);
  for (const r of plan.toRemove) {
    // Safety: never remove anything outside the managed generated set.
    if (!isManagedArtifact(r.name)) continue;
    console.log(`  ${DRY_RUN ? 'would remove' : 'removed    '} ${r.name}  [${r.reason}]`);
    if (!DRY_RUN) fs.rmSync(path.join(REPO_ROOT, r.name), { force: true });
  }

  // --- VERIFY ---
  console.log(`\nverify (${plan.verify.length}):`);
  let mismatches = 0;
  for (const v of plan.verify) {
    const rootPath = path.join(REPO_ROOT, v.name);
    let rootHash = null;
    try { rootHash = fs.existsSync(rootPath) ? sha256(rootPath) : null; } catch { rootHash = null; }
    if (DRY_RUN) {
      const state = rootHash === null ? 'absent (would copy)' : rootHash === v.distHash ? 'match' : 'differs (would copy)';
      console.log(`  ${v.name}: dist ${short(v.distHash)} vs root ${short(rootHash)} -> ${state}`);
    } else {
      const ok = rootHash === v.distHash;
      if (!ok) mismatches++;
      console.log(`  ${v.name}: ${ok ? 'OK' : 'MISMATCH'} dist ${short(v.distHash)} root ${short(rootHash)}`);
    }
  }

  if (!DRY_RUN && mismatches > 0) {
    console.error(`\n✘ ${mismatches} verification mismatch(es) after publish.`);
    process.exit(2);
  }

  console.log(`\n✔ ${DRY_RUN ? 'dry-run complete (nothing written).' : 'publish complete and verified.'}`);
}

main();
