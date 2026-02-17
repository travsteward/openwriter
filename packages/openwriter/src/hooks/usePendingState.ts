/**
 * Pending state hook: derives all pending change state from document.
 * Port from BreeWriter derivePendingState.ts + useAgenticSession.ts.
 * Document-is-truth — no session storage needed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { acceptChange, rejectChange, acceptAllChanges, rejectAllChanges } from '../decorations/resolve';

// ============================================================================
// TYPES
// ============================================================================

export type PendingStatus = 'insert' | 'rewrite' | 'delete';

export interface PendingNodeInfo {
  nodeId: string;
  pos: number;
  pendingStatus: PendingStatus;
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
  editor.state.doc.descendants((node: any, pos: number) => {
    const status = node.attrs?.pendingStatus as PendingStatus | undefined;
    if (status && node.attrs?.id) {
      nodes.push({ nodeId: node.attrs.id, pos, pendingStatus: status });
    }
    return true;
  });
  return nodes;
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
  let targetPos = -1;
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.attrs?.id === nodeId) {
      targetPos = pos;
      return false;
    }
    return true;
  });

  if (targetPos === -1) return;

  const dom = editor.view.nodeDOM(targetPos);
  if (dom && dom instanceof HTMLElement) {
    dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ============================================================================
// HOOK
// ============================================================================

export function usePendingState(editor: Editor | null) {
  const [pendingNodes, setPendingNodes] = useState<PendingNodeInfo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setPendingNodes([]);
      return;
    }
    const nodes = derivePendingState(editor);
    setPendingNodes(nodes);

    // Clamp index
    if (nodes.length === 0) {
      setCurrentIndex(0);
    } else {
      setCurrentIndex((prev) => Math.min(prev, nodes.length - 1));
    }
  }, [editor]);

  // Refresh on editor transaction
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      // Debounce to avoid excessive re-derives
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(refresh, 50);
    };

    editor.on('transaction', handleUpdate);
    // Initial refresh
    refresh();

    // Auto-scroll to first pending change on editor mount (e.g. after doc switch)
    const scrollTimer = setTimeout(() => {
      if (editor.isDestroyed) return;
      const nodes = derivePendingState(editor);
      if (nodes.length > 0) {
        scrollToNode(editor, nodes[0].nodeId);
      }
    }, 150);

    return () => {
      editor.off('transaction', handleUpdate);
      clearTimeout(refreshTimerRef.current);
      clearTimeout(scrollTimer);
    };
  }, [editor, refresh]);

  const counts = countPending(pendingNodes);
  const currentNode = pendingNodes[currentIndex] ?? null;

  const goToNext = useCallback(() => {
    if (pendingNodes.length === 0) return;
    const next = (currentIndex + 1) % pendingNodes.length;
    setCurrentIndex(next);
    if (editor && pendingNodes[next]) {
      scrollToNode(editor, pendingNodes[next].nodeId);
    }
  }, [editor, pendingNodes, currentIndex]);

  const goToPrevious = useCallback(() => {
    if (pendingNodes.length === 0) return;
    const prev = (currentIndex - 1 + pendingNodes.length) % pendingNodes.length;
    setCurrentIndex(prev);
    if (editor && pendingNodes[prev]) {
      scrollToNode(editor, pendingNodes[prev].nodeId);
    }
  }, [editor, pendingNodes, currentIndex]);

  const scrollAfterResolve = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const nodes = derivePendingState(editor);
    if (nodes.length === 0) return;
    const idx = Math.min(currentIndex, nodes.length - 1);
    scrollToNode(editor, nodes[idx].nodeId);
  }, [editor, currentIndex]);

  const acceptCurrent = useCallback(() => {
    if (!editor || !currentNode) return;
    acceptChange(editor, currentNode.nodeId);
    refresh();
    scrollAfterResolve();
  }, [editor, currentNode, refresh, scrollAfterResolve]);

  const rejectCurrent = useCallback(() => {
    if (!editor || !currentNode) return;
    rejectChange(editor, currentNode.nodeId);
    refresh();
    scrollAfterResolve();
  }, [editor, currentNode, refresh, scrollAfterResolve]);

  const handleAcceptAll = useCallback(() => {
    if (!editor) return;
    acceptAllChanges(editor);
    refresh();
  }, [editor, refresh]);

  const handleRejectAll = useCallback(() => {
    if (!editor) return;
    rejectAllChanges(editor);
    refresh();
  }, [editor, refresh]);

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
