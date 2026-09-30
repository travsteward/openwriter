/**
 * Bulk accept/reject (sidebar "Accept all" / "Reject all" on a folder) must
 * resolve pending changes that live in the overlay sidecar.
 *
 * batchResolve used to look for pending state in the .md frontmatter, which
 * the overlay model no longer writes, so it always found nothing and returned
 * zero. It also saved the live doc without bumping its version, so that save
 * was a no-op. adr: adr/pending-overlay-model.md
 *
 * Run: `node scripts/test-batch-resolve.mjs`
 */

import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  setActiveDocument,
  populateDocumentFile,
  applyChangesToFile,
  applyChanges,
  getDocument,
  getPendingChangeCount,
} from '../dist/server/state.js';
import { batchResolve } from '../dist/server/documents.js';
import { markdownToTiptap } from '../dist/server/markdown.js';
import { addComment, getComments } from '../dist/server/comments.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-batch-resolve-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);

function cleanup() {
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

const sidecarPath = (docId) => join(TEST_PROFILE_DIR, '_pending', `${docId}.json`);
const body = (file) => readFileSync(join(TEST_PROFILE_DIR, file), 'utf-8');

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

const activeFile = 'active.md';
const activePath = join(TEST_PROFILE_DIR, activeFile);
writeFileSync(activePath, `---\ntitle: Active\ndocId: act00001\n---\n\nActive first paragraph.\n`, 'utf-8');
{
  const parsed = markdownToTiptap(readFileSync(activePath, 'utf-8'));
  setActiveDocument(parsed.document, parsed.title, activePath, false, undefined, parsed.metadata);
}

try {
  console.log('T1: reject all on a non-active doc drops pending inserts and its sidecar');
  {
    const file = 'rej-target.md';
    writeFileSync(join(TEST_PROFILE_DIR, file), `---\ntitle: Rej Target\ndocId: rej00001\n---\n\n`, 'utf-8');
    populateDocumentFile(join(TEST_PROFILE_DIR, file), {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'rp000001' }, content: [{ type: 'text', text: 'Proposed paragraph to reject.' }] }],
    });
    assert(existsSync(sidecarPath('rej00001')), 'sidecar exists before reject');

    const result = batchResolve([file], 'reject');
    assert(result.docsResolved === 1 && result.changesResolved === 1, `resolved 1 doc / 1 change (got ${result.docsResolved}/${result.changesResolved})`);
    assert(!result.activeResolved, 'active doc not reported as touched');
    assert(!existsSync(sidecarPath('rej00001')), 'sidecar removed after reject');
    assert(!body(file).includes('Proposed paragraph to reject'), 'rejected text is not on disk');
  }

  console.log('\nT2: accept all on a non-active doc lands the rewrite on disk');
  {
    const file = 'acc-target.md';
    // A `nodes` entry pins the paragraph's ID so the rewrite can target it.
    const nodeId = 'ac000001';
    writeFileSync(join(TEST_PROFILE_DIR, file),
      `---\ntitle: Acc Target\ndocId: acc00001\nnodes:\n  - id: ${nodeId}\n    fp:\n      type: paragraph\n      position: 0\n      bytes: 23\n---\n\nOriginal sentence here.\n`,
      'utf-8');
    applyChangesToFile(join(TEST_PROFILE_DIR, file), [{
      operation: 'rewrite', nodeId,
      content: { type: 'paragraph', attrs: { id: nodeId }, content: [{ type: 'text', text: 'Accepted rewrite sentence.' }] },
    }]);
    assert(existsSync(sidecarPath('acc00001')), 'sidecar exists before accept');
    const covered = addComment(file, 'Original sentence', 'tighten this', nodeId);

    const result = batchResolve([file], 'accept');
    const after = getComments(file, { includeResolved: true })[file] ?? [];
    assert(after.find((c) => c.id === covered.id)?.resolvedAt, 'the comment on the accepted words is resolved, not deleted');
    assert(result.changesResolved === 1, `resolved 1 change (got ${result.changesResolved})`);
    assert(!existsSync(sidecarPath('acc00001')), 'sidecar removed after accept');
    assert(body(file).includes('Accepted rewrite sentence.'), 'accepted text is on disk');
    assert(!body(file).includes('Original sentence here.'), 'original text replaced');
  }

  console.log('\nT3: reject all on the live doc resolves in memory and persists');
  {
    const firstId = getDocument().content[0].attrs.id;
    applyChanges([{
      operation: 'insert', afterNodeId: firstId,
      content: { type: 'paragraph', content: [{ type: 'text', text: 'Live pending insert.' }] },
    }]);
    assert(getPendingChangeCount() === 1, `live doc has 1 pending before (got ${getPendingChangeCount()})`);

    const result = batchResolve([activeFile], 'reject');
    assert(result.activeResolved, 'active doc reported as touched');
    assert(getPendingChangeCount() === 0, `live doc has no pending after (got ${getPendingChangeCount()})`);
    assert(!JSON.stringify(getDocument()).includes('Live pending insert.'), 'insert removed from live doc');
    assert(!body(activeFile).includes('Live pending insert.'), 'insert not on disk');
    assert(!existsSync(sidecarPath('act00001')), 'live doc sidecar removed');
  }
} catch (err) {
  console.error('TEST CRASH:', err);
  process.exitCode = 1;
} finally {
  cleanup();
}

console.log('\n' + '='.repeat(60));
console.log(`Batch resolve: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 || process.exitCode ? 1 : 0);
