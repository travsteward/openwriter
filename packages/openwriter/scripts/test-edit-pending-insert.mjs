/**
 * Editing a pending proposal edits the proposal, never canonical.
 *
 * Regression: edit_text (or a rewrite) on a node that was itself a pending
 * insert stamped it pendingStatus='rewrite' with the insert as its "original".
 * A rewrite reverts to its original on save, so the agent's unapproved
 * paragraph was written into the .md body as if accepted.
 *
 * Covers the active doc (applyTextEdits) and a non-active doc
 * (applyTextEditsToFile), which share applyChangesToDoc, plus a second
 * rewrite of a pending rewrite keeping the true original as its baseline.
 *
 * adr: adr/pending-overlay-model.md
 *
 * Run: `node scripts/test-edit-pending-insert.mjs`
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
  applyTextEdits,
  applyChangesToFile,
  applyTextEditsToFile,
} from '../dist/server/state.js';
import { loadDocFromDisk } from '../dist/server/pending-overlay.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-edit-pending-${Date.now()}`;
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

function textOf(node) {
  return (node?.content || []).map((c) => c.text ?? textOf(c)).join('');
}

function flush() { save(); cancelDebouncedSave(); }

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

try {
  console.log('Active doc: edit_text a pending insert');
  const activePath = join(TEST_PROFILE_DIR, 'active.md');
  {
    setActiveDocument({ type: 'doc', content: [para('aa000001', 'First.'), para('bb000001', 'Second.')] },
      'Active', activePath, false, undefined, { title: 'Active', docId: 'docact01' });
    flush();
    applyChanges([{ operation: 'insert', afterNodeId: 'aa000001', content: para('ins00001', 'Proposed draft.') }]);
    flush();
    const edit = applyTextEdits('ins00001', [{ find: 'draft', replace: 'revision' }]);
    flush();
    assert(edit.success, 'edit_text applies');
    const node = getDocument().content.find((n) => n.attrs?.id === 'ins00001');
    assert(node?.attrs?.pendingStatus === 'insert', `node stays a pending insert (got ${node?.attrs?.pendingStatus})`);
    assert(textOf(node) === 'Proposed revision.', 'node holds the edited text');
    const body = readFileSync(activePath, 'utf-8');
    assert(!body.includes('Proposed'), '.md body holds no unapproved text');
    const entry = sidecarEntries('docact01').find((e) => e.nodeId === 'ins00001');
    assert(entry?.status === 'insert', `sidecar entry is an insert (got ${entry?.status})`);
    assert(textOf(entry?.newContent) === 'Proposed revision.', 'sidecar carries the edited proposal');
    const reread = loadDocFromDisk('active.md').document.content.find((n) => n.attrs?.id === 'ins00001');
    assert(reread?.attrs?.pendingStatus === 'insert', 'reading back from disk shows it as a pending insert');
  }

  console.log('\nActive doc: rewrite a pending rewrite keeps the true original');
  {
    applyChanges([{ operation: 'rewrite', nodeId: 'bb000001', content: para('bb000001', 'Rewrite one.') }]);
    applyChanges([{ operation: 'rewrite', nodeId: 'bb000001', content: para('bb000001', 'Rewrite two.') }]);
    flush();
    const entry = sidecarEntries('docact01').find((e) => e.nodeId === 'bb000001');
    assert(entry?.status === 'rewrite', 'sidecar entry is a rewrite');
    assert(entry?.originalBaseline?.content?.[0]?.text === 'Second.', 'baseline is the original text');
    const body = readFileSync(activePath, 'utf-8');
    assert(body.includes('Second.') && !body.includes('Rewrite'), '.md body holds only the original');
  }

  console.log('\nNon-active doc: edit_text a pending insert');
  {
    const otherPath = join(TEST_PROFILE_DIR, 'other.md');
    setActiveDocument({ type: 'doc', content: [para('cc000001', 'Third.')] },
      'Other', otherPath, false, undefined, { title: 'Other', docId: 'docoth01' });
    flush();
    setActiveDocument({ type: 'doc', content: [para('zz000001', 'Elsewhere.')] },
      'Elsewhere', join(TEST_PROFILE_DIR, 'elsewhere.md'), false, undefined, { title: 'Elsewhere', docId: 'docels01' });
    flush();

    applyChangesToFile('other.md', [{ operation: 'insert', afterNodeId: 'cc000001', content: para('ins00002', 'Proposed draft two.') }]);
    const edit = applyTextEditsToFile('other.md', 'ins00002', [{ find: 'draft', replace: 'revision' }]);
    assert(edit.success, 'edit_text applies');
    assert(!readFileSync(otherPath, 'utf-8').includes('Proposed'), '.md body holds no unapproved text');
    const entry = sidecarEntries('docoth01').find((e) => e.nodeId === 'ins00002');
    assert(entry?.status === 'insert', `sidecar entry is an insert (got ${entry?.status})`);
    assert(textOf(entry?.newContent) === 'Proposed revision two.', 'sidecar carries the edited proposal');
  }
} catch (err) {
  failed++;
  console.error('  FAIL: threw', err);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
