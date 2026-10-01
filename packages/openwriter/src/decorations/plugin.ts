/**
 * ProseMirror plugin: scans pendingStatus node attrs → applies CSS classes.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { followUserTyping } from './pending-typing';

export type PendingStatus = 'insert' | 'rewrite' | 'delete';

export const pendingDecorationKey = new PluginKey('pendingDecoration');

// ============================================================================
// MODULE-LEVEL STATE: focused node + preview
// ============================================================================

let focusedNodeId: string | null = null;
let focusedGroupId: string | null = null;
export function setFocusedPendingNode(id: string | null, groupId?: string | null) {
  focusedNodeId = id;
  focusedGroupId = groupId ?? null;
}
export function getFocusedPendingNode() { return focusedNodeId; }

let previewActive = false;
let previewNodeId: string | null = null;
let previewGroupId: string | null = null;
let savedModifiedContent: any = null;

export function isPreviewActive(): boolean { return previewActive; }
export function getPreviewNodeId(): string | null { return previewNodeId; }
export function getPreviewGroupId(): string | null { return previewGroupId; }
export function getSavedModifiedContent() { return savedModifiedContent; }

export function setPreviewState(active: boolean, nodeId?: string | null, modified?: any, groupId?: string | null) {
  previewActive = active;
  previewNodeId = active ? (nodeId ?? null) : null;
  previewGroupId = active ? (groupId ?? null) : null;
  savedModifiedContent = active ? (modified ?? null) : null;
}

// ============================================================================
// HELPERS
// ============================================================================

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
      // Leaf nodes like hardBreak: count as 1 char to match server's linearText
      // which maps hardBreak → '\n'. leafText spec is unreliable (not all
      // schemas define it), so hardBreak is always 1 char.
      const leafLen = child.type.name === 'hardBreak' ? 1
        : (child.type.spec.leafText ? child.type.spec.leafText(child).length : 0);
      if (leafLen > 0 && charCount + leafLen >= textOffset) {
        return pos; // Position of the leaf node itself
      }
      charCount += leafLen;
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

    const nodeId = node.attrs?.id;
    const nodeGroupId = node.attrs?.pendingGroupId;

    // Is this node part of an active group (focused or previewing)?
    const isInFocusedGroup = nodeGroupId && nodeGroupId === focusedGroupId;
    const isInPreviewGroup = nodeGroupId && previewActive && nodeGroupId === previewGroupId;
    const isShowingOriginal = (previewActive && nodeId === previewNodeId) || isInPreviewGroup;

    // Determine selection range (use original offsets when previewing original)
    const selFrom = isShowingOriginal
      ? node.attrs?.pendingOriginalFrom
      : node.attrs?.pendingSelectionFrom;
    const selTo = isShowingOriginal
      ? node.attrs?.pendingOriginalTo
      : node.attrs?.pendingSelectionTo;
    const hasSelectionRange = selFrom != null && selTo != null;

    // Base class from pending status. Modifier classes layer on top for
    // orphan (anchor was lost — content preserved at end of doc) and
    // stale-baseline (canonical drifted under the agent's proposed
    // rewrite). The CSS gives each combination a distinct color border
    // while keeping the underlying status color for continuity.
    // adr: adr/pending-overlay-model.md
    const baseClass = isShowingOriginal ? 'pending-original' : getPendingClass(status);
    const modifiers: string[] = [];
    if (node.attrs?.pendingOrphan) modifiers.push('pending-orphan');
    if (node.attrs?.pendingStaleBaseline) modifiers.push('pending-stale');
    const className = baseClass + (modifiers.length ? ' ' + modifiers.join(' ') : '');

    if (hasSelectionRange && node.isTextblock && className) {
      // Partial-node decoration: highlight only the selection range
      const inlineStart = mapTextOffsetToPos(node, pos, selFrom);
      const inlineEnd = mapTextOffsetToPos(node, pos, selTo);
      if (inlineStart !== null && inlineEnd !== null && inlineStart < inlineEnd) {
        decorations.push(
          Decoration.inline(inlineStart, inlineEnd, { class: className })
        );
      }
    } else if (className) {
      // Full-node decoration
      const canInline = node.isTextblock && (pos + 1) < (pos + node.nodeSize - 1);
      if (canInline) {
        decorations.push(
          Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: className })
        );
      } else {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, { class: className })
        );
      }
    }

    // Active gutter line on focused node or all group members
    if (nodeId && (nodeId === focusedNodeId || isInFocusedGroup)) {
      const gutterStatus = isShowingOriginal ? 'original' : status;
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `pending-active pending-active--${gutterStatus}`,
        })
      );
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

    // While previewing the original, the paragraph shows the original, so
    // typing there isn't an edit to the proposal.
    appendTransaction(transactions, oldState, newState) {
      return previewActive ? null : followUserTyping(transactions, oldState, newState);
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
