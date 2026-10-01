/**
 * Bridge: maps NodeChange objects from server/MCP to apply operations.
 */

import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { NodeChange } from '../ws/client';
import { applyInsert, applyRewrite, applyDelete, applyRangeRewrite, markDeleteInTr, replaceNodeInPlace, type InsertAnchor } from './apply';

export function applyNodeChangeToEditor(
  editor: Editor,
  change: NodeChange
): { success: boolean; error?: string } {
  const options = change.autoAccept ? { autoAccept: true } : undefined;

  if (change.operation === 'rewrite' && change.nodeId && change.content) {
    const result = applyRewrite(editor, change.nodeId, change.content, null, options);
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

    const result = applyInsert(editor, anchor, change.content, options);
    return { success: result.success, error: result.error };
  }

  if (change.operation === 'delete' && change.nodeId) {
    const result = applyDelete(editor, change.nodeId, options);
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
        const autoAccept = change.autoAccept === true;

        if (change.operation === 'rewrite' && change.nodeId && change.content) {
          const found = findNodeByIdInDoc(tr.doc, change.nodeId);
          if (!found) {
            // Surface: silent skip here means the browser's TipTap doc has
            // diverged from the server's view of node IDs. The autosave
            // race in v0.14.0 lived exactly here — a missed change here is
            // how stale browser state ends up overwriting fresh MCP writes.
            // adr: adr/node-identity-matcher.md
            console.warn('[openwriter] rewrite skipped — node id not found in editor', { nodeId: change.nodeId });
            continue;
          }

          const contentArray = Array.isArray(change.content) ? change.content : [change.content];
          const pmNodes = contentArray.map((n: any) => schema.nodeFromJSON(n));
          replaceNodeInPlace(tr, found.pos, found.node, pmNodes[0]);
          if (pmNodes.length > 1) tr.insert(found.pos + tr.doc.nodeAt(found.pos)!.nodeSize, pmNodes.slice(1));
        }

        else if (change.operation === 'insert' && change.content) {
          const contentArray = Array.isArray(change.content) ? change.content : [change.content];
          const pmNodes = contentArray.map((n: any) => schema.nodeFromJSON(n));

          // Dedup pending-insert collisions (skipped when committing directly).
          if (!autoAccept) {
            const incomingText = pmNodes.map((n: any) => n.textContent || '').join('');
            if (incomingText && change.afterNodeId) {
              const anchor = findNodeByIdInDoc(tr.doc, change.afterNodeId);
              if (anchor) {
                const searchFrom = anchor.pos + anchor.node.nodeSize;
                const searchTo = Math.min(searchFrom + 5000, tr.doc.content.size);
                let isDuplicate = false;
                tr.doc.nodesBetween(searchFrom, searchTo, (node: any) => {
                  if (isDuplicate) return false;
                  if (node.attrs?.pendingStatus === 'insert' && (node.textContent || '') === incomingText) {
                    isDuplicate = true;
                    return false;
                  }
                  return true;
                });
                if (isDuplicate) continue;
              }
            }
          }

          if (change.nodeId && !change.afterNodeId) {
            // Replace empty node
            const found = findNodeByIdInDoc(tr.doc, change.nodeId);
            if (!found) {
              console.warn('[openwriter] insert (replace) skipped — node id not found in editor', { nodeId: change.nodeId });
              continue;
            }
            tr.replaceWith(found.pos, found.pos + found.node.nodeSize, pmNodes);
          } else if (change.afterNodeId) {
            const found = findNodeByIdInDoc(tr.doc, change.afterNodeId);
            if (!found) {
              // Surface: this is the exact silent-skip site the v0.14.0
              // autosave-clobber bug exploited. If you see this warning,
              // the matcher minted an ID the browser doesn't know about
              // and a stale autosave is about to overwrite server state.
              // adr: adr/node-identity-matcher.md
              console.warn('[openwriter] insert (after) skipped — anchor id not found in editor', { afterNodeId: change.afterNodeId });
              continue;
            }
            const insertPos = found.pos + found.node.nodeSize;
            tr.insert(insertPos, Fragment.fromArray(pmNodes));
          }
        }

        else if (change.operation === 'delete' && change.nodeId) {
          const found = findNodeByIdInDoc(tr.doc, change.nodeId);
          if (!found) {
            console.warn('[openwriter] delete skipped — node id not found in editor', { nodeId: change.nodeId });
            continue;
          }
          if (autoAccept) {
            // Hard-delete: remove node entirely.
            tr.delete(found.pos, found.pos + found.node.nodeSize);
          } else {
            markDeleteInTr(tr, found);
          }
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
 * Apply matcher-driven ID rewrites to the editor's TipTap doc in one atomic
 * transaction. The server's save-time matcher is the authority on identity;
 * after every save, any block whose ID changed gets reported here so the
 * browser's in-memory state converges to the server's view. Without this,
 * stale browser IDs cause subsequent server→browser updates to fail at the
 * anchor lookup and the browser's autosave eventually overwrites server
 * state with the stale snapshot (the v0.14.0 silent-data-loss pattern).
 *
 * adr: adr/node-identity-matcher.md
 */
export function applyIdRewritesToEditor(
  editor: Editor,
  rewrites: Array<{ oldId: string; newId: string }>,
): void {
  if (!rewrites || rewrites.length === 0) return;
  if (editor.isDestroyed) return;
  const rewriteMap = new Map(rewrites.map((r) => [r.oldId, r.newId]));

  editor.chain().command(({ tr }) => {
    // Collect positions first, then mutate. Collecting + mutating in the same
    // pass is safe because setNodeMarkup with the same node type doesn't
    // change node sizes — but we collect first anyway to make the intent
    // obvious and to make this safe against future changes to the schema.
    const updates: Array<{ pos: number; attrs: any }> = [];
    tr.doc.descendants((node: any, pos: number) => {
      const oldId = node.attrs?.id;
      if (oldId && rewriteMap.has(oldId)) {
        updates.push({ pos, attrs: { ...node.attrs, id: rewriteMap.get(oldId) } });
      }
    });
    for (const { pos, attrs } of updates) {
      tr.setNodeMarkup(pos, undefined, attrs);
    }
    return true;
  }).run();
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
    // Replace the empty node the cursor is on (not insert after)
    const anchorId = originalNodeIds[originalNodeIds.length - 1];
    if (anchorId && responseNodes.length > 0) {
      results.push(applyInsert(editor, { nodeId: anchorId }, responseNodes));
    }
    return results;
  }

  // Multi-node selection: atomic range replacement
  if (originalNodeIds.length > 1) {
    const result = applyRangeRewrite(editor, originalNodeIds, responseNodes);
    results.push(result);
    return results;
  }

  // Single-node rewrite: replace in place
  const result = applyRewrite(editor, originalNodeIds[0], responseNodes[0]);
  results.push(result);

  // If API returned more nodes than the single original, insert extras after
  if (responseNodes.length > 1) {
    const extraNodes = responseNodes.slice(1);
    results.push(applyInsert(editor, { afterNodeId: originalNodeIds[0] }, extraNodes));
  }

  return results;
}
