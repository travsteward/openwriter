/**
 * Bridge: maps NodeChange objects from server/MCP to apply operations.
 */

import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
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
 * Apply multiple node changes in a single ProseMirror transaction.
 * One transaction = one decoration rebuild = one DOM render.
 * Falls back to individual applies for single changes.
 */
export function applyNodeChangesToEditor(
  editor: Editor,
  changes: NodeChange[]
): void {
  if (changes.length === 0) return;
  if (changes.length === 1) {
    applyNodeChangeToEditor(editor, changes[0]);
    return;
  }

  const schema = editor.state.schema;

  editor.chain().command(({ tr }) => {
    for (const change of changes) {
      try {
        if (change.operation === 'rewrite' && change.nodeId && change.content) {
          const found = findNodeByIdInDoc(tr.doc, change.nodeId);
          if (!found) continue;

          const contentArray = Array.isArray(change.content) ? change.content : [change.content];
          const pmNodes = contentArray.map((n: any) => schema.nodeFromJSON(n));
          tr.replaceWith(found.pos, found.pos + found.node.nodeSize, pmNodes);
        }

        else if (change.operation === 'insert' && change.content) {
          const contentArray = Array.isArray(change.content) ? change.content : [change.content];
          const pmNodes = contentArray.map((n: any) => schema.nodeFromJSON(n));

          if (change.nodeId && !change.afterNodeId) {
            // Replace empty node
            const found = findNodeByIdInDoc(tr.doc, change.nodeId);
            if (!found) continue;
            tr.replaceWith(found.pos, found.pos + found.node.nodeSize, pmNodes);
          } else if (change.afterNodeId) {
            const found = findNodeByIdInDoc(tr.doc, change.afterNodeId);
            if (!found) continue;
            const insertPos = found.pos + found.node.nodeSize;
            tr.insert(insertPos, Fragment.fromArray(pmNodes));
          }
        }

        else if (change.operation === 'delete' && change.nodeId) {
          const found = findNodeByIdInDoc(tr.doc, change.nodeId);
          if (!found) continue;
          if (found.node.attrs?.pendingStatus === 'delete') continue;
          tr.setNodeMarkup(found.pos, undefined, {
            ...found.node.attrs,
            pendingStatus: 'delete',
          });
        }
      } catch {
        // Skip individual changes that fail — don't block the batch
        continue;
      }
    }
    return true;
  }).run();
}

/** Find a node by ID in a ProseMirror document (works with tr.doc for batched operations). */
function findNodeByIdInDoc(doc: any, id: string): { node: any; pos: number } | null {
  let result: { node: any; pos: number } | null = null;
  doc.descendants((node: any, pos: number) => {
    if (node.attrs?.id === id) {
      result = { node, pos };
      return false;
    }
    return true;
  });
  return result;
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
