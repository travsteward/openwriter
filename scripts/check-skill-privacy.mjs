#!/usr/bin/env node
// Privacy gate for the WHOLE public repo, at its CURRENT state. Blocks
// publish/release when personal content from the operator's local work sits in
// any tracked file — not just bundled skills, but test fixtures, corpora,
// changelog, code comments, etc.
// Run: node scripts/check-skill-privacy.mjs   (exit 0 = clean, 1 = hits)
//
// Convention (CLAUDE.md § Bundled-skill hygiene): worked examples are ALWAYS
// fictional (the sleep book, RecipeBox). The operator's live work — book prose,
// chapter/beat names, venture names, identity — never ships, even as a sample.
//
// This gate answers "is the tree clean right now?". It CANNOT protect a public
// repo on its own: by the time a release runs, every commit has been on GitHub
// for days, so a fix here can only ever be a scrub. The gate that actually
// prevents publication is scripts/check-push-privacy.mjs, wired to pre-push.
//
// Matching rules live in scripts/privacy-patterns.mjs — one definition, shared
// by both gates. Two copies of a denylist is how a rule goes stale unnoticed.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, sep } from 'node:path';
import {
  GENERIC_DENY, loadPersonalDeny, isScannable, matchLine, spanAllowGlobal,
} from './privacy-patterns.mjs';

const ROOT = process.cwd();

// Scan only TRACKED files — that is exactly the public/shippable surface.
// git ls-files excludes everything gitignored (.claude/, dist/, node_modules/,
// the local denylist, the operator's notes) for free.
function trackedFiles() {
  const out = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

// Refuses rather than returning when no rules can be read — see the loader.
const personal = loadPersonalDeny(ROOT);
const DENYLIST = [...GENERIC_DENY, ...personal.patterns];
const SPAN_G = spanAllowGlobal();
const hits = [];

for (const relPath of trackedFiles()) {
  if (!isScannable(relPath)) continue;
  let lines;
  try { lines = readFileSync(join(ROOT, relPath.split('/').join(sep)), 'utf8').split('\n'); }
  catch { continue; }
  lines.forEach((line, i) => {
    const re = matchLine(line, DENYLIST, SPAN_G);
    if (re) hits.push(`${relPath}:${i + 1}  [${re}]  ${line.trim().slice(0, 100)}`);
  });
}

if (hits.length) {
  console.error(`PRIVACY GATE FAILED — ${hits.length} hit(s):\n`);
  for (const h of hits) console.error('  ' + h);
  console.error('\nGenericize these before publishing (fictional examples only).');
  process.exit(1);
}
const rules = personal.source
  ? (personal.origin === 'main-checkout' ? 'generic + personal (denylist from the main checkout)' : 'generic + personal')
  : 'GENERIC ONLY — personal-term checking is off';
console.log(`privacy gate: clean (${rules})`);
