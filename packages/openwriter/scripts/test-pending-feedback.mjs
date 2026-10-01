/** Synthetic pending-note persistence check. Build the server before running. */
import assert from 'node:assert/strict';
import { splitMergedDoc, applyOverlayPure } from '../dist/server/pending-overlay.js';
import { tiptapToMarkdown, markdownToTiptap } from '../dist/server/markdown.js';

const paragraph = (id, text, attrs = {}) => ({
  type: 'paragraph',
  attrs: { id, ...attrs },
  content: [{ type: 'text', text }],
});

const baseline = paragraph('aaaaaaaa', 'Baseline line.');
const merged = { type: 'doc', content: [
  paragraph('aaaaaaaa', 'Revised line.', {
    pendingStatus: 'rewrite', pendingOriginalContent: baseline,
    pendingFeedback: 'Clarifies the opening.',
  }),
  paragraph('bbbbbbbb', 'Added line.', {
    pendingStatus: 'insert', pendingFeedback: 'Adds a transition.',
  }),
  paragraph('cccccccc', 'Repeated line.', {
    pendingStatus: 'delete', pendingFeedback: 'Repeats the previous point.',
  }),
  paragraph('dddddddd', 'No note.', { pendingStatus: 'insert' }),
] };

const { canonical, overlayEntries } = splitMergedDoc(merged);
assert.deepEqual(overlayEntries.map((entry) => entry.feedback), [
  'Clarifies the opening.', 'Adds a transition.', 'Repeats the previous point.', undefined,
]);
assert.deepEqual(canonical.content.map((node) => node.content?.[0]?.text), [
  'Baseline line.', 'Repeated line.',
]);

const markdown = tiptapToMarkdown(canonical, 'Synthetic document', { docId: 'eeeeeeee' });
assert.doesNotMatch(markdown, /pendingFeedback|Clarifies the opening|Adds a transition|Repeats the previous point/);
const reloaded = applyOverlayPure(
  markdownToTiptap(markdown).document,
  JSON.parse(JSON.stringify(overlayEntries)), // same format as the saved sidecar
);
assert.deepEqual(reloaded.content.map((node) => node.attrs?.pendingFeedback), [
  'Clarifies the opening.', 'Adds a transition.', 'Repeats the previous point.', undefined,
]);
assert.deepEqual(
  applyOverlayPure(reloaded, overlayEntries).content.map((node) => node.attrs?.id),
  reloaded.content.map((node) => node.attrs?.id),
  'reapplying the sidecar must not duplicate pending blocks',
);
const withoutNotes = applyOverlayPure(
  reloaded,
  overlayEntries.map(({ feedback: _feedback, ...entry }) => entry),
);
assert(withoutNotes.content.every((node) => !node.attrs?.pendingFeedback),
  'removing a note from the pending entry clears any stale note on reapply');

console.log('Pending feedback survives sidecar reload and stays out of canonical Markdown.');
