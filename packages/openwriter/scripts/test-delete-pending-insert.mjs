/**
 * Deleting a pending proposal withdraws it before anything is marked.
 *
 * Regression: write_to_pad delete on a node that was itself a pending insert
 * marked it pendingStatus='delete'. A delete keeps its node in canonical, so
 * the agent's unapproved paragraph was written into the .md body and showed
 * up again as a ghost once the pending delete was gone from the sidecar.
 * The same path wrote a pending rewrite's unapproved text to disk.
 *
 * Covers the active doc (applyChanges) and a non-active doc
 * (applyChangesToFile), which share applyChangesToDoc.
 *
 * adr: adr/pending-overlay-model.md
 *
 * Run: `node scripts/test-delete-pending-insert.mjs`
 */

import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  setActiveDocument,
  save,
  cancelDebouncedSave,
  getDocument,
  applyChanges,
  applyChangesToFile,
} from '../dist/server/state.js';
import { loadDocFromDisk } from '../dist/server/pending-overlay.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-delete-pending-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);

function cleanup() {
  cancelDebouncedSave();
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

function sidecarEntries(docId) {
  const path = join(TEST_PROFILE_DIR, '_pending', `${docId}.json`);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf-8')).entries || [];
}

function para(id, text) {
  return { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] };
}

function flush() { save(); cancelDebouncedSave(); }

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

try {
  console.log('Active doc: delete a pending insert');
  const activePath = join(TEST_PROFILE_DIR, 'active.md');
  {
    setActiveDocument({ type: 'doc', content: [para('aa000001', 'First.'), para('bb000001', 'Second.')] },
      'Active', activePath, false, undefined, { title: 'Active', docId: 'docact01' });
    flush();
    applyChanges([{ operation: 'insert', afterNodeId: 'aa000001', content: para('ins00001', 'Proposed ghost.') }]);
    flush();
    assert(sidecarEntries('docact01').some((e) => e.nodeId === 'ins00001' && e.status === 'insert'),
      'insert is pending in the sidecar before the delete');

    applyChanges([{ operation: 'delete', nodeId: 'ins00001' }]);
    flush();
    assert(!getDocument().content.some((n) => n.attrs?.id === 'ins00001'), 'node is gone from the document tree');
    assert(sidecarEntries('docact01').length === 0, 'sidecar holds no entry for it');
    assert(!readFileSync(activePath, 'utf-8').includes('Proposed ghost'), 'text never reaches the .md body');
    assert(!loadDocFromDisk('active.md').document.content.some((n) => n.attrs?.id === 'ins00001'),
      'reading the doc back from disk shows no ghost');
  }

  console.log('\nActive doc: delete a pending rewrite marks the original, not the rewrite');
  {
    applyChanges([{ operation: 'rewrite', nodeId: 'bb000001', content: para('bb000001', 'Unapproved rewrite.') }]);
    applyChanges([{ operation: 'delete', nodeId: 'bb000001' }]);
    flush();
    const bb = getDocument().content.find((n) => n.attrs?.id === 'bb000001');
    assert(bb?.attrs?.pendingStatus === 'delete', `node is a pending delete (got ${bb?.attrs?.pendingStatus})`);
    assert(bb?.content?.[0]?.text === 'Second.', `node holds the original text (got ${bb?.content?.[0]?.text})`);
    assert(!bb?.attrs?.pendingOriginalContent, 'rewrite baseline attr is withdrawn');
    assert(!readFileSync(activePath, 'utf-8').includes('Unapproved rewrite'), 'rewrite text never reaches the .md body');
  }

  console.log('\nActive doc: delete an original node still stages a pending delete');
  {
    applyChanges([{ operation: 'delete', nodeId: 'aa000001' }]);
    flush();
    const aa = getDocument().content.find((n) => n.attrs?.id === 'aa000001');
    assert(aa?.attrs?.pendingStatus === 'delete', 'original node is marked pending delete');
    assert(sidecarEntries('docact01').some((e) => e.nodeId === 'aa000001' && e.status === 'delete'),
      'sidecar holds the delete for review');
  }

  console.log('\nNon-active doc: delete a pending insert');
  {
    const otherPath = join(TEST_PROFILE_DIR, 'other.md');
    setActiveDocument({ type: 'doc', content: [para('cc000001', 'Third.'), para('dd000001', 'Fourth.')] },
      'Other', otherPath, false, undefined, { title: 'Other', docId: 'docoth01' });
    flush();
    setActiveDocument({ type: 'doc', content: [para('zz000001', 'Elsewhere.')] },
      'Elsewhere', join(TEST_PROFILE_DIR, 'elsewhere.md'), false, undefined, { title: 'Elsewhere', docId: 'docels01' });
    flush();

    applyChangesToFile('other.md', [{ operation: 'insert', afterNodeId: 'cc000001', content: para('ins00002', 'Proposed ghost two.') }]);
    assert(sidecarEntries('docoth01').some((e) => e.nodeId === 'ins00002'), 'insert is pending before the delete');
    applyChangesToFile('other.md', [{ operation: 'delete', nodeId: 'ins00002' }]);
    assert(!loadDocFromDisk('other.md').document.content.some((n) => n.attrs?.id === 'ins00002'),
      'reading the doc back shows no ghost');
    assert(sidecarEntries('docoth01').length === 0, 'sidecar holds no entry for it');
    assert(!readFileSync(otherPath, 'utf-8').includes('Proposed ghost two'), 'text never reaches the .md body');
  }
} catch (err) {
  failed++;
  console.error('  FAIL: threw', err);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
