/**
 * The user typing inside a paragraph that has a pending rewrite.
 * adr: adr/pending-overlay-model.md
 *
 * A pending rewrite holds two versions of the paragraph: the proposal (the
 * node's content) and the original (pendingOriginalContent). Outside the
 * part the agent changed they are the same text. Typing edits the proposal,
 * so without help the user's words exist only there, and rejecting the
 * change deletes them. And the highlight offsets stay put while the text
 * moves, so the highlight marks the wrong words.
 *
 * For each user edit inside such a paragraph:
 *  - outside the agent's changed span, the same edit is made to the original,
 *    so the user's words survive a reject (and reach disk, which saves the
 *    original until the change is accepted);
 *  - inside it, only the proposal changes; the user is editing the agent's
 *    words;
 *  - the highlight offsets move with the text either way.
 *
 * The changed span is the text left after the common start and end of the
 * two versions, the same rule comment-coverage.ts uses. The stored highlight
 * offsets can't be used for this: they run from the first changed sentence
 * to the paragraph end.
 *
 * Agent edits and accept/reject/preview are not user typing. Those that
 * replace whole paragraphs never match (only edits strictly inside one
 * paragraph's text count); those that edit inside one carry
 * AGENT_EDIT_META.
 */

import type { Transaction, EditorState } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';

export const AGENT_EDIT_META = 'owAgentEdit';

function leafLength(node: any): number {
  if (node.isText) return node.text.length;
  if (node.type.name === 'hardBreak') return 1;
  return node.type.spec.leafText ? node.type.spec.leafText(node).length : 0;
}

/** The paragraph's text, a hard break counting as one character. */
function linearText(node: any): string {
  let text = '';
  node.forEach((child: any) => {
    text += child.isText ? child.text : (leafLength(child) ? '\n'.repeat(leafLength(child)) : '');
  });
  return text;
}

/** Text offset of a position inside the node's content (0 = content start). */
function offsetAt(node: any, contentPos: number): number {
  let offset = 0;
  let pos = 0;
  for (let i = 0; i < node.childCount && pos < contentPos; i++) {
    const child = node.child(i);
    offset += child.isText ? Math.min(child.nodeSize, contentPos - pos) : leafLength(child);
    pos += child.nodeSize;
  }
  return offset;
}

/** Position inside the node's content of a text offset. */
function posAt(node: any, offset: number): number {
  let seen = 0;
  let pos = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const len = leafLength(child);
    if (child.isText && seen + len >= offset) return pos + (offset - seen);
    if (!child.isText && seen + len > offset) return pos;
    seen += len;
    pos += child.nodeSize;
  }
  return pos;
}

/** The part of each version that differs: [from, to) in a and in b. */
function changedSpan(a: string, b: string) {
  let pre = 0;
  const max = Math.min(a.length, b.length);
  while (pre < max && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return { aFrom: pre, aTo: a.length - suf, bFrom: pre, bTo: b.length - suf };
}

/** Move a highlight range across an edit of [from, to) that changed the
 *  length by delta. An edit before it shifts it, one inside resizes it. */
function shiftRange(rangeFrom: number, rangeTo: number, from: number, to: number, delta: number): [number, number] {
  if (to <= rangeFrom) return [rangeFrom + delta, rangeTo + delta];
  if (from >= rangeTo) return [rangeFrom, rangeTo];
  return [rangeFrom, Math.max(rangeFrom, rangeTo + delta)];
}

type Attrs = Record<string, any>;

/** The textblock whose inline content holds [from, to], or null. */
function textblockAround(doc: any, from: number, to: number): { node: any; pos: number } | null {
  const $from = doc.resolve(from);
  if (!$from.parent.isTextblock || $from.depth === 0) return null;
  const start = $from.start();
  if (to > $from.end()) return null;
  return { node: $from.parent, pos: start - 1 };
}

function applyStep(step: ReplaceStep, doc: any, updated: Map<string, Attrs>): void {
  const { from, to, slice } = step as any;
  if (slice.openStart !== 0 || slice.openEnd !== 0) return; // split/join, not typing
  const found = textblockAround(doc, from, to);
  if (!found) return;
  const id = found.node.attrs?.id;
  const attrs: Attrs = { ...found.node.attrs, ...(id ? updated.get(id) : undefined) };
  if (!id || attrs.pendingStatus !== 'rewrite' || attrs.pendingGroupId) return;
  const originalJson = attrs.pendingOriginalContent;
  if (!originalJson || Array.isArray(originalJson)) return;

  const schema = doc.type.schema;
  // A wrapped rewrite (list item) keeps the wrapper as its original.
  const wrapped = originalJson.type !== found.node.type.name
    && originalJson.content?.[0]?.type === found.node.type.name;
  const wrapper = wrapped ? schema.nodeFromJSON(originalJson) : null;
  const original = wrapped ? wrapper.child(0) : schema.nodeFromJSON(originalJson);

  const contentStart = found.pos + 1;
  const editFrom = offsetAt(found.node, from - contentStart);
  const editTo = offsetAt(found.node, to - contentStart);
  const inserted = slice.content.textBetween(0, slice.content.size, '', '\n').length;
  const delta = inserted - (editTo - editFrom);

  const span = changedSpan(linearText(original), linearText(found.node));
  const next: Attrs = {};

  // Where the same edit sits in the original, when it's outside the
  // agent's span (at its edges counts as outside: the words are the user's).
  let origFrom: number | null = null;
  if (editTo <= span.bFrom) origFrom = editFrom;
  else if (editFrom >= span.bTo) origFrom = editFrom - span.bTo + span.aTo;
  if (origFrom !== null) {
    const origTo = origFrom + (editTo - editFrom);
    const edited = original.replace(posAt(original, origFrom), posAt(original, origTo), slice);
    next.pendingOriginalContent = wrapped
      ? wrapper.copy(wrapper.content.replaceChild(0, edited)).toJSON()
      : edited.toJSON();
    if (attrs.pendingOriginalFrom != null && attrs.pendingOriginalTo != null) {
      [next.pendingOriginalFrom, next.pendingOriginalTo] =
        shiftRange(attrs.pendingOriginalFrom, attrs.pendingOriginalTo, origFrom, origTo, delta);
    }
  }
  if (attrs.pendingSelectionFrom != null && attrs.pendingSelectionTo != null) {
    [next.pendingSelectionFrom, next.pendingSelectionTo] =
      shiftRange(attrs.pendingSelectionFrom, attrs.pendingSelectionTo, editFrom, editTo, delta);
  }
  if (Object.keys(next).length) updated.set(id, { ...updated.get(id), ...next });
}

/** appendTransaction for the pending plugin: keep the original and the
 *  highlight in step with the user's typing. */
export function followUserTyping(
  transactions: readonly Transaction[],
  _oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  const updated = new Map<string, Attrs>();
  for (const tr of transactions) {
    // Undo/redo replays the attrs along with the text, so it's already in step.
    if (!tr.docChanged || tr.getMeta(AGENT_EDIT_META) || tr.getMeta('history$')) continue;
    tr.steps.forEach((step, i) => {
      if (step instanceof ReplaceStep) applyStep(step, tr.docs[i], updated);
    });
  }
  if (updated.size === 0) return null;

  const out = newState.tr;
  newState.doc.descendants((node: any, pos: number) => {
    const next = node.attrs?.id ? updated.get(node.attrs.id) : undefined;
    if (next) out.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
    return true;
  });
  // Rides with the typing it follows, so Undo takes both back together.
  return out.docChanged ? out : null;
}
