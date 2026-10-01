/**
 * Which comments a pending change touches. Accepting a change resolves the
 * comments it covers; rejecting leaves them open. Pure and dependency-free so
 * the browser (single accept, accept all) and the server (folder accept all)
 * share one rule.
 * adr: adr/comment-auto-resolve.md
 *
 * A comment is anchored to its words inside one or more paragraphs (nodeId /
 * nodeIds). While a rewrite is pending those words may sit in the original
 * text (the usual case: the fix addresses the comment) or in the proposed
 * text. Either way, the comment is covered when its words overlap the part
 * of the paragraph the change replaces, or, for an insertion, touches it or
 * is separated from it only by whitespace. A comment elsewhere in the same
 * paragraph stays open. One whose words can't be found stays open too,
 * unless it is the paragraph's only open comment.
 */

export interface CoverageComment {
  id: string;
  text: string;
  nodeId: string;
  nodeIds?: string[];
}

interface JsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, any>;
  content?: JsonNode[];
}

function textOf(node: JsonNode | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(textOf).join('');
}

function anchoredTo(c: CoverageComment, id: string): boolean {
  return c.nodeId === id || (c.nodeIds?.includes(id) ?? false);
}

function piecesOf(c: CoverageComment): string[] {
  return (c.nodeIds && c.nodeIds.length > 1 ? c.text.split('\n') : [c.text]).filter(Boolean);
}

/** Does any of the comment's words sit inside [from, to) of this text? A
 *  zero-width range (a pure insertion) covers words that straddle it. */
function overlaps(c: CoverageComment, text: string, from: number, to: number): boolean {
  return piecesOf(c).some((piece) => {
    const start = text.indexOf(piece);
    return start !== -1 && start < to && start + piece.length > from;
  });
}

/** Does any of the comment's words end or start at [from, to], allowing only
 *  whitespace between? Used for insertions, which touch words without
 *  replacing them. */
function touches(c: CoverageComment, text: string, from: number, to: number): boolean {
  while (from > 0 && /\s/.test(text[from - 1])) from--;
  while (to < text.length && /\s/.test(text[to])) to++;
  return piecesOf(c).some((piece) => {
    const start = text.indexOf(piece);
    return start !== -1 && start <= to && start + piece.length >= from;
  });
}

/** Ids of the comments this pending node's change covers. Call once per
 *  pending node; a group is covered by calling it for each member. */
export function commentsCoveredByChange(node: JsonNode, comments: CoverageComment[]): string[] {
  const attrs = node.attrs ?? {};
  const id = attrs.id as string | undefined;
  const status = attrs.pendingStatus as string | undefined;
  const original = attrs.pendingOriginalContent as JsonNode | JsonNode[] | undefined;

  // A group leader holds the original of the whole replaced range: every
  // comment on those paragraphs is covered.
  if (Array.isArray(original)) {
    const ids = new Set(original.map((n) => n.attrs?.id).filter(Boolean));
    if (id) ids.add(id);
    return comments.filter((c) => [...ids].some((nid) => anchoredTo(c, nid))).map((c) => c.id);
  }

  if (!id || (status !== 'rewrite' && status !== 'delete')) return [];
  const attached = comments.filter((c) => anchoredTo(c, id));
  if (status === 'delete') return attached.map((c) => c.id);

  // No original to compare against: the whole paragraph is replaced.
  if (!original) return attached.map((c) => c.id);

  // A wrapped rewrite (list item) keeps the wrapper as its original.
  const orig = original.type !== node.type && original.content?.[0]?.type === node.type
    ? original.content?.[0]
    : original;
  const originalText = textOf(orig);
  const proposedText = textOf(node);

  // The changed span is what's left after the common start and end. The
  // pending highlight range can't be used: it runs from the first changed
  // sentence to the paragraph end, which would swallow untouched comments.
  let pre = 0;
  const max = Math.min(originalText.length, proposedText.length);
  while (pre < max && originalText[pre] === proposedText[pre]) pre++;
  let suf = 0;
  while (suf < max - pre
    && originalText[originalText.length - 1 - suf] === proposedText[proposedText.length - 1 - suf]) suf++;

  // Words in neither version were reworded by an earlier change ("Wording
  // changed"). When that is the paragraph's only open comment, this rewrite
  // is taken as the fix for it.
  if (attached.length === 1 && !piecesOf(attached[0]).some((p) => originalText.includes(p) || proposedText.includes(p))) {
    return [attached[0].id];
  }

  // A pure insertion: nothing of the original is replaced. It covers the
  // comments it lands next to. The common start can run into the inserted
  // text when they begin alike, so slide the insertion point left as far as
  // it can equally sit and count words touching anywhere in that range.
  if (pre + suf === originalText.length) {
    let inserted = proposedText.slice(pre, proposedText.length - suf);
    let left = pre;
    while (left > 0 && inserted && originalText[left - 1] === inserted[inserted.length - 1]) {
      inserted = originalText[left - 1] + inserted.slice(0, -1);
      left--;
    }
    return attached
      .filter((c) => touches(c, originalText, left, pre)
        || overlaps(c, proposedText, left, left + inserted.length))
      .map((c) => c.id);
  }

  return attached
    .filter((c) => overlaps(c, originalText, pre, originalText.length - suf)
      || overlaps(c, proposedText, pre, proposedText.length - suf))
    .map((c) => c.id);
}
