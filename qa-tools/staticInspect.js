// Static inspection of qa-tools/.
//
// Enforces the repository rule that direct Stream SDK access lives behind a single
// boundary, and that no destructive Stream operation exists anywhere in QA tooling.
//
// Run:  node qa-tools/staticInspect.js
// Exit: 0 = clean, 1 = violation found.
//
// NOTE ON THE APPROVED-MODULE LIST — this is deliberately TIGHTER than the brief.
// The brief permits direct Stream imports in three modules (guard, user bootstrap, channel
// bootstrap). This implementation centralises the SDK into ONE module, streamAdapter.js,
// and injects that adapter into the guard and both bootstraps. That is what allows every
// refusal path to be proven with a counting mock, and it shrinks the SDK blast radius from
// three files to one. The check below therefore allows the SDK import in streamAdapter.js
// only, and would FAIL if guard.js or either bootstrap reached for the SDK directly.

const fs = require('fs');
const path = require('path');

const QA_DIR = path.join(__dirname);

/** The single module permitted to import the Stream SDK. */
const APPROVED_SDK_MODULES = ['streamAdapter.js'];

/** Destructive Stream operations that must not appear anywhere in qa-tools/. */
const PROHIBITED_CALL_PATTERNS = [
  { name: 'truncate()', re: /\.truncate\s*\(/ },
  { name: 'deleteUsers()', re: /\.deleteUsers\s*\(/ },
  { name: 'deleteUser()', re: /\.deleteUser\s*\(/ },
  { name: 'channel delete()', re: /\.delete\s*\(\s*\{?\s*(hard_delete|\))/ },
  { name: 'hard_delete flag', re: /hard_delete\s*:/ },
  { name: 'removeMembers()', re: /\.removeMembers\s*\(/ },
];

const SDK_IMPORT_PATTERNS = [
  { name: "require('stream-chat')", re: /require\s*\(\s*['"]stream-chat['"]\s*\)/ },
  { name: "import from 'stream-chat'", re: /from\s+['"]stream-chat['"]/ },
];

/** Remove block and line comments so prose never triggers a false positive. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const files = walk(QA_DIR).sort();
  const violations = [];
  const inspected = [];

  for (const file of files) {
    const rel = path.relative(path.join(QA_DIR, '..'), file);
    const base = path.basename(file);
    if (base === 'staticInspect.js') {
      // This file names the patterns it searches for; scanning itself is meaningless.
      inspected.push({ rel, skipped: 'self' });
      continue;
    }

    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const findings = [];

    for (const p of SDK_IMPORT_PATTERNS) {
      if (p.re.test(code) && APPROVED_SDK_MODULES.indexOf(base) === -1) {
        findings.push(`direct Stream SDK import (${p.name}) outside the approved boundary`);
      }
    }
    for (const p of PROHIBITED_CALL_PATTERNS) {
      if (p.re.test(code)) {
        findings.push(`prohibited destructive operation: ${p.name}`);
      }
    }

    inspected.push({ rel, findings: findings.length });
    findings.forEach(f => violations.push({ rel, finding: f }));
  }

  console.log('\n=== qa-tools static inspection ===\n');
  console.log(`  approved Stream SDK boundary: ${APPROVED_SDK_MODULES.join(', ')}`);
  console.log(`  files inspected: ${inspected.length}\n`);
  inspected.forEach(i => {
    if (i.skipped) console.log(`    - ${i.rel}  (skipped: ${i.skipped})`);
    else console.log(`    - ${i.rel}  findings: ${i.findings}`);
  });

  if (violations.length) {
    console.log('\n  VIOLATIONS:');
    violations.forEach(v => console.log(`    ! ${v.rel}: ${v.finding}`));
    console.log('\n  RESULT: FAIL\n');
    process.exit(1);
  }

  console.log('\n  No direct Stream SDK access outside the approved boundary.');
  console.log('  No destructive Stream operation present anywhere in qa-tools/.');
  console.log('  RESULT: PASS\n');
  process.exit(0);
}

main();
