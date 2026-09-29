/**
 * Pending state hook: derives all pending change state from document(s).
 * Supports multiple editors (e.g. tweet thread with one editor per tweet).
 * Document-is-truth — no session storage needed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { acceptChange, rejectChange, acceptAllChanges, rejectAllChanges } from '../decorations/resolve';
import { setFocusedPendingNode, forceDecorationRefresh } from '../decorations/plugin';

// ============================================================================
// TYPES
// ============================================================================

export type PendingStatus = 'insert' | 'rewrite' | 'delete';

export interface PendingNodeInfo {
  nodeId: string;
  pos: number;
  pendingStatus: PendingStatus;
  groupId?: string;
  feedback?: string;
  editor: Editor;
}

export interface PendingCounts {
  insert: number;
  rewrite: number;
  delete: number;
  total: number;
}

// ============================================================================
// DERIVE STATE FROM DOCUMENT
// ============================================================================

export function derivePendingState(editor: Editor): PendingNodeInfo[] {
  const nodes: PendingNodeInfo[] = [];
  const seenGroups = new Set<string>();

  editor.state.doc.descendants((node: any, pos: number) => {
    const status = node.attrs?.pendingStatus as PendingStatus | undefined;
    if (status && node.attrs?.id) {
      const groupId = node.attrs?.pendingGroupId as string | undefined;

      // For grouped nodes, only include the first one (group leader)
      if (groupId) {
        if (seenGroups.has(groupId)) return true;
        seenGroups.add(groupId);
      }

      nodes.push({ nodeId: node.attrs.id, pos, pendingStatus: status, groupId, feedback: node.attrs?.pendingFeedback || undefined, editor });
    }
    return true;
  });
  return nodes;
}

/** Derive pending state across multiple editors */
function derivePendingStateAll(editors: Editor[]): PendingNodeInfo[] {
  const all: PendingNodeInfo[] = [];
  for (const editor of editors) {
    if (editor && !editor.isDestroyed) {
      all.push(...derivePendingState(editor));
    }
  }
  return all;
}

export function getPendingNodeIds(editor: Editor): string[] {
  return derivePendingState(editor).map((n) => n.nodeId);
}

function countPending(nodes: PendingNodeInfo[]): PendingCounts {
  let insert = 0, rewrite = 0, del = 0;
  for (const n of nodes) {
    if (n.pendingStatus === 'insert') insert++;
    else if (n.pendingStatus === 'rewrite') rewrite++;
    else if (n.pendingStatus === 'delete') del++;
  }
  return { insert, rewrite, delete: del, total: nodes.length };
}

// ============================================================================
// SCROLL HELPER
// ============================================================================

function scrollToNode(editor: Editor, nodeId: string): void {
  if (editor.isDestroyed) return;
  let targetPos = -1;
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.attrs?.id === nodeId) {
      targetPos = pos;
      return false;
    }
    return true;
  });

  if (targetPos === -1) return;

  // nodeDOM() may return a raw DOM Node (not HTMLElement) for atom/leaf nodes
  // like images. Fall back to parentElement, then coordsAtPos.
  const dom = editor.view.nodeDOM(targetPos);
  const el = dom instanceof HTMLElement ? dom : dom?.parentElement;
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Fallback: use coordsAtPos to compute scroll target
  try {
    const coords = editor.view.coordsAtPos(targetPos);
    const container = editor.view.dom.closest('.editor-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      const scrollTarget = coords.top - rect.top + container.scrollTop - container.clientHeight / 2;
      container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }
  } catch {
    // coords unavailable — nothing to scroll to
  }
}

// ============================================================================
// HOOK
// ============================================================================

export function usePendingState(editors: Editor[]) {
  const [pendingNodes, setPendingNodes] = useState<PendingNodeInfo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevNodeIdsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(() => {
    const valid = editors.filter(e => e && !e.isDestroyed);
    if (valid.length === 0) {
      setPendingNodes([]);
      prevNodeIdsRef.current = new Set();
      return;
    }
    const nodes = derivePendingStateAll(valid);
    setPendingNodes(nodes);

    // Detect newly added pending nodes → auto-focus the first new one
    const prevIds = prevNodeIdsRef.current;
    const newIds = new Set(nodes.map((n) => n.nodeId));
    let focusedNewIndex = -1;

    if (prevIds.size > 0) {
      for (let i = 0; i < nodes.length; i++) {
        if (!prevIds.has(nodes[i].nodeId)) {
          focusedNewIndex = i;
          break;
        }
      }
    }

    prevNodeIdsRef.current = newIds;

    if (focusedNewIndex >= 0) {
      setCurrentIndex(focusedNewIndex);
      scrollToNode(nodes[focusedNewIndex].editor, nodes[focusedNewIndex].nodeId);
    } else if (nodes.length === 0) {
      setCurrentIndex(0);
    } else {
      setCurrentIndex((prev) => Math.min(prev, nodes.length - 1));
    }
  }, [editors]);

  // Refresh on editor transactions (subscribe to ALL editors)
  useEffect(() => {
    const valid = editors.filter(e => e && !e.isDestroyed);
    if (valid.length === 0) return;

    const handleUpdate = () => {
      // Debounce to avoid excessive re-derives
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(refresh, 50);
    };

    for (const editor of valid) {
      editor.on('transaction', handleUpdate);
    }
    // Initial refresh
    refresh();

    // Auto-scroll to first pending change on editor mount (e.g. after doc switch)
    const scrollTimer = setTimeout(() => {
      const nodes = derivePendingStateAll(valid.filter(e => !e.isDestroyed));
      if (nodes.length > 0) {
        scrollToNode(nodes[0].editor, nodes[0].nodeId);
      }
    }, 150);

    return () => {
      for (const editor of valid) {
        if (!editor.isDestroyed) editor.off('transaction', handleUpdate);
      }
      clearTimeout(refreshTimerRef.current);
      clearTimeout(scrollTimer);
    };
  }, [editors, refresh]);

  // Sync focused node ID + group ID to decoration plugin for gutter line
  useEffect(() => {
    const node = pendingNodes[currentIndex] ?? null;
    setFocusedPendingNode(node?.nodeId ?? null, node?.groupId ?? null);
    if (node?.editor && !node.editor.isDestroyed && node.editor.view) {
      forceDecorationRefresh(node.editor.view);
    }
    return () => {
      setFocusedPendingNode(null);
    };
  }, [currentIndex, pendingNodes]);

  const counts = countPending(pendingNodes);
  const currentNode = pendingNodes[currentIndex] ?? null;

  const goToNext = useCallback(() => {
    if (pendingNodes.length === 0) return;
    const next = (currentIndex + 1) % pendingNodes.length;
    setCurrentIndex(next);
    if (pendingNodes[next]) {
      scrollToNode(pendingNodes[next].editor, pendingNodes[next].nodeId);
    }
  }, [pendingNodes, currentIndex]);

  const goToPrevious = useCallback(() => {
    if (pendingNodes.length === 0) return;
    const prev = (currentIndex - 1 + pendingNodes.length) % pendingNodes.length;
    setCurrentIndex(prev);
    if (pendingNodes[prev]) {
      scrollToNode(pendingNodes[prev].editor, pendingNodes[prev].nodeId);
    }
  }, [pendingNodes, currentIndex]);

  const scrollAfterResolve = useCallback(() => {
    const valid = editors.filter(e => e && !e.isDestroyed);
    const nodes = derivePendingStateAll(valid);
    if (nodes.length === 0) return;
    const idx = Math.min(currentIndex, nodes.length - 1);
    scrollToNode(nodes[idx].editor, nodes[idx].nodeId);
  }, [editors, currentIndex]);

  const acceptCurrent = useCallback(() => {
    if (!currentNode) return;
    acceptChange(currentNode.editor, currentNode.nodeId);
    refresh();
    scrollAfterResolve();
  }, [currentNode, refresh, scrollAfterResolve]);

  const rejectCurrent = useCallback(() => {
    if (!currentNode) return;
    rejectChange(currentNode.editor, currentNode.nodeId);
    refresh();
    scrollAfterResolve();
  }, [currentNode, refresh, scrollAfterResolve]);

  const handleAcceptAll = useCallback(() => {
    const valid = editors.filter(e => e && !e.isDestroyed);
    for (const editor of valid) {
      acceptAllChanges(editor);
    }
    refresh();
  }, [editors, refresh]);


  const handleRejectAll = useCallback(() => {
    const valid = editors.filter(e => e && !e.isDestroyed);
    for (const editor of valid) {
      rejectAllChanges(editor);
    }
    refresh();
  }, [editors, refresh]);

  return {
    pendingNodes,
    counts,
    currentNode,
    currentIndex,
    hasPending: counts.total > 0,
    goToNext,
    goToPrevious,
    acceptCurrent,
    rejectCurrent,
    acceptAll: handleAcceptAll,
    rejectAll: handleRejectAll,
    refresh,
  };
}
