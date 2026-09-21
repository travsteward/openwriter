#!/usr/bin/env node
// Every test-corpus stage must declare where its prose came from.
// adr: adr/privacy-gate-timing.md
//
// The denylist gates catch content someone thought to list in advance. This
// check is the other half: it catches prose nobody anticipated, by refusing a
// fixture whose origin was never stated. Adding a stage forces the question
// "where did this text come from?" at the moment it is easiest to answer
// honestly and hardest to answer wrongly.
//
// Run: node scripts/check-fixture-provenance.mjs   (exit 0 = clean, 1 = missing)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CORPUS = join(ROOT, 'packages', 'openwriter', 'scripts', 'test-node-mapping', 'corpus');
const MANIFEST = join(CORPUS, 'SOURCES.md');

if (!existsSync(CORPUS)) {
  console.log('fixture provenance: no corpus directory — nothing to check');
  process.exit(0);
}

if (!existsSync(MANIFEST)) {
  console.error('fixture provenance: corpus/SOURCES.md is missing.');
  console.error('  Every stage must declare its source there.');
  process.exit(1);
}

const manifest = readFileSync(MANIFEST, 'utf8');

// A stage is any directory holding the fixture entrypoint.
const stages = readdirSync(CORPUS)
  .filter((n) => {
    const p = join(CORPUS, n);
    return statSync(p).isDirectory() && existsSync(join(p, 'original.md'));
  })
  .sort();

// A row declares a stage when it names it and supplies a non-empty source cell.
function declared(stage) {
  for (const line of manifest.split('\n')) {
    if (!line.includes(stage)) continue;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const [name, source] = cells;
    if (name === stage && source.length > 10) return true;
  }
  return false;
}

const undeclared = stages.filter((s) => !declared(s));

if (undeclared.length) {
  console.error(`fixture provenance: ${undeclared.length} stage(s) with no declared source:\n`);
  for (const s of undeclared) console.error(`  ${s}`);
  console.error('\nAdd a row for each in corpus/SOURCES.md saying where its prose');
  console.error('came from. Fixture prose is written for the fixture — never taken');
  console.error('from a real document, a live workspace, or your own drafts.');
  process.exit(1);
}

console.log(`fixture provenance: clean (${stages.length} stage(s) declared)`);
