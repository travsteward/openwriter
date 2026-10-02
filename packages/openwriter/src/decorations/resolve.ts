/**
 * Resolve operations: accept/reject pending changes.
 * Document-is-truth — no session storage needed.
 */

import type { Editor } from '@tiptap/core';
import { findNodeById, findGroupMembers } from './apply';
import { forceDecorationRefresh } from './plugin';
import { getPendingNodeIds } from '../hooks/usePendingState';
import { getCommentsData } from './comments-plugin';
import { commentsCoveredByChange } from '../../server/comment-coverage';

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
      pendingSelectionFrom: null,
      pendingSelectionTo: null,
      pendingOriginalFrom: null,
      pendingOriginalTo: null,
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
// GROUP HELPERS
// ============================================================================

function acceptGroup(editor: Editor, groupId: string): boolean {
  const members = findGroupMembers(editor, groupId);
  if (members.length === 0) return false;

  // Clear pending markers on all group members (reverse for position stability)
  for (const m of [...members].reverse()) {
    const result = findNodeById(editor, m.nodeId);
    if (!result) continue;
    editor.chain().command(({ tr }) => {
      tr.setNodeMarkup(result.pos, undefined, {
        ...result.node.attrs,
        pendingStatus: null,
        pendingOriginalContent: null,
        pendingGroupId: null,
        pendingSelectionFrom: null,
      pendingSelectionTo: null,
      pendingOriginalFrom: null,
      pendingOriginalTo: null,
      });
      return true;
    }).run();
  }
  return true;
}

function rejectGroup(editor: Editor, groupId: string): boolean {
  const members = findGroupMembers(editor, groupId);
  if (members.length === 0) return false;

  // Group leader (first member) stores the original content for the entire range
  const originalContent = members[0].node.attrs?.pendingOriginalContent;

  // Get the contiguous range of the entire group
  const rangeFrom = members[0].pos;
  const lastMember = members[members.length - 1];
  const rangeTo = lastMember.pos + lastMember.node.nodeSize;

  try {
    if (originalContent && Array.isArray(originalContent) && originalContent.length > 0) {
      editor.chain()
        .deleteRange({ from: rangeFrom, to: rangeTo })
        .insertContentAt(rangeFrom, originalContent)
        .run();
    } else {
      // No original content: the group is inserted content only (a chapter
      // added to a manuscript). Its members can sit inside lists, so remove
      // the whole top-level blocks they span, leaving no empty wrappers.
      const doc = editor.state.doc;
      const $from = doc.resolve(rangeFrom);
      const $to = doc.resolve(rangeTo);
      editor.chain().deleteRange({
        from: $from.depth > 0 ? $from.before(1) : rangeFrom,
        to: $to.depth > 0 ? $to.after(1) : rangeTo,
      }).run();
    }
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// UNIFIED ACCEPT / REJECT
// ============================================================================

/** Comments the change at this node covers, read before accepting strips
 *  the pending attrs. adr: adr/comment-auto-resolve.md */
function coveredComments(editor: Editor, nodeId: string): string[] {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return [];
  const groupId = nodeResult.node.attrs?.pendingGroupId;
  const nodes = groupId ? findGroupMembers(editor, groupId).map((m) => m.node) : [nodeResult.node];
  const comments = getCommentsData();
  return nodes.flatMap((n) => commentsCoveredByChange(n.toJSON(), comments));
}

function resolveComments(ids: string[]): void {
  if (ids.length === 0) return;
  fetch('/api/comments/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [...new Set(ids)] }),
  }).catch((err) => console.error('[Comments] auto-resolve failed:', err));
}

/** Accept a change and resolve the comments it covers. */
export function acceptChange(editor: Editor, nodeId: string): boolean {
  const covered = coveredComments(editor, nodeId);
  const ok = applyAccept(editor, nodeId);
  if (ok) resolveComments(covered);
  return ok;
}

function applyAccept(editor: Editor, nodeId: string): boolean {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) return false;

  // Group-aware: accept entire group atomically
  const groupId = nodeResult.node.attrs?.pendingGroupId;
  if (groupId) return acceptGroup(editor, groupId);

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

  // Group-aware: reject entire group atomically
  const groupId = nodeResult.node.attrs?.pendingGroupId;
  if (groupId) return rejectGroup(editor, groupId);

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
  const covered = nodeIds.flatMap((nodeId) => coveredComments(editor, nodeId));
  for (const nodeId of nodeIds) {
    applyAccept(editor, nodeId);
  }
  resolveComments(covered);
  if (editor.view) forceDecorationRefresh(editor.view);
}

export function rejectAllChanges(editor: Editor): void {
  const nodeIds = getPendingNodeIds(editor).reverse();
  for (const nodeId of nodeIds) {
    rejectChange(editor, nodeId);
  }
  if (editor.view) forceDecorationRefresh(editor.view);
}
