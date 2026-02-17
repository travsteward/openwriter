/**
 * Bridge: maps NodeChange objects from server/MCP to apply operations.
 */

import type { Editor } from '@tiptap/core';
import type { NodeChange } from '../ws/client';
import { applyInsert, applyRewrite, applyDelete, type InsertAnchor } from './apply';

export function applyNodeChangeToEditor(
  editor: Editor,
  change: NodeChange
): { success: boolean; error?: string } {
  if (change.operation === 'rewrite' && change.nodeId && change.content) {
    const result = applyRewrite(editor, change.nodeId, change.content);
    return { success: result.success, error: result.error };
  }

  if (change.operation === 'insert' && change.content) {
    let anchor: InsertAnchor | null = null;

    if (change.nodeId && !change.afterNodeId) {
      // INSERT replacing empty node
      anchor = { nodeId: change.nodeId };
    } else if (change.afterNodeId) {
      anchor = { afterNodeId: change.afterNodeId };
    }

    if (!anchor) {
      return { success: false, error: 'Insert requires afterNodeId or nodeId' };
    }

    const result = applyInsert(editor, anchor, change.content);
    return { success: result.success, error: result.error };
  }

  if (change.operation === 'delete' && change.nodeId) {
    const result = applyDelete(editor, change.nodeId);
    return { success: result.success, error: result.error };
  }

  return { success: false, error: `Invalid operation: ${change.operation}` };
}

/**
 * Apply node changes from context menu API response.
 * Maps API response nodes back to pending decorations.
 */
export function applyNodeChangesFromBridge(
  editor: Editor,
  responseNodes: any[],
  originalNodeIds: string[],
  action: string
): any[] {
  const results: any[] = [];

  if (action === 'delete') {
    for (const nodeId of originalNodeIds) {
      results.push(applyDelete(editor, nodeId));
    }
    return results;
  }

  if (action === 'insert') {
    // Insert after last selected node
    const anchorId = originalNodeIds[originalNodeIds.length - 1];
    if (anchorId && responseNodes.length > 0) {
      results.push(applyInsert(editor, { afterNodeId: anchorId }, responseNodes));
    }
    return results;
  }

  // Rewrite/shrink/expand/custom/fill: replace each node
  console.log('[Bridge] Rewrite loop:', { responseCount: responseNodes.length, idCount: originalNodeIds.length, ids: originalNodeIds });
  for (let i = 0; i < Math.min(responseNodes.length, originalNodeIds.length); i++) {
    const result = applyRewrite(editor, originalNodeIds[i], responseNodes[i]);
    console.log(`[Bridge] applyRewrite(${originalNodeIds[i]}):`, result);
    results.push(result);
  }

  // If API returned more nodes than originals, insert the extras
  if (responseNodes.length > originalNodeIds.length) {
    const lastOriginalId = originalNodeIds[originalNodeIds.length - 1];
    const extraNodes = responseNodes.slice(originalNodeIds.length);
    results.push(applyInsert(editor, { afterNodeId: lastOriginalId }, extraNodes));
  }

  return results;
}
