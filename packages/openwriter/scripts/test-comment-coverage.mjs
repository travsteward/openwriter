/**
 * Accepting a change resolves the comments whose words it touches, and only
 * those. adr: adr/comment-auto-resolve.md
 *
 * Run: `node scripts/test-comment-coverage.mjs` (after the server build)
 */

import { commentsCoveredByChange } from '../dist/server/comment-coverage.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const para = (id, text, attrs = {}) => ({ type: 'paragraph', attrs: { id, ...attrs }, content: [{ type: 'text', text }] });

const ORIGINAL = 'The cat sat down. It was very very tired. Then it slept.';
const PROPOSED = 'The cat sat down. It was exhausted. Then it slept.';
// Only "very very tired" -> "exhausted" changed.
const of = ORIGINAL.indexOf('very very tired'), ot = of + 'very very tired'.length;
const sf = PROPOSED.indexOf('exhausted'), st = sf + 'exhausted'.length;
const rewrite = para('p1', PROPOSED, {
  pendingStatus: 'rewrite',
  pendingOriginalContent: para('p1', ORIGINAL),
  pendingOriginalFrom: of, pendingOriginalTo: ot,
  pendingSelectionFrom: sf, pendingSelectionTo: st,
});

const comments = [
  { id: 'hit', text: 'very very tired', nodeId: 'p1' },        // the words the fix replaced
  { id: 'part', text: 'was very', nodeId: 'p1' },              // overlaps the edge
  { id: 'same-para', text: 'Then it slept', nodeId: 'p1' },    // same paragraph, untouched
  { id: 'other', text: 'very very tired', nodeId: 'p2' },      // another paragraph
  { id: 'on-new', text: 'exhausted', nodeId: 'p1' },           // left on the proposed words
  { id: 'gone', text: 'nowhere to be found', nodeId: 'p1' },   // can't place it: stays open
];

console.log('\nPartial rewrite');
const got = commentsCoveredByChange(rewrite, comments).sort();
assert(JSON.stringify(got) === JSON.stringify(['hit', 'on-new', 'part']), `covers only the touched words (got ${got})`);

console.log('\nWhole-paragraph rewrite and delete');
const whole = para('p1', 'Entirely new.', { pendingStatus: 'rewrite' });
assert(commentsCoveredByChange(whole, comments).length === 5, 'with no original kept, every comment on the paragraph');
// The pending highlight runs to the paragraph end; the rule must not.
const wide = { ...rewrite, attrs: { ...rewrite.attrs, pendingOriginalTo: ORIGINAL.length, pendingSelectionTo: PROPOSED.length } };
assert(!commentsCoveredByChange(wide, comments).includes('same-para'), 'an untouched sentence after the change stays open');
const del = para('p1', ORIGINAL, { pendingStatus: 'delete' });
assert(commentsCoveredByChange(del, comments).length === 5, 'deleting the paragraph covers its comments');

console.log('\nInsert');
const ins = para('p9', 'Brand new paragraph.', { pendingStatus: 'insert' });
assert(commentsCoveredByChange(ins, comments).length === 0, 'a new paragraph covers nothing');

console.log('\nGroup and multi-paragraph comments');
const leader = para('n1', 'Merged.', { pendingStatus: 'rewrite', pendingGroupId: 'g', pendingOriginalContent: [para('p1', 'a'), para('p2', 'b')] });
assert(commentsCoveredByChange(leader, comments).length === 6, 'a group covers comments on every original paragraph');
const multi = [{ id: 'm', text: 'unrelated\nvery very', nodeIds: ['p0', 'p1'], nodeId: 'p0' }];
assert(commentsCoveredByChange(rewrite, multi).length === 1, 'a comment spanning paragraphs is covered by its touched part');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
