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
 * paragraph stays open. A reworded comment is placed by its surviving words;
 * one with none left stays open unless nothing on the paragraph can be
 * placed.
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

/** Where a piece of the comment sits in this text, as [start, end). Exact
 *  words first. With `estimate`, a reworded comment ("Wording changed": its
 *  exact words are gone) is placed by its longest run of two or more
 *  surviving words, stretched to the comment's full length around that run.
 *  null when it can't be placed. */
function spanOf(piece: string, text: string, estimate: boolean): [number, number] | null {
  const exact = text.indexOf(piece);
  if (exact !== -1) return [exact, exact + piece.length];
  if (!estimate) return null;
  const words = piece.split(/\s+/).filter(Boolean);
  for (let len = words.length - 1; len >= 2; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const run = words.slice(i, i + len).join(' ');
      const at = text.indexOf(run);
      if (at === -1) continue;
      const start = Math.max(0, at - piece.indexOf(run));
      return [start, Math.min(text.length, start + piece.length)];
    }
  }
  return null;
}

/** Does any of the comment's words sit inside [from, to) of this text? A
 *  zero-width range (a pure insertion) covers words that straddle it. */
function overlaps(c: CoverageComment, text: string, from: number, to: number, estimate = false): boolean {
  return piecesOf(c).some((piece) => {
    const span = spanOf(piece, text, estimate);
    return span !== null && span[0] < to && span[1] > from;
  });
}

/** Does any of the comment's words end or start at [from, to], allowing only
 *  whitespace between? Used for insertions, which touch words without
 *  replacing them. */
function touches(c: CoverageComment, text: string, from: number, to: number): boolean {
  while (from > 0 && /\s/.test(text[from - 1])) from--;
  while (to < text.length && /\s/.test(text[to])) to++;
  return piecesOf(c).some((piece) => {
    const span = spanOf(piece, text, true);
    return span !== null && span[0] <= to && span[1] >= from;
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

  // A reworded comment is placed by its surviving words (spanOf) and covered
  // like any other. One with no words left can't be placed. When no open
  // comment on the paragraph can be placed, this rewrite is taken as the fix
  // for all of them; otherwise the unplaceable ones stay open.
  const placeable = (c: CoverageComment) => piecesOf(c).some((p) =>
    spanOf(p, originalText, true) !== null || proposedText.includes(p));
  if (attached.length > 0 && !attached.some(placeable)) return attached.map((c) => c.id);

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
    .filter((c) => overlaps(c, originalText, pre, originalText.length - suf, true)
      || overlaps(c, proposedText, pre, proposedText.length - suf))
    .map((c) => c.id);
}
