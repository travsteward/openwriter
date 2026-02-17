/**
 * Resolve operations: accept/reject pending changes.
 * Simplified port from BreeWriter resolveOperations.ts — document-is-truth, no session.
 */

import type { Editor } from '@tiptap/core';
import { findNodeById } from './apply';
import { forceDecorationRefresh } from './plugin';
import { getPendingNodeIds } from '../hooks/usePendingState';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Expand a delete range upward through wrapper nodes.
 * If the target node is the only child of its parent (e.g., paragraph is the
 * only child of listItem), expand the range to include the parent. Repeat up
 * the chain (listItem → bulletList) to avoid leaving empty wrappers behind.
 */
function expandDeleteRange(doc: any, from: number, to: number): { from: number; to: number } {
  let $from = doc.resolve(from);
  while ($from.depth > 0) {
    const parent = $from.node($from.depth);
    const parentStart = $from.before($from.depth);
    const parentEnd = parentStart + parent.nodeSize;

    if (parent.childCount === 1) {
      from = parentStart;
      to = parentEnd;
      $from = doc.resolve(from);
    } else {
      break;
    }
  }
  return { from, to };
}

// ============================================================================
// ACCEPT
// ============================================================================

function acceptInsert(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return false;

  const { node, pos } = nodeResult;
  editor.chain().command(({ tr }) => {
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      pendingStatus: null,
    });
    return true;
  }).run();

  return true;
}

function acceptRewrite(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return false;

  const { node, pos } = nodeResult;
  editor.chain().command(({ tr }) => {
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      pendingStatus: null,
      pendingOriginalContent: null,
      pendingTextEdits: null,
    });
    return true;
  }).run();

  return true;
}

function acceptDelete(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return false;

  const { node, pos } = nodeResult;

  // Safety: verify node actually has pending delete
  if (node.attrs?.pendingStatus !== 'delete') return true;

  const range = expandDeleteRange(editor.state.doc, pos, pos + node.nodeSize);
  editor.chain().deleteRange(range).run();
  return true;
}

// ============================================================================
// REJECT
// ============================================================================

function rejectInsert(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return true; // Already gone

  const { node, pos } = nodeResult;
  if (node.attrs?.pendingStatus !== 'insert') return true;

  const range = expandDeleteRange(editor.state.doc, pos, pos + node.nodeSize);
  editor.chain().deleteRange(range).run();
  return true;
}

function rejectRewrite(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return false;

  const { node, pos } = nodeResult;
  if (node.attrs?.pendingStatus !== 'rewrite') return true;

  const originalContent = node.attrs?.pendingOriginalContent;
  if (originalContent) {
    // Restore original content
    editor.chain()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, originalContent)
      .run();
  } else {
    // No original content stored (e.g. from replace_document) — delete the node
    const range = expandDeleteRange(editor.state.doc, pos, pos + node.nodeSize);
    editor.chain().deleteRange(range).run();
  }

  return true;
}

function rejectDelete(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return false;

  const { node, pos } = nodeResult;
  if (node.attrs?.pendingStatus !== 'delete') return true;

  editor.chain().command(({ tr }) => {
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      pendingStatus: null,
    });
    return true;
  }).run();

  return true;
}

// ============================================================================
// UNIFIED ACCEPT / REJECT
// ============================================================================

export function acceptChange(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return false;

  const status = nodeResult.node.attrs?.pendingStatus;
  switch (status) {
    case 'insert': return acceptInsert(editor, nodeId);
    case 'rewrite': return acceptRewrite(editor, nodeId);
    case 'delete': return acceptDelete(editor, nodeId);
    default: return false;
  }
}

export function rejectChange(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return false;

  const status = nodeResult.node.attrs?.pendingStatus;
  switch (status) {
    case 'insert': return rejectInsert(editor, nodeId);
    case 'rewrite': return rejectRewrite(editor, nodeId);
    case 'delete': return rejectDelete(editor, nodeId);
    default: return false;
  }
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

export function acceptAllChanges(editor: Editor): void {
  const nodeIds = getPendingNodeIds(editor).reverse();
  for (const nodeId of nodeIds) {
    acceptChange(editor, nodeId);
  }
  if (editor.view) forceDecorationRefresh(editor.view);
}

export function rejectAllChanges(editor: Editor): void {
  const nodeIds = getPendingNodeIds(editor).reverse();
  for (const nodeId of nodeIds) {
    rejectChange(editor, nodeId);
  }
  if (editor.view) forceDecorationRefresh(editor.view);
}
