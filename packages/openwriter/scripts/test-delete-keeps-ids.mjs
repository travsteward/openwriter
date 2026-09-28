/**
 * A pending delete moves nothing: the save-time matcher keeps every ID the
 * tree already carries, and pending inserts stay on their anchors.
 *
 * Regression (doc 4899ccb6, 2026-09-28): a paragraph whose saved text changed
 * wholesale was deleted in the same save that first wrote a neighbouring
 * paragraph with an unknown ID. Slot continuity gave the deleted node's ID to
 * the neighbour and minted a fresh ID for the real owner, so the pending
 * delete landed on another paragraph's text, and a pending insert anchored to
 * the renamed neighbour was orphaned to the end of the doc.
 *
 * adr: adr/node-identity-matcher.md · adr: adr/pending-overlay-model.md
 *
 * Run: `node scripts/test-delete-keeps-ids.mjs`
 */

import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  setActiveDocument,
  save,
  cancelDebouncedSave,
  getDocument,
  getOverlayEntries,
  updateDocument,
  applyChanges,
} from '../dist/server/state.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-delete-keeps-ids-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);

function cleanup() {
  cancelDebouncedSave();
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

function para(id, text) {
  return { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] };
}

function flush() { save(); cancelDebouncedSave(); }

const order = () => getDocument().content.map((n) => n.attrs?.id);
const textOf = (id) => getDocument().content.find((n) => n.attrs?.id === id)?.content?.[0]?.text;

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

try {
  setActiveDocument({ type: 'doc', content: [
    para('aa000001', 'Opening paragraph stays.'),
    para('cc000001', 'Run that test on the stories the husband has been told.'),
    para('ff000001', 'Closing paragraph stays.'),
  ] }, 'Keep', join(TEST_PROFILE_DIR, 'keep.md'), false, undefined, { title: 'Keep', docId: 'dockeep1' });
  flush();

  // Agent proposes a paragraph after cc000001.
  applyChanges([{ operation: 'insert', afterNodeId: 'cc000001', content: para('in000001', 'Proposed insert.') }]);
  flush();

  // In one save window: the writer replaces cc000001's text outright and adds
  // a paragraph of their own before the insert, then the agent deletes cc000001.
  const doc = structuredClone(getDocument());
  doc.content[1] = para('cc000001', 'Entirely new wording from the writer.');
  doc.content.splice(2, 0, para('xx000001', 'The writer typed this paragraph.'));
  updateDocument(doc);
  applyChanges([{ operation: 'delete', nodeId: 'cc000001' }]);
  flush();

  const cc = getDocument().content.find((n) => n.attrs?.id === 'cc000001');
  assert(cc?.attrs?.pendingStatus === 'delete', `cc000001 is the pending delete (got ${cc?.attrs?.pendingStatus})`);
  assert(textOf('cc000001') === 'Entirely new wording from the writer.', `cc000001 keeps its own text (got ${textOf('cc000001')})`);
  assert(textOf('xx000001') === 'The writer typed this paragraph.', 'the neighbour keeps its ID and text');
  assert(JSON.stringify(order()) === JSON.stringify(['aa000001', 'cc000001', 'xx000001', 'in000001', 'ff000001']),
    `no node moves (got ${order().join(',')})`);
  const ins = getOverlayEntries().find((e) => e.nodeId === 'in000001');
  assert(ins?.status === 'insert' && ins.afterNodeId === 'xx000001',
    `the pending insert stays anchored after the neighbour (got ${ins?.status} after ${ins?.afterNodeId})`);
} catch (err) {
  failed++;
  console.error('  FAIL: threw', err);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
