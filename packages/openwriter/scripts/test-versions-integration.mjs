/**
 * Versions + save-time matcher integration.
 *
 * Verifies that:
 * - A version snapshot is created after each writeToDisk save (when content
 *   actually changes — there's a content-hash + 30s dedup).
 * - The snapshot's frontmatter captures the matcher's nodes graph.
 * - Restoring an old snapshot produces a parsed doc with the snapshot's IDs.
 * - After a restore + save, disk identity reflects the restored state (not
 *   the pre-restore state).
 *
 * Run: `node scripts/test-versions-integration.mjs`
 */

import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import matter from 'gray-matter';
import {
  setActiveDocument,
  save,
  cancelDebouncedSave,
  getDocument,
  updateDocument,
} from '../dist/server/state.js';
import {
  forceSnapshot,
  listVersions,
  restoreVersion,
} from '../dist/server/versions.js';
import { markdownToTiptap } from '../dist/server/markdown.js';
import { markdownToNodes, resolvePreviousNodes, resolveGraveyard } from '../dist/server/markdown-parse.js';
import { tiptapToBlocks } from '../dist/server/node-blocks.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-versions-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);

function cleanup() {
  cancelDebouncedSave();
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function readFrontmatter(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  // Project slim tuples to legacy {id, fp} shape for assertions WITHOUT
  // mutating gray-matter's cached data object (its cache is shared by raw
  // string within a process; mutation leaks across calls).
  const blocks = tiptapToBlocks({ type: 'doc', content: markdownToNodes(content) });
  return {
    ...data,
    nodes: Array.isArray(data.nodes)
      ? resolvePreviousNodes(data.nodes, blocks).map((r) => ({ id: r.id, fp: r.fingerprint }))
      : data.nodes,
    graveyard: Array.isArray(data.graveyard)
      ? resolveGraveyard(data.graveyard).map((r) => ({ id: r.id, fp: r.fingerprint }))
      : data.graveyard,
  };
}

function setDocContent(content) {
  updateDocument({ type: 'doc', content });
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

const docId = 'c0ffee01';
const filePath = join(TEST_PROFILE_DIR, 'versions.md');
const versionsDir = join(TEST_PROFILE_DIR, '.versions', docId);

try {
  // ==========================================================================
  // M-A: First save creates a version snapshot
  // ==========================================================================
  console.log('M-A: first save creates a version snapshot');
  {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'aa000001', level: 2 }, content: [{ type: 'text', text: 'Versions Test' }] },
        { type: 'paragraph', attrs: { id: 'bb000001' }, content: [{ type: 'text', text: 'Original paragraph one in versions test.' }] },
        { type: 'paragraph', attrs: { id: 'cc000001' }, content: [{ type: 'text', text: 'Original paragraph two.' }] },
      ],
    };
    setActiveDocument(doc, 'Versions', filePath, false, undefined, { title: 'Versions', docId });
    save();
    // Force a snapshot since the 30s throttle would skip the auto one
    forceSnapshot(docId, filePath);
    assert(existsSync(versionsDir), '.versions/{docId} dir exists');
    const versions = listVersions(docId);
    assert(versions.length >= 1, `at least 1 version (got ${versions.length})`);
  }

  // ==========================================================================
  // M-B: Snapshot content includes matcher nodes graph
  // ==========================================================================
  console.log('\nM-B: snapshot content has frontmatter nodes graph');
  let firstSnapshotTs = 0;
  {
    const versions = listVersions(docId);
    firstSnapshotTs = versions[0].timestamp;
    const restored = restoreVersion(docId, firstSnapshotTs);
    assert(!!restored, 'restoreVersion returned parsed doc');
    assert(restored.document.content.some((b) => b.attrs?.id === 'aa000001'),
      'restored doc has aa000001 heading');
    assert(restored.document.content.some((b) => b.attrs?.id === 'bb000001'),
      'restored doc has bb000001 paragraph');
    assert(restored.document.content.some((b) => b.attrs?.id === 'cc000001'),
      'restored doc has cc000001 paragraph');
  }

  // Wait briefly to ensure snapshot timestamps differ
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(10);

  // ==========================================================================
  // M-C: After matcher-driven changes, a forced snapshot captures the new state
  // ==========================================================================
  console.log('\nM-C: changes + forceSnapshot captures the new state distinctly');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    // Clean delete of cc000001 (no replacement at slot — avoid slot-continuity
    // which would pin cc to the new content). Then add dd000001 at a new tail
    // position to ensure the version has a clearly-different layout.
    setDocContent([
      doc.content[0], // heading
      { ...doc.content[1], content: [{ type: 'text', text: 'Edited paragraph one with new prose.' }] },
      // cc000001 dropped, NO replacement at its slot
    ]);
    save();

    // Second batch: now insert dd at the end so we have a clearly different layout
    const after1 = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(after1.document, after1.title, filePath, false, undefined, after1.metadata);
    setDocContent([
      ...getDocument().content,
      { type: 'paragraph', attrs: { id: 'dd000001' }, content: [{ type: 'text', text: 'A freshly inserted paragraph at the end.' }] },
    ]);
    save();
    forceSnapshot(docId, filePath);

    const versions = listVersions(docId);
    assert(versions.length >= 2, `now have at least 2 versions (got ${versions.length})`);

    // After clean delete: cc000001 should be in graveyard
    const fm = readFrontmatter(filePath);
    assert(fm.nodes?.some((n) => n.id === 'aa000001'), 'aa000001 still alive');
    assert(fm.nodes?.some((n) => n.id === 'bb000001'), 'bb000001 still alive');
    assert(!fm.nodes?.some((n) => n.id === 'cc000001'), 'cc000001 no longer in active nodes');
    assert(fm.graveyard?.some((g) => g.id === 'cc000001'), 'cc000001 in graveyard');
  }

  // ==========================================================================
  // M-D: Restore the FIRST snapshot — restored doc has ORIGINAL IDs
  // ==========================================================================
  console.log('\nM-D: restoring the first snapshot brings back original content + IDs');
  {
    const restored = restoreVersion(docId, firstSnapshotTs);
    assert(!!restored, 'first snapshot restorable');
    // Original had: aa000001 heading, bb000001 (original text), cc000001
    const ids = restored.document.content.map((b) => b.attrs?.id);
    assert(ids.includes('aa000001'), `restored has aa000001 (got ${JSON.stringify(ids)})`);
    assert(ids.includes('bb000001'), `restored has bb000001`);
    assert(ids.includes('cc000001'), `restored has cc000001 (was deleted from current state)`);
    // Verify content is the ORIGINAL text, not the edited
    const bb = restored.document.content.find((b) => b.attrs?.id === 'bb000001');
    const bbText = bb?.content?.[0]?.text ?? '';
    assert(bbText.includes('Original paragraph one'),
      `restored bb has ORIGINAL text (got "${bbText}")`);
  }

  // ==========================================================================
  // M-E: Apply the restored doc — disk reverts to the restored state, IDs preserved
  // ==========================================================================
  console.log('\nM-E: applying restored snapshot reverts CONTENT, but matcher rules apply to identity');
  // Important nuance: Option B's save-time matcher uses the CURRENT disk's
  // previousNodes when serializing. When you restore an old snapshot and save,
  // the matcher compares the restored content's fingerprints against the
  // current disk (which has the post-snapshot state, not the snapshot's state).
  //
  // Result: most IDs come back via fingerprint match, but in some cases the
  // matcher's slot-continuity / insert rules will mint fresh IDs instead of
  // graveyard-restoring or fingerprint-matching back to the snapshot's IDs.
  // This is correct per the matcher's design: identity is always derived from
  // the canonical disk state, not from a snapshot's frozen state.
  {
    const restored = restoreVersion(docId, firstSnapshotTs);
    setActiveDocument(restored.document, restored.title, filePath, false, undefined, restored.metadata);
    // A load alone does not bump docVersion, so save() would no-op at the gate.
    // adr: adr/pending-overlay-model.md (2026-06-01)
    updateDocument(getDocument());
    save();
    const fm = readFrontmatter(filePath);
    // Content correctly restored — verify by reading the actual body text
    // rather than fingerprint internals (firstWords/lastWords were removed
    // in the v0.15 compact fingerprint format).
    const fileBody = readFileSync(filePath, 'utf-8');
    assert(fileBody.includes('Versions Test'),
      'restored doc body has "Versions Test" heading');
    assert(fileBody.includes('Original paragraph one'),
      'restored body has "Original paragraph one..." text');
    assert(fileBody.includes('Original paragraph two'),
      'restored body has "Original paragraph two..." text');
    // Forward-looking identity: dd is gone (it didn't exist in the snapshot)
    assert(!fm.nodes?.some((n) => n.id === 'dd000001'),
      'dd000001 (inserted after snapshot) no longer in active nodes after restore');
    // Many original IDs return via fingerprint match
    assert(fm.nodes?.some((n) => n.id === 'aa000001'), 'aa000001 (unchanged heading) preserved through restore');
    assert(fm.nodes?.some((n) => n.id === 'bb000001'), 'bb000001 preserved (matcher pinned it via slot-continuity)');
  }

} finally {
  cleanup();
}

console.log('\n' + '='.repeat(60));
console.log(`Versions integration: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
