/**
 * Comments (formerly "agent marks") integration with the save-time matcher.
 *
 * Comments live in sidecar files at DATA_DIR/_marks/{filename}.json,
 * separate from the document body. Each comment references one or more block
 * IDs (`nodeId` + optional `nodeIds[]`). The matcher's job is to keep those
 * IDs stable across edits so comments anchor correctly; when the matcher
 * re-pins (e.g., on a slot-continuity recycling), the frontend rendering
 * layer has a text-fallback rescue (Pass 3 in src/decorations/comments-plugin.ts).
 *
 * This test characterizes the data-layer behavior: do comments' nodeId
 * references still point at live blocks after typical matcher operations?
 *
 * Run: `node scripts/test-comments-integration.mjs`
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs';
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
import { markdownToTiptap } from '../dist/server/markdown.js';
import { markdownToNodes, resolvePreviousNodes, resolveGraveyard } from '../dist/server/markdown-parse.js';
import { tiptapToBlocks } from '../dist/server/node-blocks.js';
import { addComment, getComments, resolveComments, deleteComments } from '../dist/server/comments.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-comments-${Date.now()}`;
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

function setDocContent(content) {
  updateDocument({ type: 'doc', content });
}

/** Get all active node IDs from disk's frontmatter. */
function activeIds(filePath) {
  const fm = readFrontmatter(filePath);
  return new Set((fm.nodes ?? []).map((n) => n.id));
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

const filename = 'marks.md';
const filePath = join(TEST_PROFILE_DIR, filename);

try {
  // ==========================================================================
  // SETUP: doc with 4 paragraphs, then attach marks to 2 of them
  // ==========================================================================
  console.log('Setup: create doc + attach single-node and multi-node marks');
  {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'aa000001', level: 2 }, content: [{ type: 'text', text: 'Marks Test' }] },
        { type: 'paragraph', attrs: { id: 'bb000001' }, content: [{ type: 'text', text: 'A paragraph that will get a single-node mark attached.' }] },
        { type: 'paragraph', attrs: { id: 'cc000001' }, content: [{ type: 'text', text: 'Another paragraph, second half of a multi-node mark span.' }] },
        { type: 'paragraph', attrs: { id: 'dd000001' }, content: [{ type: 'text', text: 'An unmarked paragraph for contrast.' }] },
      ],
    };
    setActiveDocument(doc, 'Marks', filePath, false);
    save();
    assert(existsSync(filePath), 'file written');

    // Single-node mark on bb000001
    const m1 = addComment(filename, 'A paragraph that will get a single-node mark attached.', 'note one', 'bb000001');
    // Multi-node mark spanning bb + cc (nodeId is last block; nodeIds[] is all)
    const m2 = addComment(filename, 'mark spans these two paragraphs', 'note two', 'cc000001', ['bb000001', 'cc000001']);
    assert(!!m1.id && m1.nodeId === 'bb000001', 'single-node mark created with nodeId=bb000001');
    assert(!!m2.id && Array.isArray(m2.nodeIds) && m2.nodeIds.length === 2,
      `multi-node mark created with 2 nodeIds (got ${m2.nodeIds?.length})`);

    const all = getComments(filename);
    assert(all[filename]?.length === 2, `getComments returns 2 comments (got ${all[filename]?.length})`);
  }

  // ==========================================================================
  // N-A: Edit text inside a marked block — nodeId preserved → mark anchored
  // ==========================================================================
  console.log('\nN-A: edit text in marked block, nodeId preserved');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent(doc.content.map((b) => b.attrs?.id !== 'bb000001' ? b : {
      ...b, content: [{ type: 'text', text: 'A paragraph that will get a single-node mark attached, now edited.' }],
    }));
    save();
    const ids = activeIds(filePath);
    assert(ids.has('bb000001'), 'bb000001 still in active nodes (matcher preserved through edit)');
    const marks = getComments(filename)[filename] ?? [];
    const single = marks.find((m) => m.text.includes('single-node mark'));
    assert(single?.nodeId === 'bb000001', `single-node mark still points at bb000001 (got ${single?.nodeId})`);
    const multi = marks.find((m) => m.text.includes('spans these two'));
    assert(multi?.nodeIds?.includes('bb000001'), 'multi-node mark still references bb000001');
    assert(multi?.nodeIds?.includes('cc000001'), 'multi-node mark still references cc000001');
  }

  // ==========================================================================
  // N-B: Type-change a marked block — nodeId preserved → mark still anchored
  // ==========================================================================
  console.log('\nN-B: type-change a marked paragraph to heading, nodeId preserved');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent(doc.content.map((b) => b.attrs?.id !== 'cc000001' ? b : {
      type: 'heading',
      attrs: { ...b.attrs, level: 3 },
      content: b.content,
    }));
    save();
    const ids = activeIds(filePath);
    assert(ids.has('cc000001'), 'cc000001 preserved through type-change');
    const marks = getComments(filename)[filename] ?? [];
    const multi = marks.find((m) => m.text.includes('spans these two'));
    assert(multi?.nodeIds?.includes('cc000001'),
      'multi-node mark still references cc000001 after type-change');
  }

  // ==========================================================================
  // N-C: Delete a marked block — nodeId becomes stale, falls into graveyard
  // ==========================================================================
  console.log('\nN-C: delete a marked block, nodeId becomes stale (mark survives in sidecar)');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    // Delete cc000001 (it's now a heading after N-B)
    setDocContent(doc.content.filter((b) => b.attrs?.id !== 'cc000001'));
    save();
    const ids = activeIds(filePath);
    const fm = readFrontmatter(filePath);
    assert(!ids.has('cc000001'), 'cc000001 removed from active nodes');
    assert(fm.graveyard?.some((g) => g.id === 'cc000001'), 'cc000001 in graveyard');
    // Comments sidecar still has the comment — pruneStaleComments isn't wired in
    const marks = getComments(filename)[filename] ?? [];
    const multi = marks.find((m) => m.text.includes('spans these two'));
    assert(!!multi, 'multi-node mark still present in sidecar (text fallback would rescue at render time)');
    assert(multi?.nodeIds?.includes('bb000001'),
      'multi-node mark still has bb000001 — its other nodeId is still valid');
    assert(multi?.nodeIds?.includes('cc000001'),
      'multi-node mark sidecar STILL lists cc000001 (stale ref — known gap, see ADR)');
  }

  // ==========================================================================
  // N-D: Paste back the deleted content — matcher graveyard-restores ID,
  //      stale mark reference becomes valid again automatically
  // ==========================================================================
  console.log('\nN-D: paste-back deleted block, graveyard restores ID + stale mark ref revives');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    // Insert back the exact-text heading after bb000001
    setDocContent([
      doc.content[0], // heading
      doc.content[1], // bb000001
      {
        type: 'heading',
        attrs: { id: 'tempCC01', level: 3 },
        content: [{ type: 'text', text: 'Another paragraph, second half of a multi-node mark span.' }],
      },
      ...doc.content.slice(2),
    ]);
    save();
    const ids = activeIds(filePath);
    assert(ids.has('cc000001'), 'cc000001 graveyard-restored to active nodes');
    const fm = readFrontmatter(filePath);
    assert(!fm.graveyard?.some((g) => g.id === 'cc000001'), 'cc000001 cleared from graveyard');
    const marks = getComments(filename)[filename] ?? [];
    const multi = marks.find((m) => m.text.includes('spans these two'));
    assert(multi?.nodeIds?.includes('cc000001'),
      'multi-node mark sidecar reference cc000001 is now LIVE again (graveyard-restore reunited mark with block)');
  }

  // ==========================================================================
  // N-E: Insert above a marked block — nodeId preserved, mark still anchored
  // ==========================================================================
  console.log('\nN-E: insert above a marked block, nodeId stable');
  {
    const reloaded = markdownToTiptap(readFileSync(filePath, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, filePath, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent([
      doc.content[0], // heading
      { type: 'paragraph', attrs: { id: 'ee000001' }, content: [{ type: 'text', text: 'A new paragraph inserted at position 1.' }] },
      ...doc.content.slice(1),
    ]);
    save();
    const ids = activeIds(filePath);
    assert(ids.has('bb000001'), 'bb000001 stable after insert above');
    const marks = getComments(filename)[filename] ?? [];
    const single = marks.find((m) => m.text.includes('single-node mark'));
    assert(single?.nodeId === 'bb000001', 'single-node mark still points at bb000001');
  }

  // ==========================================================================
  // N-F: Resolve a mark — sidecar entry removed
  // ==========================================================================
  console.log('\nN-F: resolveComments removes the entry from sidecar');
  {
    const marks = getComments(filename)[filename] ?? [];
    const single = marks.find((m) => m.text.includes('single-node mark'));
    assert(!!single, 'setup: single mark present');
    resolveComments([single.id]);
    const after = getComments(filename)[filename] ?? [];
    assert(after.length === 1, `1 mark remains after resolving 1 (got ${after.length})`);
    assert(!after.find((m) => m.id === single.id), 'resolved mark id no longer in sidecar');
  }

  // ==========================================================================
  // N-G: Resolve/delete on a doc whose filename has underscores writes back
  // to the same sidecar (no stray file) and listings keep the real filename
  // ==========================================================================
  console.log('\nN-G: underscore filenames resolve in place');
  {
    const uFile = '_untitled-a_b.md';
    const marksDir = join(TEST_PROFILE_DIR, '_marks');
    const c1 = addComment(uFile, 'one', 'n', 'aa000001');
    const c2 = addComment(uFile, 'two', 'n', 'aa000001');
    assert(Object.keys(getComments()).includes(uFile), 'global listing keys by the real filename');
    resolveComments([c1.id]);
    assert(!(getComments(uFile)[uFile] ?? []).some((m) => m.id === c1.id), 'resolved comment hidden');
    deleteComments([c2.id]);
    assert(!getComments(uFile)[uFile], 'deleted comment gone');
    const sidecars = readdirSync(marksDir).filter((f) => f.includes('untitled'));
    assert(sidecars.length === 1 && sidecars[0] === `${uFile}.json`, `no stray sidecar (got ${sidecars.join(', ')})`);
  }

} finally {
  cleanup();
}

console.log('\n' + '='.repeat(60));
console.log(`Comments integration: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
