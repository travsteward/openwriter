/**
 * Repro: false `pendingStaleBaseline` on a delete+rewrite batch.
 *
 * A first-time rewrite whose baseline == canonical must NOT be flagged stale.
 * Hypothesis: when a delete and a rewrite ride the same applyChanges batch,
 * the merged→canonical split leaves the rewrite's NEW content in canonical,
 * so the next applyOverlayPure compares canonical-as-rewrite to
 * baseline-as-original and falsely flags stale (amber dotted underline).
 *
 * Run: node scripts/test-stale-baseline-repro.mjs
 */
import { setActiveDocument, applyChanges, getDocument, cancelDebouncedSave, syncBrowserDocUpdate } from '../dist/server/state.js';
import { reconcileCanonicalToBaselines, applyOverlayPure } from '../dist/server/pending-overlay.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';
import { join } from 'path';
import { homedir } from 'os';
import { rmSync } from 'fs';

const PROFILE = `test-stale-${Date.now()}`;
const PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', PROFILE);
setActiveProfile(PROFILE);
ensureDataDir();

let pass = 0, fail = 0;
const assert = (c, m) => { c ? (pass++, console.log('  PASS:', m)) : (fail++, console.error('  FAIL:', m)); };

function findNode(doc, id) {
  let res = null;
  (function walk(ns) { for (const n of ns || []) { if (n.attrs?.id === id) res = n; if (n.content) walk(n.content); } })(doc.content);
  return res;
}
const makeDoc = () => ({
  type: 'doc', content: [
    { type: 'paragraph', attrs: { id: 'AAAA' }, content: [{ type: 'text', text: 'Alpha node text. Para A.' }] },
    { type: 'paragraph', attrs: { id: 'BBBB' }, content: [{ type: 'text', text: 'Bravo node text. Para B.' }] },
    { type: 'paragraph', attrs: { id: 'CCCC' }, content: [{ type: 'text', text: 'Charlie original text. Tail kept.' }] },
  ],
});
const newC = { type: 'paragraph', attrs: { id: 'CCCC' }, content: [{ type: 'text', text: 'Charlie REWRITTEN text. Tail kept.' }] };

// CASE 1 — control: rewrite alone
setActiveDocument(makeDoc(), 'Stale 1', join(PROFILE_DIR, 't1.md'), false, undefined, { title: 'Stale 1', docId: 'stale001' });
applyChanges([{ operation: 'rewrite', nodeId: 'CCCC', content: newC }]);
const c1 = findNode(getDocument(), 'CCCC');
console.log('  [case1] C.pendingStaleBaseline =', c1?.attrs?.pendingStaleBaseline);
assert(c1 && !c1.attrs?.pendingStaleBaseline, 'rewrite alone → C NOT falsely stale');

// CASE 2 — suspected trigger: delete + rewrite in one batch
setActiveDocument(makeDoc(), 'Stale 2', join(PROFILE_DIR, 't2.md'), false, undefined, { title: 'Stale 2', docId: 'stale002' });
applyChanges([
  { operation: 'delete', nodeId: 'AAAA' },
  { operation: 'rewrite', nodeId: 'CCCC', content: newC },
]);
const c2 = findNode(getDocument(), 'CCCC');
console.log('  [case2] C.pendingStaleBaseline =', c2?.attrs?.pendingStaleBaseline);
console.log('  [case2] C.pendingOriginalContent text =', JSON.stringify(c2?.attrs?.pendingOriginalContent?.content?.[0]?.text));
assert(c2 && !c2.attrs?.pendingStaleBaseline, 'delete+rewrite batch → C NOT falsely stale');

// CASE 3 — real trigger: TWEET doc (tweetContext) so delete hard-removes a
// paragraph, co-occurring with a rewrite in the same batch.
setActiveDocument(makeDoc(), 'Stale 3', join(PROFILE_DIR, 't3.md'), false, undefined, {
  title: 'Stale 3', docId: 'stale003', content_type: 'quote',
  tweetContext: { mode: 'quote', url: 'https://x.com/x/status/1' },
});
applyChanges([
  { operation: 'delete', nodeId: 'AAAA' },
  { operation: 'rewrite', nodeId: 'CCCC', content: newC },
]);
const c3 = findNode(getDocument(), 'CCCC');
console.log('  [case3 tweet] A present? =', !!findNode(getDocument(), 'AAAA'), '(false = hard-deleted)');
console.log('  [case3 tweet] C.pendingStaleBaseline =', c3?.attrs?.pendingStaleBaseline);
console.log('  [case3 tweet] C.pendingOriginalContent text =', JSON.stringify(c3?.attrs?.pendingOriginalContent?.content?.[0]?.text));
assert(c3 && !c3.attrs?.pendingStaleBaseline, 'tweet delete(hard)+rewrite batch → C NOT falsely stale');

// CASE 4 — real trigger: browser doc-update whose rewrite node lost
// pendingOriginalContent. syncBrowserDocUpdate sets canonical from the browser
// view via stripPendingFromDoc, which can only revert via the node's own attr.
setActiveDocument(makeDoc(), 'Stale 4', join(PROFILE_DIR, 't4.md'), false, undefined, {
  title: 'Stale 4', docId: 'stale004', content_type: 'quote',
  tweetContext: { mode: 'quote', url: 'https://x.com/x/status/1' },
});
applyChanges([{ operation: 'rewrite', nodeId: 'CCCC', content: newC }]);
// Simulate the browser echoing its doc back WITHOUT pendingOriginalContent on C:
const browserDoc = JSON.parse(JSON.stringify(getDocument()));
const bc = findNode(browserDoc, 'CCCC');
if (bc?.attrs) delete bc.attrs.pendingOriginalContent;
syncBrowserDocUpdate(browserDoc, 0); // browserVersion 0 → server C entry (baseline=original) preserved
const c4 = findNode(getDocument(), 'CCCC');
console.log('  [case4 browser] C.pendingStaleBaseline =', c4?.attrs?.pendingStaleBaseline);
console.log('  [case4 browser] C content text =', JSON.stringify(c4?.content?.[0]?.text));
assert(c4 && !c4.attrs?.pendingStaleBaseline, 'browser doc-update missing baseline → C NOT falsely stale');

// CASE 5 — the fix must NOT hide genuine drift. reconcile only reverts when
// canonical holds the rewrite's NEW text; a real out-of-band edit is left alone.
const entry = {
  nodeId: 'CCCC', status: 'rewrite',
  originalBaseline: { type: 'paragraph', attrs: { id: 'CCCC' }, content: [{ type: 'text', text: 'ORIGINAL.' }] },
  newContent: { type: 'paragraph', attrs: { id: 'CCCC' }, content: [{ type: 'text', text: 'REWRITE.' }] },
};
const canA = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'CCCC' }, content: [{ type: 'text', text: 'REWRITE.' }] }] };
reconcileCanonicalToBaselines(canA, [entry]);
assert(findNode(canA, 'CCCC').content[0].text === 'ORIGINAL.', '5a: canonical==newContent → reverted to baseline');
const canB = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'CCCC' }, content: [{ type: 'text', text: 'SOMEONE ELSE EDITED.' }] }] };
reconcileCanonicalToBaselines(canB, [entry]);
assert(findNode(canB, 'CCCC').content[0].text === 'SOMEONE ELSE EDITED.', '5b: genuine drift left intact → real stale still surfaces');

// CASE 6 — a baseline captured as split text runs (no styling difference)
// matches the same text loaded from disk as one run: NOT stale.
const splitEntry = {
  nodeId: 'DDDD', status: 'rewrite',
  originalBaseline: { type: 'paragraph', attrs: { id: 'DDDD' }, content: [{ type: 'text', text: 'Same words, ' }, { type: 'text', text: 'split in two.' }] },
  newContent: { type: 'paragraph', attrs: { id: 'DDDD' }, content: [{ type: 'text', text: 'New words.' }] },
};
const canSplit = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'DDDD' }, content: [{ type: 'text', text: 'Same words, split in two.' }] }] };
const merged6 = applyOverlayPure(canSplit, [splitEntry]);
assert(!findNode(merged6, 'DDDD').attrs?.pendingStaleBaseline, '6a: split-run baseline == one-run canonical → NOT stale');
const canBold = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'DDDD' }, content: [{ type: 'text', text: 'Same words, ' }, { type: 'text', text: 'split in two.', marks: [{ type: 'bold' }] }] }] };
assert(findNode(applyOverlayPure(canBold, [splitEntry]), 'DDDD').attrs?.pendingStaleBaseline === true, '6b: a real styling change still flags stale');
// 6c/6d — the same saved text written differently: key order inside an italic
// run, and an empty style mark the file never keeps. NOT stale.
const italicEntry = {
  nodeId: 'EEEE', status: 'rewrite',
  originalBaseline: { type: 'paragraph', attrs: { id: 'EEEE' }, content: [{ type: 'text', text: 'A moth, ' }, { type: 'text', marks: [{ type: 'italic' }], text: 'carbonaria' }, { type: 'text', marks: [{ type: 'textStyle' }], text: ', rare.' }] },
  newContent: { type: 'paragraph', attrs: { id: 'EEEE' }, content: [{ type: 'text', text: 'New.' }] },
};
const canItalic = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'EEEE' }, content: [{ type: 'text', text: 'A moth, ' }, { type: 'text', text: 'carbonaria', marks: [{ type: 'italic' }] }, { type: 'text', text: ', rare.' }] }] };
assert(!findNode(applyOverlayPure(canItalic, [italicEntry]), 'EEEE').attrs?.pendingStaleBaseline, '6c/6d: same saved text (italic key order, empty style mark) → NOT stale');

cancelDebouncedSave();
try { rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
