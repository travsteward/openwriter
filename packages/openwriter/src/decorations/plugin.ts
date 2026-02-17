/**
 * ProseMirror plugin: scans pendingStatus node attrs → applies CSS classes
 * Port from BreeWriter AgenticDecorationPlugin.ts, simplified for Pad
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type PendingStatus = 'insert' | 'rewrite' | 'delete';

export const pendingDecorationKey = new PluginKey('pendingDecoration');

function getPendingClass(status: PendingStatus): string {
  switch (status) {
    case 'insert': return 'pending-insert';
    case 'rewrite': return 'pending-rewrite';
    case 'delete': return 'pending-delete';
    default: return '';
  }
}

/**
 * Map a text character offset within a node's inline content to a ProseMirror
 * document position. The offset counts only text characters (not node boundaries).
 */
function mapTextOffsetToPos(node: any, nodeStartPos: number, textOffset: number): number | null {
  // nodeStartPos points to the start of the block node in the doc.
  // The first inline position is nodeStartPos + 1 (inside the block).
  let charCount = 0;
  let pos = nodeStartPos + 1; // Start inside the block node

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.isText) {
      if (charCount + child.text.length >= textOffset) {
        return pos + (textOffset - charCount);
      }
      charCount += child.text.length;
      pos += child.nodeSize;
    } else {
      pos += child.nodeSize;
    }
  }

  // If offset equals total text length, return end position
  if (textOffset === charCount) return pos;
  return null;
}

function buildDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number) => {
    const status = node.attrs?.pendingStatus as PendingStatus | undefined;
    if (!status) return true;

    const textEdits = node.attrs?.pendingTextEdits;
    if (status && textEdits && Array.isArray(textEdits) && textEdits.length > 0) {
      // Use inline decorations for fine-grained highlighting
      for (const edit of textEdits) {
        const inlineStart = mapTextOffsetToPos(node, pos, edit.from);
        const inlineEnd = mapTextOffsetToPos(node, pos, edit.to);
        if (inlineStart !== null && inlineEnd !== null && inlineStart < inlineEnd) {
          decorations.push(
            Decoration.inline(inlineStart, inlineEnd, {
              class: `pending-inline-${edit.type || 'rewrite'}`,
            })
          );
        }
      }
      // Subtle parent node decoration
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { class: 'pending-inline-parent' })
      );
    } else if (status) {
      // Regular node-level decoration
      const className = getPendingClass(status);
      if (className) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, { class: className })
        );
      }
    }

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

export function createPendingDecorationPlugin(): Plugin {
  return new Plugin({
    key: pendingDecorationKey,

    state: {
      init(_, state) {
        return buildDecorations(state.doc);
      },
      apply(tr, oldSet, _oldState, newState) {
        if (tr.docChanged || tr.getMeta('forceDecorationUpdate')) {
          return buildDecorations(newState.doc);
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

export function forceDecorationRefresh(view: any): void {
  const { state, dispatch } = view;
  const tr = state.tr.setMeta('forceDecorationUpdate', true);
  dispatch(tr);
}
