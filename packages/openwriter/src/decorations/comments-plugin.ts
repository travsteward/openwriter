/**
 * ProseMirror plugin: renders dotted underline decorations for comments
 * (formerly "agent marks"). Comments are fetched from the server and matched
 * by text + nodeId. Supports multi-paragraph comments via nodeIds array.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface CommentData {
  id: string;
  text: string;
  note: string;
  nodeId: string;
  nodeIds?: string[];
  /** ISO timestamp from the server. Used by the popover to sort stacked
   *  siblings oldest-first. Optional for backwards compat with legacy data. */
  createdAt?: string;
  /** ISO timestamp set when the comment is resolved. The server filters these
   *  out of normal listings, so the field is usually absent here. */
  resolvedAt?: string;
}

export const commentDecorationKey = new PluginKey('commentDecoration');

let currentComments: CommentData[] = [];

export function setCommentsData(comments: CommentData[]): void {
  currentComments = comments;
}

export function getCommentsData(): CommentData[] {
  return currentComments;
}

function makeDecoAttrs(comment: CommentData): Record<string, string> {
  // No `title` attribute — the OS tooltip is noisy and can't host edit
  // affordances. Hover behavior is owned by <CommentPopover>, which reads
  // the data-comment-id and renders an in-editor popover instead.
  return {
    class: 'ow-comment',
    'data-comment-id': comment.id,
  };
}

function tryDecorate(comment: CommentData, node: any, pos: number): Decoration | null {
  const nodeText = node.textContent;
  const idx = nodeText.indexOf(comment.text);
  if (idx === -1) return null;

  const from = mapTextOffset(node, pos, idx);
  const to = mapTextOffset(node, pos, idx + comment.text.length);
  if (from === null || to === null || from >= to) return null;

  return Decoration.inline(from, to, makeDecoAttrs(comment));
}

/**
 * Try to decorate a multi-paragraph comment by splitting its text across the
 * ordered nodeIds and decorating each paragraph's portion independently.
 */
function tryDecorateMultiNode(
  comment: CommentData,
  textblockByNodeId: Map<string, { node: any; pos: number }>,
): Decoration[] {
  const ids = comment.nodeIds!;
  const segments = comment.text.split('\n');
  const attrs = makeDecoAttrs(comment);
  const decorations: Decoration[] = [];

  if (segments.length === ids.length) {
    // Fast path: 1:1 mapping
    for (let i = 0; i < ids.length; i++) {
      const seg = segments[i];
      if (!seg) continue;
      const entry = textblockByNodeId.get(ids[i]);
      if (!entry) continue;
      const nodeText = entry.node.textContent;
      const idx = nodeText.indexOf(seg);
      if (idx === -1) continue;
      const from = mapTextOffset(entry.node, entry.pos, idx);
      const to = mapTextOffset(entry.node, entry.pos, idx + seg.length);
      if (from !== null && to !== null && from < to) {
        decorations.push(Decoration.inline(from, to, attrs));
      }
    }
  } else {
    // Fallback: greedy matching
    let segIdx = 0;
    for (const id of ids) {
      if (segIdx >= segments.length) break;
      const entry = textblockByNodeId.get(id);
      if (!entry) continue;
      const seg = segments[segIdx];
      if (!seg) { segIdx++; continue; }
      const nodeText = entry.node.textContent;
      const idx = nodeText.indexOf(seg);
      if (idx === -1) continue;
      const from = mapTextOffset(entry.node, entry.pos, idx);
      const to = mapTextOffset(entry.node, entry.pos, idx + seg.length);
      if (from !== null && to !== null && from < to) {
        decorations.push(Decoration.inline(from, to, attrs));
        segIdx++;
      }
    }
  }

  return decorations;
}

/** Where the editor underlines this comment, or null when its words are no
 *  longer in the doc. Same matching as the decorations, so the Review rail
 *  and the editor always agree on which comments are placed. */
export function locateComment(doc: any, comment: CommentData): number | null {
  const found = buildCommentDecorations(doc, [comment]).find();
  return found.length > 0 ? found[0].from : null;
}

function buildCommentDecorations(doc: any, comments: CommentData[] = currentComments): DecorationSet {
  if (comments.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  const matched = new Set<string>();

  const textblockByNodeId = new Map<string, { node: any; pos: number }>();
  doc.descendants((node: any, pos: number) => {
    if (node.isTextblock && node.attrs?.id) {
      textblockByNodeId.set(node.attrs.id, { node, pos });
    }
    return true;
  });

  // Pass 1: match multi-node comments by nodeIds array
  for (const comment of comments) {
    if (comment.nodeIds && comment.nodeIds.length > 1) {
      const decs = tryDecorateMultiNode(comment, textblockByNodeId);
      if (decs.length > 0) {
        matched.add(comment.id);
        decorations.push(...decs);
      }
    }
  }

  // Pass 2: match single-node comments by nodeId
  for (const comment of comments) {
    if (matched.has(comment.id)) continue;
    const entry = textblockByNodeId.get(comment.nodeId);
    if (!entry) continue;
    const dec = tryDecorate(comment, entry.node, entry.pos);
    if (dec) {
      matched.add(comment.id);
      decorations.push(dec);
    }
  }

  // Pass 3: text fallback for unmatched comments
  const unmatched = comments.filter((c) => !matched.has(c.id));
  if (unmatched.length > 0) {
    doc.descendants((node: any, pos: number) => {
      if (!node.isTextblock) return true;
      for (const comment of unmatched) {
        if (matched.has(comment.id)) continue;
        const dec = tryDecorate(comment, node, pos);
        if (dec) {
          matched.add(comment.id);
          decorations.push(dec);
        }
      }
      return true;
    });
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Map a text character offset to a ProseMirror document position.
 */
function mapTextOffset(node: any, nodeStartPos: number, textOffset: number): number | null {
  let charCount = 0;
  let pos = nodeStartPos + 1;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.isText) {
      if (charCount + child.text.length >= textOffset) {
        return pos + (textOffset - charCount);
      }
      charCount += child.text.length;
      pos += child.nodeSize;
    } else {
      const leafLen = child.type.spec.leafText ? child.type.spec.leafText(child).length : 0;
      if (leafLen > 0 && charCount + leafLen >= textOffset) {
        return pos;
      }
      charCount += leafLen;
      pos += child.nodeSize;
    }
  }

  if (textOffset === charCount) return pos;
  return null;
}

export function createCommentDecorationPlugin(): Plugin {
  return new Plugin({
    key: commentDecorationKey,

    state: {
      init(_, state) {
        return buildCommentDecorations(state.doc);
      },
      apply(tr, oldSet, _oldState, newState) {
        if (tr.docChanged || tr.getMeta('forceCommentUpdate')) {
          return buildCommentDecorations(newState.doc);
        }
        return oldSet.map(tr.mapping, tr.doc);
      },
    },

    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

export function forceCommentRefresh(view: any): void {
  const { state, dispatch } = view;
  const tr = state.tr.setMeta('forceCommentUpdate', true);
  dispatch(tr);
}
