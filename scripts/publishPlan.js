// Deterministic bundle-publish PLANNER (VIF Phase 4A1) — pure logic.
//
// Given the generated files in dist/ and the current generated files at the repo
// root (each as { name, hash }), compute exactly what a publish would copy,
// remove (stale chunks), and verify — WITHOUT touching the filesystem. The fs
// CLI (publish-bundle.js) is a thin wrapper around this so the risky decisions
// are unit-testable.
//
// "Managed generated artifacts" are ONLY the webpack outputs: `chat.bundle.js`
// (config `filename`) and `*.chunk.js` (config `chunkFilename` = '[id].chunk.js').
// Nothing else at the repo root is ever considered — index.html, CNAME, assets,
// Markdown, source, and config are outside this set by construction.
//
// Pure CommonJS: no fs, no globals.

'use strict';

const BUNDLE_NAME = 'chat.bundle.js';

// True iff `name` is a webpack-generated runtime artifact this tool manages.
function isManagedArtifact(name) {
  return name === BUNDLE_NAME || /\.chunk\.js$/.test(name);
}

function byName(list) {
  const m = new Map();
  for (const f of list || []) m.set(f.name, f.hash);
  return m;
}

// Compute the publish plan.
//   input: { distFiles:[{name,hash}], rootFiles:[{name,hash}] }
//   output: {
//     ok, problems:[...],
//     toCopy:[{name,reason:'new'|'changed'}],
//     toRemove:[{name,reason:'stale'}],
//     unchanged:[name],
//     verify:[{name,distHash,rootHashAfter,expectMatch:true}]  // post-copy expectation
//   }
function computePublishPlan(input) {
  const distFiles = (input && input.distFiles) || [];
  const rootFiles = (input && input.rootFiles) || [];

  const distManaged = distFiles.filter((f) => isManagedArtifact(f.name));
  const rootManaged = rootFiles.filter((f) => isManagedArtifact(f.name));
  const distMap = byName(distManaged);
  const rootMap = byName(rootManaged);

  const problems = [];
  if (!distMap.has(BUNDLE_NAME)) {
    problems.push(`missing generated bundle "${BUNDLE_NAME}" in dist (did webpack run?)`);
  }
  for (const f of distManaged) {
    if (typeof f.hash !== 'string' || f.hash.length === 0) {
      problems.push(`dist artifact "${f.name}" has no hash`);
    }
  }

  const toCopy = [];
  const unchanged = [];
  for (const f of distManaged) {
    const rootHash = rootMap.get(f.name);
    if (rootHash === undefined) toCopy.push({ name: f.name, reason: 'new' });
    else if (rootHash !== f.hash) toCopy.push({ name: f.name, reason: 'changed' });
    else unchanged.push(f.name);
  }

  // Stale = a managed artifact at root that webpack no longer emits.
  const toRemove = [];
  for (const f of rootManaged) {
    if (!distMap.has(f.name)) toRemove.push({ name: f.name, reason: 'stale' });
  }

  // After the plan is applied, every dist-managed file's root hash must equal the
  // dist hash. The CLI re-hashes to CONFIRM this and fails otherwise.
  const verify = distManaged.map((f) => ({ name: f.name, distHash: f.hash, expectMatch: true }));

  return {
    ok: problems.length === 0,
    problems,
    toCopy,
    toRemove,
    unchanged,
    verify,
    bundle: BUNDLE_NAME,
  };
}

module.exports = { BUNDLE_NAME, isManagedArtifact, computePublishPlan };
