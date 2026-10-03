/**
 * Apply operations: insert, rewrite, delete with pending decorations.
 * Document-is-truth — no session storage needed.
 */

import type { Editor, JSONContent } from '@tiptap/core';
import { AGENT_EDIT_META } from './pending-typing';

// ============================================================================
// UTILITIES
// ============================================================================

export type NodeResult = { node: any; pos: number } | null;

export function findNodeById(editor: Editor, id: string): NodeResult {
  let result: NodeResult = null;
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.attrs?.id === id) {
      result = { node, pos };
      return false;
    }
    return true;
  });
  return result;
}

export function findGroupMembers(editor: Editor, groupId: string): Array<{ nodeId: string; pos: number; node: any }> {
  const members: Array<{ nodeId: string; pos: number; node: any }> = [];
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.attrs?.pendingGroupId === groupId) {
      members.push({ nodeId: node.attrs.id, pos, node });
    }
    return true;
  });
  return members;
}

function generateNodeId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10);
}

function extractTextContent(content: JSONContent | JSONContent[]): string {
  if (!content) return '';
  if (Array.isArray(content)) return content.map(extractTextContent).join('');
  if (content.text) return content.text;
  if (content.content && Array.isArray(content.content)) {
    return content.content.map((c) => extractTextContent(c as JSONContent)).join('');
  }
  return '';
}

const LEAF_BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock', 'horizontalRule', 'table', 'image']);

/** Mark leaf block nodes as pending, recursing into containers. */
function markLeafBlocksPending(nodes: JSONContent[], status: string): void {
  for (const node of nodes) {
    if (node.type && LEAF_BLOCK_TYPES.has(node.type)) {
      node.attrs = { ...node.attrs, pendingStatus: status };
    } else if (node.content) {
      markLeafBlocksPending(node.content, status);
    }
  }
}

/**
 * Replace a block with an agent's version of it, changing only the text that
 * differs. Replacing the whole block maps a cursor inside it to the block's
 * end, so the user's typing jumped to the next paragraph; an in-place edit
 * leaves a cursor in the untouched text where it was. Falls back to a whole
 * replacement when the block type changes. Marks the transaction as an agent
 * edit so it isn't taken for the user's typing (pending-typing.ts).
 */
export function replaceNodeInPlace(tr: any, pos: number, oldNode: any, newNode: any): void {
  tr.setMeta(AGENT_EDIT_META, true);
  if (oldNode.type !== newNode.type || !oldNode.isTextblock) {
    tr.replaceWith(pos, pos + oldNode.nodeSize, newNode);
    return;
  }
  replaceChangedContent(tr, pos + 1, oldNode, newNode);
  tr.setNodeMarkup(pos, undefined, newNode.attrs, newNode.marks);
}

/**
 * Turn oldParent's content (starting at contentStart in tr.doc) into
 * newParent's by replacing only the stretch that differs, so a cursor
 * outside that stretch keeps its place. Returns the replaced stretch.
 */
export function replaceChangedContent(tr: any, contentStart: number, oldParent: any, newParent: any): { from: number; to: number } | null {
  const start = oldParent.content.findDiffStart(newParent.content);
  if (start == null) return null;
  let { a: endA, b: endB } = oldParent.content.findDiffEnd(newParent.content)!;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) { endA += overlap; endB += overlap; }
  tr.replace(contentStart + start, contentStart + endA, newParent.slice(start, endB));
  return { from: contentStart + start, to: contentStart + endA };
}

// ============================================================================
// APPLY INSERT
// ============================================================================

export interface InsertAnchor {
  afterNodeId?: string;
  beforeNodeId?: string;
  nodeId?: string; // Replace empty node
}

export interface ApplyResult {
  success: boolean;
  nodeId?: string;
  error?: string;
}

export interface ApplyOptions {
  /** When true, content is inserted/replaced as a committed edit (no pending decoration). */
  autoAccept?: boolean;
}

export function applyInsert(
  editor: Editor,
  anchor: InsertAnchor,
  content: JSONContent | JSONContent[],
  options?: ApplyOptions
): ApplyResult {
  const contentArray: JSONContent[] = Array.isArray(content) ? content : [content];
  const autoAccept = options?.autoAccept === true;

  // Special case: INSERT replacing empty node
  if (anchor.nodeId && !anchor.afterNodeId && !anchor.beforeNodeId) {
    const nodeResult = findNodeById(editor, anchor.nodeId);
    if (!nodeResult) {
      return { success: false, error: `Node ${anchor.nodeId} not found` };
    }

    const contentWithPending: JSONContent[] = contentArray.map((node, index) => ({
      ...node,
      attrs: {
        ...node.attrs,
        id: node.attrs?.id || (index === 0 ? anchor.nodeId : generateNodeId()),
      },
    }));
    if (!autoAccept) markLeafBlocksPending(contentWithPending, 'insert');

    try {
      editor.chain()
        .deleteRange({ from: nodeResult.pos, to: nodeResult.pos + nodeResult.node.nodeSize })
        .insertContentAt(nodeResult.pos, contentWithPending)
        .run();

      return { success: true, nodeId: anchor.nodeId };
    } catch (error) {
      return { success: false, error: `Failed to replace empty node: ${error}` };
    }
  }

  // Normal INSERT: afterNodeId or beforeNodeId
  if (!anchor.afterNodeId && !anchor.beforeNodeId) {
    return { success: false, error: 'Insert requires afterNodeId, beforeNodeId, or nodeId' };
  }

  const anchorNodeId = anchor.afterNodeId || anchor.beforeNodeId!;
  const insertAfter = !!anchor.afterNodeId;

  const anchorResult = findNodeById(editor, anchorNodeId);
  if (!anchorResult) {
    return { success: false, error: `Anchor node ${anchorNodeId} not found` };
  }

  // Duplicate detection only matters when pending decorations are involved.
  // In autoAccept mode the agent's writes commit directly, so the dedup is skipped.
  if (!autoAccept) {
    const incomingText = extractTextContent(content);
    const searchStart = insertAfter
      ? anchorResult.pos + anchorResult.node.nodeSize
      : 0;
    const searchEnd = insertAfter
      ? anchorResult.pos + anchorResult.node.nodeSize + 5000
      : anchorResult.pos;

    let existingPendingId: string | null = null;
    editor.state.doc.nodesBetween(
      searchStart,
      Math.min(searchEnd, editor.state.doc.content.size),
      (node: any) => {
        if (node.attrs?.pendingStatus === 'insert' && node.attrs?.id) {
          if ((node.textContent || '') === incomingText) {
            existingPendingId = node.attrs.id;
            return false;
          }
        }
        return true;
      }
    );

    if (existingPendingId) {
      return { success: true, nodeId: existingPendingId };
    }
  }

  const contentWithPending: JSONContent[] = contentArray.map((node) => ({
    ...node,
    attrs: {
      ...node.attrs,
      id: node.attrs?.id || generateNodeId(),
    },
  }));
  if (!autoAccept) markLeafBlocksPending(contentWithPending, 'insert');

  const insertPos = insertAfter
    ? anchorResult.pos + anchorResult.node.nodeSize
    : anchorResult.pos;

  try {
    editor.chain().insertContentAt(insertPos, contentWithPending).run();
    return { success: true, nodeId: contentWithPending[0].attrs!.id };
  } catch (error) {
    return { success: false, error: `Failed to insert content: ${error}` };
  }
}

// ============================================================================
// APPLY REWRITE
// ============================================================================

export interface SelectionRange {
  selectionFrom: number;
  selectionTo: number;
  originalFrom: number;
  originalTo: number;
}

export function applyRewrite(
  editor: Editor,
  nodeId: string,
  newContent: JSONContent | JSONContent[],
  selectionRange?: SelectionRange | null,
  options?: ApplyOptions
): ApplyResult {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) {
    return { success: false, error: `Node ${nodeId} not found` };
  }

  const { node, pos } = nodeResult;
  const contentArray = Array.isArray(newContent) ? newContent : [newContent];
  const autoAccept = options?.autoAccept === true;

  // The baseline is the node's canonical form, never a pending proposal. A
  // pending insert (or a rewrite with no baseline) has none, so rewriting it
  // stays an insert. Mirrors the server's applyChangesToDoc.
  // adr: adr/pending-overlay-model.md
  const status = node.attrs?.pendingStatus;
  const priorBaseline = status === 'rewrite' ? node.attrs?.pendingOriginalContent : null;
  const staysInsert = status === 'insert' || (status === 'rewrite' && !priorBaseline);
  const baselineContent = priorBaseline || node.toJSON();

  // When the rewrite content is already a wrapper (listItem) with pending attrs
  // on the inner leaf — produced by the server's wrap-preserving rewrite path —
  // don't restamp pendingStatus on the wrapper too. The renderer would otherwise
  // draw both a wrapper-level node decoration and the inner inline decoration.
  const isServerWrappedRewrite =
    contentArray[0]?.type === 'listItem' &&
    contentArray[0]?.content?.[0]?.attrs?.pendingStatus != null;

  const firstNode: JSONContent = isServerWrappedRewrite ? {
    ...contentArray[0],
    attrs: { ...contentArray[0].attrs, id: nodeId },
  } : {
    ...contentArray[0],
    attrs: autoAccept ? {
      ...contentArray[0].attrs,
      id: nodeId,
    } : {
      ...contentArray[0].attrs,
      id: nodeId,
      ...(staysInsert
        ? { pendingStatus: 'insert', pendingOriginalContent: null }
        : { pendingStatus: 'rewrite', pendingOriginalContent: baselineContent }),
      ...(selectionRange && !staysInsert ? {
        pendingSelectionFrom: selectionRange.selectionFrom,
        pendingSelectionTo: selectionRange.selectionTo,
        pendingOriginalFrom: selectionRange.originalFrom,
        pendingOriginalTo: selectionRange.originalTo,
      } : {}),
    },
  };

  // Additional nodes get inserted after as pending inserts (plain in autoAccept).
  const extraNodes: JSONContent[] = contentArray.slice(1).map((n) => ({
    ...n,
    attrs: {
      ...n.attrs,
      id: n.attrs?.id || generateNodeId(),
    },
  }));
  if (!autoAccept) markLeafBlocksPending(extraNodes, 'insert');

  const allNodes = [firstNode, ...extraNodes];

  try {
    // One transaction, no chained deleteRange + insertContentAt (atom nodes
    // have nodeSize=1 which breaks the chain). Extra nodes go in after.
    editor.chain().command(({ tr }) => {
      const pmNodes = allNodes.map((n) => editor.state.schema.nodeFromJSON(n));
      replaceNodeInPlace(tr, pos, node, pmNodes[0]);
      if (pmNodes.length > 1) tr.insert(pos + tr.doc.nodeAt(pos)!.nodeSize, pmNodes.slice(1));
      return true;
    }).run();

    return { success: true, nodeId };
  } catch (error) {
    return { success: false, error: `Failed to rewrite: ${error}` };
  }
}

// ============================================================================
// APPLY RANGE REWRITE (multi-node selection → atomic replacement)
// ============================================================================

export function applyRangeRewrite(
  editor: Editor,
  originalNodeIds: string[],
  newContent: JSONContent[]
): ApplyResult {
  if (originalNodeIds.length === 0) {
    return { success: false, error: 'Range rewrite requires original IDs' };
  }

  // Validate new content has actual text — don't delete originals for empty responses
  if (!newContent || newContent.length === 0) {
    return { success: false, error: 'Range rewrite requires new content (received empty)' };
  }

  const totalText = newContent.map(n => extractTextContent(n)).join('');
  if (totalText.trim().length === 0) {
    return { success: false, error: 'Range rewrite content is empty (no text) — aborting' };
  }

  // Find first and last original nodes to get the range
  const firstResult = findNodeById(editor, originalNodeIds[0]);
  const lastResult = findNodeById(editor, originalNodeIds[originalNodeIds.length - 1]);
  if (!firstResult || !lastResult) {
    return { success: false, error: 'Could not find original nodes for range rewrite' };
  }

  // Capture all original nodes as JSON for baseline (undo)
  const originalNodesJson: JSONContent[] = [];
  for (const id of originalNodeIds) {
    const result = findNodeById(editor, id);
    if (result) {
      originalNodesJson.push(result.node.toJSON());
    }
  }

  const rangeFrom = firstResult.pos;
  const rangeTo = lastResult.pos + lastResult.node.nodeSize;
  const groupId = generateNodeId() + generateNodeId(); // 16-char group ID

  // Build replacement nodes with pending markers
  const replacementNodes: JSONContent[] = newContent.map((node, index) => ({
    ...node,
    attrs: {
      ...node.attrs,
      id: node.attrs?.id || generateNodeId(),
      pendingStatus: 'rewrite',
      pendingGroupId: groupId,
      // First node stores all original nodes for reject/undo
      ...(index === 0 ? { pendingOriginalContent: originalNodesJson } : {}),
    },
  }));

  try {
    editor.chain()
      .deleteRange({ from: rangeFrom, to: rangeTo })
      .insertContentAt(rangeFrom, replacementNodes)
      .run();

    return { success: true, nodeId: replacementNodes[0].attrs!.id };
  } catch (error) {
    return { success: false, error: `Failed to apply range rewrite: ${error}` };
  }
}

// ============================================================================
// APPLY DELETE
// ============================================================================

/**
 * Mark a node for deletion inside a transaction. A delete targets the node's
 * canonical form, so a pending proposal on it is withdrawn first, the same as
 * rejecting it. A pending insert (or a rewrite with no baseline) has no
 * canonical form and is removed outright. Mirrors the server's
 * applyChangesToDoc. adr: adr/pending-overlay-model.md
 */
export function markDeleteInTr(tr: any, found: { node: any; pos: number }): void {
  const { node, pos } = found;
  const status = node.attrs?.pendingStatus;
  if (status === 'delete') return;
  const original = status === 'rewrite' ? node.attrs?.pendingOriginalContent : null;
  if (status === 'insert' || (status === 'rewrite' && !original)) {
    tr.delete(pos, pos + node.nodeSize);
  } else if (original) {
    const attrs = { ...original.attrs, id: node.attrs.id, pendingStatus: 'delete', pendingOriginalContent: null };
    tr.replaceWith(pos, pos + node.nodeSize, tr.doc.type.schema.nodeFromJSON({ ...original, attrs }));
  } else {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, pendingStatus: 'delete' });
  }
}

export function applyDelete(editor: Editor, nodeId: string, options?: ApplyOptions): ApplyResult {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) {
    return { success: false, error: `Node ${nodeId} not found` };
  }

  const { node, pos } = nodeResult;
  const autoAccept = options?.autoAccept === true;

  try {
    if (autoAccept) {
      // Hard-delete: remove the node entirely.
      editor.chain()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .run();
    } else {
      editor.chain()
        .command(({ tr }) => {
          markDeleteInTr(tr, nodeResult);
          return true;
        })
        .run();
    }

    return { success: true, nodeId };
  } catch (error) {
    return { success: false, error: `Failed to ${autoAccept ? 'delete' : 'mark for deletion'}: ${error}` };
  }
}
