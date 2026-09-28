/**
 * Pending overlay integration test.
 *
 * Architectural model under test (replaces the pre-overlay-fix model):
 *   - Disk file is canonical only. No `pending:` frontmatter.
 *   - Pending state lives in `_pending/{docId}.json` sidecar.
 *   - In-memory state.document carries pending attrs (canonical merged with
 *     overlay) just like before — only the persistence boundary changed.
 *   - Pending entries are nodeId-keyed so they survive structural edits
 *     (matcher handles nodeId continuity across content changes).
 *
 * adr: adr/pending-overlay-model.md
 *
 * Run: `node scripts/test-pending-integration.mjs`
 */

import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync as fsWriteFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import matter from 'gray-matter';
import {
  setActiveDocument,
  save,
  cancelDebouncedSave,
  getDocument,
  updateDocument,
  getDocId,
} from '../dist/server/state.js';
import { markdownToTiptap } from '../dist/server/markdown.js';
import { markdownToNodes, resolvePreviousNodes, resolveGraveyard } from '../dist/server/markdown-parse.js';
import { tiptapToBlocks } from '../dist/server/node-blocks.js';
import { setActiveProfile, ensureDataDir, getDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-pending-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);

function cleanup() {
  cancelDebouncedSave();
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function readFrontmatter(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  // Project slim tuples to legacy {id, fp} shape for assertions WITHOUT
  // mutating gray-matter's cached data object.
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

function readSidecar(docId) {
  const path = join(TEST_PROFILE_DIR, '_pending', `${docId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function sidecarEntries(docId) {
  const sc = readSidecar(docId);
  return sc?.entries || [];
}

function setDocContent(content) {
  updateDocument({ type: 'doc', content });
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

const filePath = join(TEST_PROFILE_DIR, 'pending.md');

try {
  // ==========================================================================
  // SETUP: doc with pending state on a few blocks. pendingOriginalContent
  //         must be a full TipTap node (not just text — the overlay
  //         model takes the node as-is for revert and baseline checks).
  // ==========================================================================
  console.log('Setup: build doc with pending attrs on 2 blocks');
  {
    const originalBb = { type: 'paragraph', attrs: { id: 'bb000001' }, content: [{ type: 'text', text: 'The original paragraph text before the agent edit.' }] };
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'aa000001', level: 2 }, content: [{ type: 'text', text: 'Pending Test' }] },
        // Block with pending=rewrite (proper TipTap node for original)
        { type: 'paragraph', attrs: {
          id: 'bb000001',
          pendingStatus: 'rewrite',
          pendingOriginalContent: originalBb,
        }, content: [{ type: 'text', text: 'The agent-edited paragraph text awaiting review.' }] },
        // Plain block, no pending
        { type: 'paragraph', attrs: { id: 'cc000001' }, content: [{ type: 'text', text: 'A paragraph without pending state.' }] },
        // Block with pending=insert
        { type: 'paragraph', attrs: {
          id: 'dd000001',
          pendingStatus: 'insert',
        }, content: [{ type: 'text', text: 'A freshly inserted paragraph awaiting accept.' }] },
      ],
    };
    setActiveDocument(doc, 'Pending', filePath, false, undefined, { title: 'Pending', docId: 'doc00001' });
    save();
    cancelDebouncedSave();

    assert(existsSync(filePath), 'canonical .md file written');

    // The on-disk file is canonical only — no `pending:` frontmatter.
    const fm = readFrontmatter(filePath);
    assert(!('pending' in fm),
      `disk frontmatter has NO 'pending' field (got keys: ${Object.keys(fm).join(',')})`);

    // The sidecar has the overlay entries.
    const entries = sidecarEntries('doc00001');
    assert(entries.length === 2, `sidecar has 2 entries (got ${entries.length})`);

    const bbEntry = entries.find((e) => e.nodeId === 'bb000001');
    assert(bbEntry?.status === 'rewrite', `bb000001 entry is rewrite (got ${bbEntry?.status})`);
    assert(!!bbEntry?.originalBaseline, 'bb000001 entry has originalBaseline');
    assert(!!bbEntry?.newContent, 'bb000001 entry has newContent');

    const ddEntry = entries.find((e) => e.nodeId === 'dd000001');
    assert(ddEntry?.status === 'insert', `dd000001 entry is insert (got ${ddEntry?.status})`);
    assert(ddEntry?.afterNodeId === 'cc000001', `dd000001 anchor is cc000001 (got ${ddEntry?.afterNodeId})`);
  }

  // ==========================================================================
  // L-A: Edit a non-pending block — pending state on other blocks survives
  // ==========================================================================
  console.log('\nL-A: edit untouched block, pending state on other blocks survives');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    // After reload, sidecar overlay should have re-attached pending decorations.
    const bb = doc.content.find((b) => b.attrs?.id === 'bb000001');
    const dd = doc.content.find((b) => b.attrs?.id === 'dd000001');
    assert(bb?.attrs?.pendingStatus === 'rewrite', `bb000001 has pendingStatus=rewrite (got ${bb?.attrs?.pendingStatus})`);
    assert(dd?.attrs?.pendingStatus === 'insert', `dd000001 has pendingStatus=insert (got ${dd?.attrs?.pendingStatus})`);

    // Edit the un-pending block (cc000001)
    setDocContent(doc.content.map((b) => b.attrs?.id !== 'cc000001' ? b : {
      ...b, content: [{ type: 'text', text: 'Edited paragraph that has no pending state.' }],
    }));
    save();
    cancelDebouncedSave();

    const entries = sidecarEntries('doc00001');
    assert(entries.length === 2, `sidecar still has 2 entries after unrelated edit (got ${entries.length})`);
    assert(entries.find((e) => e.nodeId === 'bb000001')?.status === 'rewrite',
      'bb000001 sidecar still rewrite');
    assert(entries.find((e) => e.nodeId === 'dd000001')?.status === 'insert',
      'dd000001 sidecar still insert');
  }

  // ==========================================================================
  // L-B: Edit a pending block's text — pending state travels with it
  // ==========================================================================
  console.log('\nL-B: edit a pending block, pending attrs travel with the block');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent(doc.content.map((b) => b.attrs?.id !== 'bb000001' ? b : {
      ...b, content: [{ type: 'text', text: 'The agent-edited paragraph, now lightly revised by user.' }],
    }));
    save();
    cancelDebouncedSave();

    const entries = sidecarEntries('doc00001');
    const bbEntry = entries.find((e) => e.nodeId === 'bb000001');
    assert(bbEntry?.status === 'rewrite', `bb000001 pending status survived edit (got ${bbEntry?.status})`);
    assert(bbEntry?.originalBaseline?.content?.[0]?.text === 'The original paragraph text before the agent edit.',
      'pending originalBaseline intact across user edit');
    assert(bbEntry?.newContent?.content?.[0]?.text?.includes('lightly revised'),
      `pending newContent updated to new text (got ${bbEntry?.newContent?.content?.[0]?.text})`);
  }

  // ==========================================================================
  // L-C: Insert a new block — pending overlay survives unchanged (nodeId-keyed)
  // ==========================================================================
  console.log('\nL-C: insert a block, pending overlay attaches by nodeId (not position)');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent([
      doc.content[0],
      { type: 'paragraph', attrs: { id: 'ee000001' }, content: [{ type: 'text', text: 'A freshly inserted block at position 1.' }] },
      ...doc.content.slice(1),
    ]);
    save();
    cancelDebouncedSave();

    const entries = sidecarEntries('doc00001');
    assert(entries.find((e) => e.nodeId === 'bb000001')?.status === 'rewrite',
      'bb000001 still rewrite regardless of new layout');
    assert(entries.find((e) => e.nodeId === 'dd000001')?.status === 'insert',
      'dd000001 still insert regardless of new layout');
    // ee000001 was not pending so doesn't appear in sidecar
    assert(!entries.find((e) => e.nodeId === 'ee000001'),
      'ee000001 (non-pending) does not appear in sidecar');
  }

  // ==========================================================================
  // L-D: Delete a pending block — its entry disappears from sidecar
  // ==========================================================================
  console.log('\nL-D: delete a pending block, its sidecar entry is gone');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent(doc.content.filter((b) => b.attrs?.id !== 'dd000001'));
    save();
    cancelDebouncedSave();

    const entries = sidecarEntries('doc00001');
    assert(entries.length === 1, `sidecar count down to 1 (got ${entries.length})`);
    assert(!entries.find((e) => e.nodeId === 'dd000001'),
      'dd000001 entry removed from sidecar after block deleted');
    assert(entries[0]?.nodeId === 'bb000001', 'bb000001 entry remains');
  }

  // ==========================================================================
  // L-E: Type-change a pending block — pending attrs survive on the new type
  // ==========================================================================
  console.log('\nL-E: type-change a pending block, pending attrs survive');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent(doc.content.map((b) => b.attrs?.id !== 'bb000001' ? b : {
      type: 'heading',
      attrs: { ...b.attrs, level: 3 },
      content: b.content,
    }));
    save();
    cancelDebouncedSave();

    const entries = sidecarEntries('doc00001');
    const bbEntry = entries.find((e) => e.nodeId === 'bb000001');
    assert(bbEntry?.status === 'rewrite', `bb000001 pending entry still present after type-change`);
    assert(bbEntry?.newContent?.type === 'heading',
      `newContent reflects the new type 'heading' (got ${bbEntry?.newContent?.type})`);

    // The canonical body (on disk) reflects bb000001 as a heading with the ORIGINAL content
    // (because canonical = reverted, originalBaseline is the paragraph).
    // Wait — type-change preserves the new content's type; the original was a paragraph.
    // After revert, the canonical at bb000001's position is the original paragraph again.
    // So on disk, bb000001 should appear as a paragraph.
    const fm = readFrontmatter(filePath);
    const bbNodeFm = fm.nodes?.find((n) => n.id === 'bb000001');
    assert(bbNodeFm?.fp?.type === 'paragraph', `disk canonical has bb000001 as paragraph (got ${bbNodeFm?.fp?.type})`);
  }

  // ==========================================================================
  // SIDE-EFFECT: legacy migration — file with old `meta.pending` frontmatter
  //   loads, migrates to sidecar, and on next save the disk is clean.
  // ==========================================================================
  console.log('\nLegacy migration: old meta.pending → sidecar on first save');
  {
    const legacyFile = join(TEST_PROFILE_DIR, 'legacy.md');
    const legacyMd = `---
${JSON.stringify({
  title: 'Legacy',
  docId: 'leg00001',
  pending: {
    '1': {
      s: 'rewrite',
      o: { type: 'paragraph', attrs: { id: 'old00001' }, content: [{ type: 'text', text: 'Original text from legacy.' }] },
      t: 'New text from agent.',
    },
  },
  nodes: [
    { id: 'aa000001', fp: { type: 'heading', position: 0 } },
    { id: 'old00001', fp: { type: 'paragraph', position: 1 } },
  ],
})}
---

## Legacy

New text from agent.

`;
    fsWriteFileSync(legacyFile, legacyMd, 'utf-8');

    // Load via the active-doc pathway (mirrors how load() handles it)
    const parsed = markdownToTiptap(readFileSync(legacyFile, 'utf-8'));
    setActiveDocument(parsed.document, parsed.title, legacyFile, false, undefined, parsed.metadata);
    // A load alone does not bump docVersion, so save() would no-op at the gate.
    // Re-install the loaded doc through the edit path to reach the "next save".
    // adr: adr/pending-overlay-model.md (2026-06-01)
    updateDocument(getDocument());
    save();
    cancelDebouncedSave();

    // The sidecar should now exist with the migrated entry
    const entries = sidecarEntries('leg00001');
    assert(entries.length >= 1, `legacy migration produced sidecar entries (got ${entries.length})`);

    // The on-disk file should no longer have `meta.pending`
    const fmAfter = readFrontmatter(legacyFile);
    assert(!('pending' in fmAfter), `legacy meta.pending stripped from disk on first save`);
  }

} catch (err) {
  console.error('TEST CRASH:', err);
  process.exitCode = 1;
} finally {
  cleanup();
}

console.log('\n' + '='.repeat(60));
console.log(`Pending integration: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
