/**
 * Cross-doc backlinks integration test.
 *
 * Verifies that the save-time matcher (Option B) preserves the IDs that
 * backlinks depend on: `to_node` (the target block being linked TO) and
 * `from_node` (the block in the source doc containing the link).
 *
 * Setup: doc A holds a target paragraph; doc B holds a paragraph with a
 * `[anchor](doc:AAA#aaa11111)` link pointing into A. Since v0.20 backlinks
 * are computed live from every doc's prose links (computeBacklinksFor), not
 * stored in A's frontmatter; the paragraph-anchored entries carry the node IDs.
 *
 * The matcher's job is to make sure that:
 * - Editing the target block in A doesn't change `to_node` → backlink valid.
 * - Type-changing the target block in A doesn't change `to_node` → still valid.
 * - Editing the source block in B doesn't change `from_node` → still valid.
 * - Deleting the source block prunes the backlink entry on A.
 * - Paste-back from graveyard restores both ends correctly.
 *
 * Drives the real production code path: setActiveDocument → save → writeToDisk.
 * No mirror functions, no module-private internals — just exported APIs.
 *
 * Run: `node scripts/test-backlinks-integration.mjs`
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
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
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';
import { computeBacklinksFor } from '../dist/server/backlinks.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-backlinks-${Date.now()}`;
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

/** A's paragraph-anchored inbound links (doc-level `references:` entries have no to_node). */
function anchoredBacklinks() {
  return computeBacklinksFor(docA_id).filter((b) => b.to_node);
}

function setDocContent(content) {
  updateDocument({ type: 'doc', content });
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

setActiveProfile(TEST_PROFILE);
mkdirSync(TEST_PROFILE_DIR, { recursive: true });
ensureDataDir();

const docA_id = 'aaaaaaaa';
const docB_id = 'bbbbbbbb';
const docA_path = join(TEST_PROFILE_DIR, 'A.md');
const docB_path = join(TEST_PROFILE_DIR, 'B.md');

try {
  // ==========================================================================
  // SETUP: Create doc A (target) and doc B (source linking to A)
  // ==========================================================================
  console.log('Setup: create doc A (target) + doc B (source with link to A)');
  {
    // Doc A: a target paragraph at known ID
    const docA = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'a8000001', level: 2 }, content: [{ type: 'text', text: 'A Heading' }] },
        { type: 'paragraph', attrs: { id: 'a7000001' }, content: [{ type: 'text', text: 'This is the target paragraph in document A.' }] },
        { type: 'paragraph', attrs: { id: 'a7000002' }, content: [{ type: 'text', text: 'Another paragraph that is not linked.' }] },
      ],
    };
    setActiveDocument(docA, 'A', docA_path, false, undefined, { title: 'A', docId: docA_id });
    save();
    assert(existsSync(docA_path), 'doc A written to disk');

    // Doc B: a paragraph with a doc-link pointing to A's target block
    // Link href format: doc:DOCID#NODEID
    const docB = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'b5000001' }, content: [
          { type: 'text', text: 'See ' },
          { type: 'text', marks: [{ type: 'link', attrs: { href: `doc:${docA_id}#a7000001` } }], text: 'the target' },
          { type: 'text', text: ' in document A for context.' },
        ]},
        { type: 'paragraph', attrs: { id: 'b5000002' }, content: [{ type: 'text', text: 'Source paragraph with no link.' }] },
      ],
    };
    setActiveDocument(docB, 'B', docB_path, false, undefined, { title: 'B', docId: docB_id });
    save();
    assert(existsSync(docB_path), 'doc B written to disk');

    // Verify A now has a backlink entry pointing to B's source block
    const fmA = readFrontmatter(docA_path);
    assert(anchoredBacklinks().length === 1, `A has 1 backlink (got ${anchoredBacklinks()?.length ?? 0})`);
    if (anchoredBacklinks()?.[0]) {
      assert(anchoredBacklinks()[0].from_doc === docB_id, `backlink.from_doc = B (got ${anchoredBacklinks()[0].from_doc})`);
      assert(anchoredBacklinks()[0].from_node === 'b5000001', `backlink.from_node = B's source block (got ${anchoredBacklinks()[0].from_node})`);
      assert(anchoredBacklinks()[0].to_node === 'a7000001', `backlink.to_node = A's target block (got ${anchoredBacklinks()[0].to_node})`);
    }
  }

  // ==========================================================================
  // K-A: Edit the target block in A — backlink to_node should remain valid
  // ==========================================================================
  console.log('\nK-A: edit target text in A, backlink to_node unchanged');
  {
    const reloaded = markdownToTiptap(readFileSync(docA_path, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, docA_path, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent(doc.content.map((b, i) => i !== 1 ? b : {
      ...b, content: [{ type: 'text', text: 'This is the target paragraph in document A, slightly edited.' }],
    }));
    save();
    const fmA = readFrontmatter(docA_path);
    const targetNode = fmA.nodes?.find((n) => n.id === 'a7000001');
    assert(!!targetNode, 'target paragraph a7000001 still alive in A');
    assert(anchoredBacklinks()?.[0]?.to_node === 'a7000001', `backlink to_node still a7000001 (got ${anchoredBacklinks()?.[0]?.to_node})`);
  }

  // ==========================================================================
  // K-B: Type-change the target (paragraph → heading) — to_node preserved
  // ==========================================================================
  console.log('\nK-B: type-change target paragraph to heading, to_node unchanged');
  {
    const reloaded = markdownToTiptap(readFileSync(docA_path, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, docA_path, false, undefined, reloaded.metadata);
    const doc = getDocument();
    setDocContent(doc.content.map((b, i) => i !== 1 ? b : {
      type: 'heading',
      attrs: { id: b.attrs.id, level: 3 },
      content: b.content,
    }));
    save();
    const fmA = readFrontmatter(docA_path);
    const targetNode = fmA.nodes?.find((n) => n.id === 'a7000001');
    assert(!!targetNode, 'target ID a7000001 preserved through type-change');
    assert(targetNode?.fp?.type === 'heading', `target is now a heading (got fp.type=${targetNode?.fp?.type})`);
    assert(anchoredBacklinks()?.[0]?.to_node === 'a7000001', 'backlink to_node unchanged');
  }

  // ==========================================================================
  // K-C: Edit the source block in B — from_node preserved
  // ==========================================================================
  console.log('\nK-C: edit source block in B, from_node in A backlinks unchanged');
  {
    const reloaded = markdownToTiptap(readFileSync(docB_path, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, docB_path, false, undefined, reloaded.metadata);
    const doc = getDocument();
    // Edit B's source block — keep the link mark intact, just add prose around it
    setDocContent(doc.content.map((b, i) => i !== 0 ? b : {
      ...b, content: [
        { type: 'text', text: 'Now updated. See ' },
        { type: 'text', marks: [{ type: 'link', attrs: { href: `doc:${docA_id}#a7000001` } }], text: 'the target' },
        { type: 'text', text: ' in document A for richer context.' },
      ],
    }));
    save();
    const fmA = readFrontmatter(docA_path);
    assert(anchoredBacklinks()?.length === 1, `A still has 1 backlink (got ${anchoredBacklinks()?.length})`);
    assert(anchoredBacklinks()?.[0]?.from_node === 'b5000001', `backlink.from_node still b5000001 (got ${anchoredBacklinks()?.[0]?.from_node})`);
    assert(anchoredBacklinks()?.[0]?.text?.includes('the target'), `backlink anchor text persists`);
  }

  // ==========================================================================
  // K-D: Delete the SOURCE block in B — backlink entry removed from A
  // ==========================================================================
  console.log('\nK-D: delete source block in B, backlink removed from A');
  {
    const reloaded = markdownToTiptap(readFileSync(docB_path, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, docB_path, false, undefined, reloaded.metadata);
    const doc = getDocument();
    // Drop B's source block (which contains the link)
    setDocContent(doc.content.filter((b) => b.attrs?.id !== 'b5000001'));
    save();
    const fmA = readFrontmatter(docA_path);
    assert(anchoredBacklinks().length === 0,
      `A's backlinks pruned to empty after source deleted (got ${anchoredBacklinks()?.length ?? 0})`);
  }

  // ==========================================================================
  // K-E: Re-add the link in B (paste-back) — backlink restored, IDs match
  // ==========================================================================
  console.log('\nK-E: re-insert source block in B with same content + link');
  {
    const reloaded = markdownToTiptap(readFileSync(docB_path, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, docB_path, false, undefined, reloaded.metadata);
    const doc = getDocument();
    // Paste back the exact same source block content (so matcher graveyard-restores its ID)
    setDocContent([
      { type: 'paragraph', attrs: { id: 'b5099999' }, content: [
        { type: 'text', text: 'Now updated. See ' },
        { type: 'text', marks: [{ type: 'link', attrs: { href: `doc:${docA_id}#a7000001` } }], text: 'the target' },
        { type: 'text', text: ' in document A for richer context.' },
      ]},
      ...doc.content,
    ]);
    save();
    const fmA = readFrontmatter(docA_path);
    const fmB = readFrontmatter(docB_path);
    assert(anchoredBacklinks()?.length === 1, `A has 1 backlink restored (got ${anchoredBacklinks()?.length})`);
    if (anchoredBacklinks()?.[0]) {
      // The matcher should have graveyard-restored b5000001 since the fingerprint matches.
      assert(anchoredBacklinks()[0].from_node === 'b5000001',
        `backlink.from_node restored to b5000001 via graveyard (got ${anchoredBacklinks()[0].from_node})`);
      assert(anchoredBacklinks()[0].to_node === 'a7000001',
        `backlink.to_node still a7000001 (got ${anchoredBacklinks()[0].to_node})`);
    }
  }

  // ==========================================================================
  // K-F: Graveyard cycle on TARGET — delete + paste-back, backlink still valid
  // ==========================================================================
  console.log('\nK-F: graveyard cycle on target in A — to_node restored via graveyard');
  {
    // First, capture what the target looks like in current state.
    let reloaded = markdownToTiptap(readFileSync(docA_path, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, docA_path, false, undefined, reloaded.metadata);
    let doc = getDocument();
    const targetIdx = doc.content.findIndex((b) => b.attrs?.id === 'a7000001');
    assert(targetIdx >= 0, 'target a7000001 located in A');
    const targetCopy = JSON.parse(JSON.stringify(doc.content[targetIdx]));

    // Delete the target block
    setDocContent(doc.content.filter((b) => b.attrs?.id !== 'a7000001'));
    save();
    let fmA = readFrontmatter(docA_path);
    const inGrave = fmA.graveyard?.some((g) => g.id === 'a7000001');
    assert(inGrave, 'a7000001 landed in A graveyard');

    // Paste back: insert a block with the exact same fingerprint (text + type)
    reloaded = markdownToTiptap(readFileSync(docA_path, 'utf-8'));
    setActiveDocument(reloaded.document, reloaded.title, docA_path, false, undefined, reloaded.metadata);
    doc = getDocument();
    setDocContent([
      doc.content[0], // heading
      { ...targetCopy, attrs: { ...targetCopy.attrs, id: 'a7099999' } }, // fresh transient ID, matcher overrides
      ...doc.content.slice(1),
    ]);
    save();
    fmA = readFrontmatter(docA_path);
    const restoredNode = fmA.nodes?.find((n) => n.id === 'a7000001');
    assert(!!restoredNode, 'a7000001 restored from graveyard');
    assert(!fmA.graveyard?.some((g) => g.id === 'a7000001'), 'a7000001 cleared from graveyard');
    // Backlink to_node should still be valid (it was always pointing at a7000001)
    assert(anchoredBacklinks()?.[0]?.to_node === 'a7000001',
      `backlink to_node still resolves to a7000001 (got ${anchoredBacklinks()?.[0]?.to_node})`);
  }

} finally {
  cleanup();
}

console.log('\n' + '='.repeat(60));
console.log(`Backlinks integration: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
