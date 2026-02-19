/**
 * Apply operations: insert, rewrite, delete with pending decorations.
 * Document-is-truth — no session storage needed.
 */

import type { Editor, JSONContent } from '@tiptap/core';

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

export function applyInsert(
  editor: Editor,
  anchor: InsertAnchor,
  content: JSONContent | JSONContent[]
): ApplyResult {
  const contentArray: JSONContent[] = Array.isArray(content) ? content : [content];

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
    markLeafBlocksPending(contentWithPending, 'insert');

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

  // Duplicate detection: check document for existing pending inserts with same text
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

  const contentWithPending: JSONContent[] = contentArray.map((node) => ({
    ...node,
    attrs: {
      ...node.attrs,
      id: node.attrs?.id || generateNodeId(),
    },
  }));
  markLeafBlocksPending(contentWithPending, 'insert');

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

export function applyRewrite(
  editor: Editor,
  nodeId: string,
  newContent: JSONContent | JSONContent[]
): ApplyResult {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) {
    return { success: false, error: `Node ${nodeId} not found` };
  }

  const { node, pos } = nodeResult;
  const contentArray = Array.isArray(newContent) ? newContent : [newContent];

  // Store baseline (only first rewrite)
  const isFirstRewrite = !node.attrs?.pendingOriginalContent;
  const baselineContent = isFirstRewrite ? node.toJSON() : node.attrs.pendingOriginalContent;

  // First node replaces the target (rewrite)
  const firstNode: JSONContent = {
    ...contentArray[0],
    attrs: {
      ...contentArray[0].attrs,
      id: nodeId,
      pendingStatus: 'rewrite',
      pendingOriginalContent: baselineContent,
    },
  };

  // Additional nodes get inserted after as pending inserts
  const extraNodes: JSONContent[] = contentArray.slice(1).map((n) => ({
    ...n,
    attrs: {
      ...n.attrs,
      id: n.attrs?.id || generateNodeId(),
    },
  }));
  markLeafBlocksPending(extraNodes, 'insert');

  const allNodes = [firstNode, ...extraNodes];

  try {
    editor.chain()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, allNodes.length === 1 ? allNodes[0] : allNodes)
      .run();

    return { success: true, nodeId };
  } catch (error) {
    return { success: false, error: `Failed to rewrite: ${error}` };
  }
}

// ============================================================================
// APPLY DELETE
// ============================================================================

export function applyDelete(editor: Editor, nodeId: string): ApplyResult {
  const nodeResult = findNodeById(editor, nodeId);
  if (!nodeResult) {
    return { success: false, error: `Node ${nodeId} not found` };
  }

  const { node, pos } = nodeResult;

  // Skip duplicate
  if (node.attrs?.pendingStatus === 'delete') {
    return { success: true, nodeId };
  }

  try {
    editor.chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          pendingStatus: 'delete',
        });
        return true;
      })
      .run();

    return { success: true, nodeId };
  } catch (error) {
    return { success: false, error: `Failed to mark for deletion: ${error}` };
  }
}
