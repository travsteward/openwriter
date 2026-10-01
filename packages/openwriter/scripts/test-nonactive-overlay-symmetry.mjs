/**
 * Non-active doc write paths must keep the overlay sidecar in sync.
 *
 * The pending-overlay foundation moved pending state from frontmatter into
 * `_pending/{docId}.json` sidecars. The active-doc save pathway was updated
 * to extract+persist the overlay alongside the canonical write. The non-
 * active-doc write paths (populate_document / write_to_pad / edit_text on a
 * doc that is not the singleton active) silently lost their pending content
 * because they only wrote canonical and never touched the sidecar.
 *
 * This test pins down the symmetric contract: every write path that emits
 * a canonical markdown file must also persist its overlay (or delete it,
 * for the strip path). adr: adr/pending-overlay-model.md
 *
 * Run: `node scripts/test-nonactive-overlay-symmetry.mjs`
 */

import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync as fsWriteFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import matter from 'gray-matter';
import {
  setActiveDocument,
  saveDocToFile,
  populateDocumentFile,
  applyChangesToFile,
  applyTextEditsToFile,
  stripPendingAttrsFromFile,
} from '../dist/server/state.js';
import { markdownToTiptap } from '../dist/server/markdown.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-nonactive-overlay-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);

function cleanup() {
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function sidecarPath(docId) {
  return join(TEST_PROFILE_DIR, '_pending', `${docId}.json`);
}

function readSidecar(docId) {
  const p = sidecarPath(docId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function sidecarEntries(docId) {
  return readSidecar(docId)?.entries || [];
}

function readFrontmatter(filePath) {
  return matter(readFileSync(filePath, 'utf-8')).data;
}

function findPendingAttr(nodes) {
  if (!nodes) return null;
  for (const node of nodes) {
    if (node.attrs?.pendingStatus) return node.attrs.pendingStatus;
    if (node.content) {
      const found = findPendingAttr(node.content);
      if (found) return found;
    }
  }
  return null;
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

// Set up an unrelated active doc so the singleton is occupied with something
// that is NOT our test target. Every test below operates on a different file.
const activeFilePath = join(TEST_PROFILE_DIR, 'active.md');
fsWriteFileSync(activeFilePath, `---\ntitle: Active\ndocId: active001\n---\n\nActive doc placeholder.\n`, 'utf-8');
{
  const parsed = markdownToTiptap(readFileSync(activeFilePath, 'utf-8'));
  setActiveDocument(parsed.document, parsed.title, activeFilePath, false, undefined, parsed.metadata);
}

try {
  // ==========================================================================
  // T1: populateDocumentFile on a non-active doc creates BOTH the canonical
  //     .md file (with no pending attrs in the body) AND the sidecar JSON
  //     with insert entries for each populated block.
  // ==========================================================================
  console.log('T1: populateDocumentFile writes canonical .md + sidecar with insert entries');
  {
    const target = join(TEST_PROFILE_DIR, 'pop-target.md');
    fsWriteFileSync(target, `---\ntitle: Pop Target\ndocId: pop00001\n---\n\n`, 'utf-8');

    const populated = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1000001', level: 2 }, content: [{ type: 'text', text: 'Populated Heading' }] },
        { type: 'paragraph', attrs: { id: 'p1000001' }, content: [{ type: 'text', text: 'First populated paragraph.' }] },
        { type: 'paragraph', attrs: { id: 'p2000001' }, content: [{ type: 'text', text: 'Second populated paragraph.' }] },
      ],
    };

    const result = populateDocumentFile(target, populated);
    assert(result.pendingCount === 3, `populate result reports 3 pending (got ${result.pendingCount})`);

    // Disk: canonical only — frontmatter has nodes/graveyard but body has no pendingStatus.
    const raw = readFileSync(target, 'utf-8');
    assert(!raw.includes('pendingStatus'), 'disk body has no pendingStatus attr (canonical)');
    const fm = readFrontmatter(target);
    assert(!('pending' in fm), 'disk frontmatter has no `pending` field');

    // Sidecar: insert entries for every populated node.
    const entries = sidecarEntries('pop00001');
    assert(entries.length === 3, `sidecar has 3 entries (got ${entries.length})`);
    assert(entries.every((e) => e.status === 'insert'), 'all sidecar entries are status=insert');
    const ids = new Set(entries.map((e) => e.nodeId));
    assert(ids.has('h1000001') && ids.has('p1000001') && ids.has('p2000001'),
      `sidecar covers all populated node IDs (got ${[...ids].join(',')})`);
  }

  // ==========================================================================
  // T2: applyChangesToFile (rewrite) on a non-active doc preserves the
  //     original baseline in the sidecar entry. The reporter's regression
  //     was that the rewrite landed on disk but the originalBaseline was
  //     lost because the sidecar was never written.
  // ==========================================================================
  console.log('\nT2: applyChangesToFile rewrite produces canonical disk + sidecar with originalBaseline');
  {
    const target = join(TEST_PROFILE_DIR, 'rewrite-target.md');
    // Seed file with an existing block we can rewrite.
    fsWriteFileSync(target,
      `---\ntitle: Rewrite Target\ndocId: rw000001\nnodes:\n  - id: aa000001\n    fp:\n      type: paragraph\n      position: 0\n      bytes: 24\n---\n\nOriginal block content here.\n`,
      'utf-8',
    );

    const newNode = {
      type: 'paragraph',
      attrs: { id: 'aa000001' },
      content: [{ type: 'text', text: 'Rewritten block content from agent.' }],
    };
    const result = applyChangesToFile(target, [{ operation: 'rewrite', nodeId: 'aa000001', content: newNode }]);
    assert(result.count === 1, `applyChangesToFile reports 1 change applied (got ${result.count})`);

    // Disk: canonical, no pending attrs visible.
    const raw = readFileSync(target, 'utf-8');
    assert(!raw.includes('pendingStatus'), 'rewrite disk body has no pendingStatus attr');

    // Sidecar: one rewrite entry with originalBaseline pointing at the OLD content.
    const entries = sidecarEntries('rw000001');
    assert(entries.length === 1, `sidecar has 1 entry (got ${entries.length})`);
    const entry = entries[0];
    assert(entry.status === 'rewrite', `entry status is rewrite (got ${entry.status})`);
    assert(entry.nodeId === 'aa000001', `entry nodeId is aa000001 (got ${entry.nodeId})`);
    const baselineText = entry.originalBaseline?.content?.[0]?.text || '';
    assert(baselineText.includes('Original block content'),
      `originalBaseline preserved the pre-rewrite text (got "${baselineText}")`);
    const newText = entry.newContent?.content?.[0]?.text || '';
    assert(newText.includes('Rewritten block content'),
      `newContent reflects the agent rewrite (got "${newText}")`);
  }

  // ==========================================================================
  // T3: stripPendingAttrsFromFile deletes the sidecar so the next load
  //     doesn't re-apply stale pending entries. The strip is the
  //     "accept all" / "clean slate" path; both disk and sidecar must
  //     be cleared in the same pass.
  // ==========================================================================
  console.log('\nT3: stripPendingAttrsFromFile deletes the sidecar JSON');
  {
    const target = join(TEST_PROFILE_DIR, 'strip-target.md');
    fsWriteFileSync(target,
      `---\ntitle: Strip Target\ndocId: st000001\nnodes:\n  - id: bb000001\n    fp:\n      type: paragraph\n      position: 0\n      bytes: 10\n---\n\nBlock to strip.\n`,
      'utf-8',
    );

    // Seed a sidecar so the strip has something to delete.
    mkdirSync(join(TEST_PROFILE_DIR, '_pending'), { recursive: true });
    fsWriteFileSync(sidecarPath('st000001'), JSON.stringify({
      docId: 'st000001',
      entries: [{
        nodeId: 'bb000001',
        status: 'rewrite',
        originalBaseline: { type: 'paragraph', attrs: { id: 'bb000001' }, content: [{ type: 'text', text: 'Old.' }] },
        newContent: { type: 'paragraph', attrs: { id: 'bb000001' }, content: [{ type: 'text', text: 'New.' }] },
      }],
    }), 'utf-8');
    assert(existsSync(sidecarPath('st000001')), 'sidecar exists before strip');

    stripPendingAttrsFromFile(target);

    assert(!existsSync(sidecarPath('st000001')),
      'sidecar JSON removed after stripPendingAttrsFromFile');

    // Disk should be canonical (no pending attrs).
    const raw = readFileSync(target, 'utf-8');
    assert(!raw.includes('pendingStatus'), 'disk body has no pendingStatus after strip');
  }

  // ==========================================================================
  // T4: saveDocToFile round-trip: pending attrs carried on the in-memory
  //     doc end up in the sidecar JSON, never in the body. The browser
  //     doc-update path for a non-active file must keep the overlay in
  //     sync with the canonical write.
  // ==========================================================================
  console.log('\nT4: saveDocToFile preserves browser-carried pending into sidecar');
  {
    const target = join(TEST_PROFILE_DIR, 'save-target.md');
    // File on disk already has a pending block (sidecar form).
    fsWriteFileSync(target,
      `---\ntitle: Save Target\ndocId: sv000001\nnodes:\n  - id: cc000001\n    fp:\n      type: paragraph\n      position: 0\n      bytes: 10\n---\n\nBaseline content.\n`,
      'utf-8',
    );
    mkdirSync(join(TEST_PROFILE_DIR, '_pending'), { recursive: true });
    const originalBaseline = { type: 'paragraph', attrs: { id: 'cc000001' }, content: [{ type: 'text', text: 'Baseline content.' }] };
    fsWriteFileSync(sidecarPath('sv000001'), JSON.stringify({
      docId: 'sv000001',
      entries: [{
        nodeId: 'cc000001',
        status: 'rewrite',
        originalBaseline,
        newContent: { type: 'paragraph', attrs: { id: 'cc000001' }, content: [{ type: 'text', text: 'Agent rewrite v1.' }] },
      }],
    }), 'utf-8');

    // Simulate a browser doc-update: the browser merged disk + overlay and
    // is sending back the doc with pending attrs on cc000001. The browser
    // edited the pending text slightly (user revised the agent rewrite).
    const browserDoc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: {
          id: 'cc000001',
          pendingStatus: 'rewrite',
          pendingOriginalContent: originalBaseline,
        },
        content: [{ type: 'text', text: 'Agent rewrite v1 lightly revised.' }],
      }],
    };

    saveDocToFile(target, browserDoc);

    // Disk: canonical (no pending attrs in body).
    const rawAfter = readFileSync(target, 'utf-8');
    assert(!rawAfter.includes('pendingStatus'), 'saveDocToFile disk body has no pendingStatus');
    const reparsed = markdownToTiptap(rawAfter);
    assert(findPendingAttr(reparsed.document.content) === null,
      'parsed disk doc has no pending attrs after saveDocToFile');

    // Sidecar: the revised pending state lives on.
    const entries = sidecarEntries('sv000001');
    assert(entries.length === 1, `sidecar still has 1 entry after saveDocToFile (got ${entries.length})`);
    const entry = entries[0];
    assert(entry.status === 'rewrite', `entry remains rewrite (got ${entry.status})`);
    assert(entry.newContent?.content?.[0]?.text?.includes('lightly revised'),
      `sidecar newContent reflects the browser revision (got "${entry.newContent?.content?.[0]?.text}")`);
    assert(entry.originalBaseline?.content?.[0]?.text === 'Baseline content.',
      `sidecar originalBaseline still points at pre-pending content (got "${entry.originalBaseline?.content?.[0]?.text}")`);
  }

  // ==========================================================================
  // T5: applyTextEditsToFile routes through flushDocToFile too — covered
  //     transitively. Sanity check the disk + sidecar still agree.
  // ==========================================================================
  console.log('\nT5: applyTextEditsToFile keeps overlay in sync');
  {
    const target = join(TEST_PROFILE_DIR, 'tedit-target.md');
    fsWriteFileSync(target,
      `---\ntitle: TEdit Target\ndocId: te000001\nnodes:\n  - id: dd000001\n    fp:\n      type: paragraph\n      position: 0\n      bytes: 24\n---\n\nThe original text here.\n`,
      'utf-8',
    );

    const result = applyTextEditsToFile(target, 'dd000001', [{ find: 'original', replace: 'edited' }]);
    assert(result.success, `applyTextEditsToFile succeeded (error: ${result.error ?? 'none'})`);

    const raw = readFileSync(target, 'utf-8');
    assert(!raw.includes('pendingStatus'), 'tedit disk body has no pendingStatus');

    const entries = sidecarEntries('te000001');
    assert(entries.length === 1, `sidecar has 1 entry after applyTextEditsToFile (got ${entries.length})`);
    assert(entries[0].nodeId === 'dd000001', `entry nodeId matches (got ${entries[0].nodeId})`);
  }

  console.log('\nT6: edit_text on one sentence marks only that sentence');
  {
    const target = join(TEST_PROFILE_DIR, 'tedit-range.md');
    const text = 'The dog ran fast. It was very very hungry. Then it ate.';
    fsWriteFileSync(target,
      `---\ntitle: TEdit Range\ndocId: te000002\nnodes:\n  - id: dd000002\n    fp:\n      type: paragraph\n      position: 0\n      bytes: ${text.length}\n---\n\n${text}\n`,
      'utf-8',
    );
    applyTextEditsToFile(target, 'dd000002', [{ find: 'very very hungry', replace: 'starving' }]);
    const e = sidecarEntries('te000002')[0] || {};
    const proposed = 'The dog ran fast. It was starving. Then it ate.';
    const marked = proposed.slice(e.pendingSelectionFrom, e.pendingSelectionTo);
    const original = text.slice(e.pendingOriginalFrom, e.pendingOriginalTo);
    assert(marked === 'It was starving.', `proposal marks the changed sentence only (got ${JSON.stringify(marked)})`);
    assert(original === 'It was very very hungry.', `original marks the changed sentence only (got ${JSON.stringify(original)})`);
  }

} catch (err) {
  console.error('TEST CRASH:', err);
  process.exitCode = 1;
} finally {
  cleanup();
}

console.log('\n' + '='.repeat(60));
console.log(`Non-active overlay symmetry: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
