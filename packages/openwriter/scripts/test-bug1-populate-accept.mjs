/**
 * test-bug1-populate-accept.mjs — Reproducer for the populate→accept→graveyard bug.
 *
 * Steps that mimic the live observation:
 *   1. setActiveDocument with a stub (empty body + trailing paragraph)
 *   2. populate_document equivalent: updateDocument with 5 inserts marked pending
 *   3. save() — disk should now have stub body + sidecar overlay
 *   4. Simulate browser accept-all: clear pendingStatus on every inserted node
 *      and send the result back through updateDocument (this is what the WS
 *      doc-update handler does after the browser strips markers).
 *   5. save() again — disk should have the 5 inserted nodes, no graveyard surprise.
 *
 * Pass condition: final disk body has the 5 inserted blocks. The trailing empty
 * paragraph is not expected: the serializer drops trailing empties (0ec19a3).
 * Fail condition: disk body is shorter or graveyard has the inserted IDs.
 */

import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { setActiveProfile, ensureDataDir, getDataDir } from '../dist/server/helpers.js';
import { setActiveDocument, updateDocument, save, getDocument, getMetadata, markAllNodesAsPending } from '../dist/server/state.js';

const TEST_PROFILE = `test-bug1-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);
setActiveProfile(TEST_PROFILE);
ensureDataDir();

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const filePath = join(getDataDir(), 'StubDoc.md');

function writeStub() {
  // Stub: frontmatter with just title + docId, body has a single trailing paragraph.
  const fm = JSON.stringify({ title: 'Stub', docId: 'stub0001', nodes: [['trail001']] });
  writeFileSync(filePath, `---\n${fm}\n---\n\n`, 'utf-8');
}

function readBody() {
  const raw = readFileSync(filePath, 'utf-8');
  const m = raw.match(/^---\n.+?\n---\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

function readMetadata() {
  const raw = readFileSync(filePath, 'utf-8');
  const m = raw.match(/^---\n(.+?)\n---/);
  return JSON.parse(m[1]);
}

try {
  console.log('Setting up stub doc on disk...');
  writeStub();

  // Load the stub into in-memory state.
  const stubDoc = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { id: 'trail001' } },
    ],
  };
  setActiveDocument(stubDoc, 'Stub', filePath, false, undefined, { title: 'Stub', docId: 'stub0001', nodes: [['trail001']] });
  console.log(`Initial in-memory doc has ${getDocument().content.length} nodes`);

  // Step 2: populate_document equivalent — replace with 5 paragraphs marked pending insert.
  const populatedDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 'head0001', level: 1 }, content: [{ type: 'text', text: 'Heading' }] },
      { type: 'paragraph', attrs: { id: 'para0001' }, content: [{ type: 'text', text: 'Para 1' }] },
      { type: 'paragraph', attrs: { id: 'para0002' }, content: [{ type: 'text', text: 'Para 2' }] },
      { type: 'paragraph', attrs: { id: 'para0003' }, content: [{ type: 'text', text: 'Para 3' }] },
      { type: 'paragraph', attrs: { id: 'para0004' }, content: [{ type: 'text', text: 'Para 4' }] },
    ],
  };
  markAllNodesAsPending(populatedDoc, 'insert');
  console.log('Calling updateDocument with populated content (all marked pending insert)...');
  updateDocument(populatedDoc);

  const afterPopulate = getDocument();
  console.log(`After populate updateDocument: ${afterPopulate.content.length} nodes in merged view`);
  assert(afterPopulate.content.length >= 5, `merged view has at least 5 nodes (got ${afterPopulate.content.length})`);

  console.log('Calling save() to persist pending state...');
  save();

  const afterFirstSave = readMetadata();
  console.log(`Disk after first save: nodes=${JSON.stringify(afterFirstSave.nodes)} graveyard=${JSON.stringify(afterFirstSave.graveyard || [])}`);

  // Step 4: simulate browser accept-all — clear pendingStatus on every node.
  // CRITICAL: in the live system, the trailing paragraph was lost from state
  // during populate (state.canonical was overwritten with the new content).
  // The browser only renders what's in state.document, so the accept doc the
  // browser sends back does NOT include trail001.
  const acceptedDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 'head0001', level: 1, pendingStatus: null }, content: [{ type: 'text', text: 'Heading' }] },
      { type: 'paragraph', attrs: { id: 'para0001', pendingStatus: null }, content: [{ type: 'text', text: 'Para 1' }] },
      { type: 'paragraph', attrs: { id: 'para0002', pendingStatus: null }, content: [{ type: 'text', text: 'Para 2' }] },
      { type: 'paragraph', attrs: { id: 'para0003', pendingStatus: null }, content: [{ type: 'text', text: 'Para 3' }] },
      { type: 'paragraph', attrs: { id: 'para0004', pendingStatus: null }, content: [{ type: 'text', text: 'Para 4' }] },
    ],
  };
  console.log('Calling updateDocument with accepted content (pendingStatus cleared, trailing re-added by browser)...');
  updateDocument(acceptedDoc);

  console.log(`After accept updateDocument: ${getDocument().content.length} nodes`);
  console.log('Calling save() to persist accepted state...');
  save();

  const afterAccept = readMetadata();
  const body = readBody();
  console.log('');
  console.log('=== POST-ACCEPT DISK STATE ===');
  console.log(`nodes:     ${JSON.stringify(afterAccept.nodes)}`);
  console.log(`graveyard: ${JSON.stringify(afterAccept.graveyard || [])}`);
  console.log(`body:`);
  console.log(body.split('\n').slice(0, 10).map((l) => '  ' + l).join('\n'));
  console.log('');

  // Pass conditions
  const nodeIds = (afterAccept.nodes || []).map((n) => Array.isArray(n) ? n[0] : n);
  const graveyardIds = (afterAccept.graveyard || []).map((g) => Array.isArray(g) ? g[0] : g);
  const inserted = ['head0001', 'para0001', 'para0002', 'para0003', 'para0004'];
  assert(inserted.every((id) => nodeIds.includes(id)), `disk has all 5 inserted nodes (got ${JSON.stringify(nodeIds)})`);
  assert(graveyardIds.length === 0 || !graveyardIds.includes('head0001'), `head0001 NOT in graveyard (graveyard=${JSON.stringify(graveyardIds)})`);
  assert(!graveyardIds.includes('para0001'), 'para0001 NOT in graveyard');
  assert(body.includes('Para 1'), 'body contains "Para 1"');
  assert(body.includes('Heading'), 'body contains "Heading"');

} finally {
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

console.log('');
console.log('============================================================');
console.log(`Bug #1 reproducer: ${passed} passed, ${failed} failed`);
console.log('============================================================');
process.exit(failed > 0 ? 1 : 0);
