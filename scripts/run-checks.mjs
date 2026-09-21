#!/usr/bin/env node
// One entry point for every gate and every regression suite. Wired to
// `npm test`, the pre-push hook and CI.
// adr: adr/delivery-system.md
//
// Why this exists: each regression suite locks out a failure that already
// happened once, but a lock only holds if it is run. Nothing ran them, so every
// one of them depended on someone remembering.
//
// Suites are found by glob (scripts/test-*.ps1), not listed. A list is a second
// place to remember, and the suite nobody added to it is the same problem again.
//
// Every item runs even after one fails: a first failure that hides the rest
// turns one run into several.
//
// Not here on purpose:
//   check-build-inputs.mjs — refuses whenever build inputs are uncommitted,
//     which is the normal state of a tree being worked on. It belongs to
//     deploy/release preflight.
//   check-push-privacy.mjs — judges a pushed range handed to it on stdin, so it
//     only means something inside the pre-push hook.
//
// Run: node scripts/run-checks.mjs   (exit 0 = all passed, 1 = anything else)

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS, '..');

const GATES = [
  'check-skill-privacy.mjs',
  'check-fixture-provenance.mjs',
  'check-lockfile-sync.mjs',
];

const SUITE = /^test-.+\.ps1$/;
const NO_POWERSHELL_ACK = 'OPENWRITER_CHECKS_NO_POWERSHELL';

// The suites build their own fixtures and assert the gates' refusals. An
// acknowledgement or denylist path set for the real gates (CI sets one) would
// leak into those fixtures and turn an expected refusal into a pass.
function suiteEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^OPENWRITER_PRIVACY_/i.test(key)) delete env[key];
  }
  return env;
}

// Windows PowerShell first: the suites are written against 5.1, and it is
// always present on Windows. pwsh covers every other machine that has one.
function findPowerShell() {
  const candidates = process.platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh'];
  for (const exe of candidates) {
    const probe = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
}

function run(kind, name, cmd, args, env) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = !r.error && r.status === 0;
  const why = r.error ? `could not start: ${r.error.message}` : `exit ${r.status}`;
  console.log(`  [${ok ? 'pass' : 'FAIL'}] ${kind}  ${name}  (${seconds}s${ok ? '' : `, ${why}`})`);
  if (!ok) {
    // Only a failure earns its output; a passing run stays one line per item.
    const out = `${r.stdout || ''}${r.stderr || ''}`.trimEnd();
    if (out) console.log(out.split(/\r?\n/).map((l) => `        ${l}`).join('\n'));
  }
  return ok;
}

const started = Date.now();
let passed = 0;
const failed = [];
const skipped = [];

console.log('gates');
for (const gate of GATES) {
  if (run('gate ', gate, process.execPath, [join(SCRIPTS, gate)], process.env)) passed++;
  else failed.push(gate);
}

const suites = readdirSync(SCRIPTS).filter((f) => SUITE.test(f)).sort();

console.log('regression suites');
if (!suites.length) {
  // Discovery finding nothing means discovery is broken, not that all is well.
  console.log('  [FAIL] no scripts/test-*.ps1 suites were found');
  failed.push('suite discovery');
} else {
  const shell = findPowerShell();
  for (const suite of suites) {
    if (!shell) {
      console.log(`  [SKIPPED] suite ${suite}  (no PowerShell on this machine)`);
      skipped.push(suite);
      continue;
    }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(SCRIPTS, suite)];
    if (run('suite', suite, shell, args, suiteEnv())) passed++;
    else failed.push(suite);
  }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${passed} passed, ${failed.length} failed, ${skipped.length} skipped  (${total}s)`);

if (failed.length) {
  console.error(`FAILED: ${failed.join(', ')}`);
  process.exit(1);
}

if (skipped.length) {
  // A suite that did not run has proven nothing, so it cannot count as a pass.
  console.error(`NOT RUN: ${skipped.length} regression suite(s) need PowerShell (powershell or pwsh) and none was found.`);
  if (process.env[NO_POWERSHELL_ACK] === '1') {
    console.error(`  Acknowledged via ${NO_POWERSHELL_ACK}=1. The gates passed; the suites are UNVERIFIED here.`);
    process.exit(0);
  }
  console.error(`  Install PowerShell, or set ${NO_POWERSHELL_ACK}=1 to accept a run without them.`);
  process.exit(1);
}
