/**
 * Tests for enrichment surfacing helpers — enrichmentFooter() and
 * buildEnrichmentInstructions(). These are what MCP-native opt-in-by-default
 * surfacing rides on.
 *
 * See brief 2026-05-18-frontmatter-enrichment-system.
 *
 * Run: `node scripts/test-enrichment-surfacing.mjs`
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  enrichmentFooter,
  buildEnrichmentInstructions,
} from '../dist/server/documents.js';
import {
  setActiveProfile,
  ensureDataDir,
  getDataDir,
  getWorkspacesDir,
  ensureWorkspacesDir,
} from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-surface-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);

function cleanup() {
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function seedDoc(filename, frontmatter, body = 'Body content.') {
  const fm = JSON.stringify(frontmatter);
  writeFileSync(join(getDataDir(), filename), `---\n${fm}\n---\n\n${body}\n`, 'utf-8');
}

function seedWorkspace(filename, workspace) {
  writeFileSync(join(getWorkspacesDir(), filename),
    JSON.stringify(workspace, null, 2), 'utf-8');
}

try {
  setActiveProfile(TEST_PROFILE);
  mkdirSync(TEST_PROFILE_DIR, { recursive: true });
  ensureDataDir();
  ensureWorkspacesDir();

  // ---------------------------------------------------------------------
  // Scenario 1: empty data dir → no surfacing
  // ---------------------------------------------------------------------

  console.log('\nScenario 1: zero dirty docs → silent');
  {
    assert(enrichmentFooter() === '',
      'footer is empty string when no dirty docs');
    assert(buildEnrichmentInstructions() === '',
      'instructions empty string when no dirty docs');
  }

  // ---------------------------------------------------------------------
  // Scenario 2: dirty docs → footer + instructions both fire
  // ---------------------------------------------------------------------

  console.log('\nScenario 2: dirty docs produce surfacing strings');
  {
    seedDoc('d1.md', { title: 'd1', docId: 'd1000001' });
    seedDoc('d2.md', { title: 'd2', docId: 'd2000001' });
    seedDoc('d3.md', { title: 'd3', docId: 'd3000001' });

    const footer = enrichmentFooter();
    assert(footer.includes('3 docs need enrichment'),
      'footer reports correct count');
    assert(footer.includes('claim_enrichment'), 'footer directs the agent to claim work');
    assert(footer.includes('claimToken'), 'completion carries snapshot ownership');
    assert(footer.includes('Empty claims mean stop'), 'in-flight work cannot trigger dispatch loops');
    assert(!footer.includes('Agent('), 'notice is harness-neutral');

    const instructions = buildEnrichmentInstructions();
    assert(instructions.includes('ENRICHMENT_STATUS'),
      'instructions contain ENRICHMENT_STATUS header');
    assert(instructions.includes('3 docs need enrichment'),
      'instructions report correct count');
    assert(instructions.includes('claim_enrichment'), 'instructions name the claim protocol');
    assert(instructions.includes('canonical content'), 'instructions require snapshot content');
  }

  // ---------------------------------------------------------------------
  // Scenario 3: workspace attribution
  // ---------------------------------------------------------------------

  console.log('\nScenario 3: instructions group dirty docs by workspace');
  {
    seedWorkspace('ws-1.json', {
      version: 2,
      title: 'WS One',
      root: [
        { type: 'doc', file: 'd1.md', title: 'd1' },
        { type: 'doc', file: 'd2.md', title: 'd2' },
      ],
    });
    // d3.md stays orphan (not in any workspace)

    const instructions = buildEnrichmentInstructions();
    assert(instructions.includes('2 in ws-1.json'),
      'instructions group docs by workspace');
    assert(instructions.includes('1 unfiled'),
      'instructions count orphan docs');
  }

  // ---------------------------------------------------------------------
  // Scenario 4: opt-out workspace silences surfacing
  // ---------------------------------------------------------------------

  console.log('\nScenario 4: enrichmentDisabled workspace excludes its docs');
  {
    seedWorkspace('ws-2.json', {
      version: 2,
      title: 'WS Two',
      enrichmentDisabled: true,
      root: [
        { type: 'doc', file: 'd3.md', title: 'd3' },
      ],
    });
    // d3.md now in opted-out workspace; d1/d2 still in ws-1

    const footer = enrichmentFooter();
    assert(footer.includes('2 docs need enrichment'),
      'opted-out doc removed from count');

    const instructions = buildEnrichmentInstructions();
    assert(!instructions.includes('unfiled'),
      'no orphan section when opted-out doc covered the orphans');
  }

  // ---------------------------------------------------------------------
  // Scenario 5: all workspaces opted out → silent
  // ---------------------------------------------------------------------

  console.log('\nScenario 5: every workspace opted out → silent');
  {
    // Update ws-1 to opt out too
    seedWorkspace('ws-1.json', {
      version: 2,
      title: 'WS One',
      enrichmentDisabled: true,
      root: [
        { type: 'doc', file: 'd1.md', title: 'd1' },
        { type: 'doc', file: 'd2.md', title: 'd2' },
      ],
    });

    assert(enrichmentFooter() === '',
      'footer silent when all docs are opted out');
    assert(buildEnrichmentInstructions() === '',
      'instructions silent when all docs are opted out');
  }

  // ---------------------------------------------------------------------
  // Scenario 6: archived doc doesn't count
  // ---------------------------------------------------------------------

  console.log('\nScenario 6: archived docs are not counted as dirty');
  {
    seedDoc('archived.md', { title: 'arch', docId: 'archive1', archivedAt: '2026-01-01T00:00:00Z' });
    // archived.md added but should be excluded

    // Re-enable a workspace to surface non-archived dirty docs:
    seedWorkspace('ws-1.json', {
      version: 2,
      title: 'WS One',
      root: [
        { type: 'doc', file: 'd1.md', title: 'd1' },
        { type: 'doc', file: 'd2.md', title: 'd2' },
        { type: 'doc', file: 'archived.md', title: 'archived' },
      ],
    });

    const footer = enrichmentFooter();
    // d1 + d2 dirty, archived skipped, d3 still opted out
    assert(footer.includes('2 docs need enrichment'),
      'archived doc not counted');
  }
} catch (err) {
  failed++;
  console.error(`  FATAL: ${err.message}`);
  console.error(err.stack);
} finally {
  cleanup();
}

console.log('\n============================================================');
console.log(`Enrichment surfacing: ${passed} passed, ${failed} failed`);
console.log('============================================================');
if (failed > 0) process.exit(1);
