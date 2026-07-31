// Deterministic bundle-publish PLANNER (VIF Phase 4A1) — pure logic.
//
// Given the files in dist/ and at the repo root (each { name, hash }), compute
// exactly what a publish would copy, replace, remove (stale numeric chunks), and
// verify — WITHOUT touching the filesystem. The fs CLI (publish-bundle.js) is a
// thin, staged wrapper around this so the risky decisions are unit-testable.
//
// Managed artifact contract (the ONLY files this tool ever writes/removes):
//   - exactly `chat.bundle.js`           (webpack `filename`)
//   - numeric chunks `^[0-9]+\.chunk\.js$` (webpack `chunkFilename` = '[id].chunk.js')
// Anything else at the root — including vendor.chunk.js, custom.chunk.js,
// chunk.js, a.chunk.js.bak, chunky.js, index.html, CNAME, assets, docs — is
// NOT managed and is never touched.
//
// This module is the SINGLE authority for filename validity + managed-ness; the
// CLI reuses these exports. Pure CommonJS: no fs, no globals.

'use strict';

const BUNDLE_NAME = 'chat.bundle.js';
const MANAGED_CHUNK_RE = /^[0-9]+\.chunk\.js$/;

// Structural filename safety. Rejects anything that is not a plain, single-path
// basename. Applied to EVERY planner input (direct callers, not just readdir).
//   -> { ok:true } | { ok:false, reason }
function validateName(name) {
  if (typeof name !== 'string') return { ok: false, reason: 'not-a-string' };
  if (name.length === 0) return { ok: false, reason: 'empty' };
  if (name.indexOf('\0') !== -1) return { ok: false, reason: 'null-byte' };
  if (name === '.' || name === '..') return { ok: false, reason: 'dot-segment' };
  if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) return { ok: false, reason: 'path-separator' };
  return { ok: true };
}

// True iff `name` is a valid, managed artifact name (exact contract only).
function isManagedName(name) {
  if (!validateName(name).ok) return false;
  return name === BUNDLE_NAME || MANAGED_CHUNK_RE.test(name);
}

// True iff `name` is a numeric webpack chunk.
function isNumericChunk(name) {
  return validateName(name).ok && MANAGED_CHUNK_RE.test(name);
}

// Validate a file list: every name structurally valid, no duplicates. Returns
// an array of problem strings (empty if clean).
function validateList(label, files) {
  const problems = [];
  const seen = new Set();
  for (const f of files) {
    const name = f && f.name;
    const v = validateName(name);
    if (!v.ok) { problems.push(`${label}: invalid filename ${JSON.stringify(name)} (${v.reason})`); continue; }
    if (seen.has(name)) { problems.push(`${label}: duplicate filename "${name}"`); continue; }
    seen.add(name);
  }
  return problems;
}

// Compute the publish plan.
//   input: { distFiles:[{name,hash}], rootFiles:[{name,hash}] }
//   output: {
//     ok, problems:[...],
//     toCopy:[{name,reason:'new'|'changed'}],   // 'new'=copied, 'changed'=replaced
//     toRemove:[{name,reason:'stale'}],          // stale numeric chunks only
//     unchanged:[name],
//     finalSet:[name],                           // expected root managed set after publish
//     verify:[{name,distHash,expectMatch:true}]
//   }
function computePublishPlan(input) {
  const distFiles = (input && input.distFiles) || [];
  const rootFiles = (input && input.rootFiles) || [];

  const problems = [];
  problems.push(...validateList('dist', distFiles));
  problems.push(...validateList('root', rootFiles));
  if (problems.length) {
    return { ok: false, problems, toCopy: [], toRemove: [], unchanged: [], finalSet: [], verify: [] };
  }

  const distManaged = distFiles.filter((f) => isManagedName(f.name));
  const rootManaged = rootFiles.filter((f) => isManagedName(f.name));
  const distMap = new Map(distManaged.map((f) => [f.name, f.hash]));
  const rootMap = new Map(rootManaged.map((f) => [f.name, f.hash]));

  // Exactly one bundle required.
  const bundleCount = distManaged.filter((f) => f.name === BUNDLE_NAME).length;
  if (bundleCount !== 1) {
    problems.push(`dist must contain exactly one "${BUNDLE_NAME}" (found ${bundleCount})`);
  }
  for (const f of distManaged) {
    if (typeof f.hash !== 'string' || f.hash.length === 0) problems.push(`dist artifact "${f.name}" has no hash`);
  }

  const toCopy = [];
  const unchanged = [];
  for (const f of distManaged) {
    const rootHash = rootMap.get(f.name);
    if (rootHash === undefined) toCopy.push({ name: f.name, reason: 'new' });
    else if (rootHash !== f.hash) toCopy.push({ name: f.name, reason: 'changed' });
    else unchanged.push(f.name);
  }

  // Stale = a NUMERIC chunk present at root that dist no longer emits. (The
  // bundle is always re-emitted, so it is never "stale".)
  const toRemove = [];
  for (const f of rootManaged) {
    if (isNumericChunk(f.name) && !distMap.has(f.name)) toRemove.push({ name: f.name, reason: 'stale' });
  }

  const finalSet = distManaged.map((f) => f.name);
  const verify = distManaged.map((f) => ({ name: f.name, distHash: f.hash, expectMatch: true }));

  return {
    ok: problems.length === 0,
    problems,
    toCopy,
    toRemove,
    unchanged,
    finalSet,
    verify,
    bundle: BUNDLE_NAME,
  };
}

module.exports = {
  BUNDLE_NAME,
  MANAGED_CHUNK_RE,
  validateName,
  isManagedName,
  isNumericChunk,
  validateList,
  computePublishPlan,
};
