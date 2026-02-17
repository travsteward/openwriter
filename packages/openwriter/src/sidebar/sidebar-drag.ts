import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentInfo, WorkspaceWithData, WorkspaceNode, ContainerItem, DraggedItem, DropIndicator } from './sidebar-types';
import { nodeId } from './sidebar-utils';

interface UseSidebarDragOptions {
  docs: DocumentInfo[];
  workspaces: WorkspaceWithData[];
  assignedFiles: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement>;
  setCollapsedSections: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useSidebarDrag({ docs, workspaces, assignedFiles, scrollRef, setCollapsedSections }: UseSidebarDragOptions) {
  const [draggedItem, setDraggedItem] = useState<DraggedItem>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const dragExpandTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeScrollRaf = useRef<number | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const pendingDrag = useRef<DraggedItem>(null);
  const DRAG_THRESHOLD = 5;

  const computeAfterId = (siblings: WorkspaceNode[], itemIndex: number, position: 'before' | 'after'): string | null => {
    if (position === 'before') return itemIndex > 0 ? nodeId(siblings[itemIndex - 1]) : null;
    return nodeId(siblings[itemIndex]);
  };

  const findNodeContext = useCallback((targetId: string, wsFilename: string | null): {
    siblings: WorkspaceNode[]; index: number; containerId: string | null;
  } | null => {
    if (wsFilename === null) {
      const siblings: WorkspaceNode[] = docs.filter(d => !assignedFiles.has(d.filename))
        .map(d => ({ type: 'doc' as const, file: d.filename, title: d.title }));
      const index = siblings.findIndex(n => nodeId(n) === targetId);
      if (index >= 0) return { siblings, index, containerId: null };
      return null;
    }
    const ws = workspaces.find(w => w.filename === wsFilename);
    if (!ws?.workspace) return null;
    const search = (nodes: WorkspaceNode[], parentContainerId: string | null): { siblings: WorkspaceNode[]; index: number; containerId: string | null } | null => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodeId(nodes[i]) === targetId) return { siblings: nodes, index: i, containerId: parentContainerId };
        if (nodes[i].type === 'container') {
          const result = search((nodes[i] as ContainerItem).items, (nodes[i] as ContainerItem).id);
          if (result) return result;
        }
      }
      return null;
    };
    return search(ws.workspace.root, null);
  }, [docs, assignedFiles, workspaces]);

  const endDrag = useCallback(() => {
    setDraggedItem(null);
    setDropIndicator(null);
    pendingDrag.current = null;
    dragStartPos.current = null;
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    if (dragExpandTimeout.current) { clearTimeout(dragExpandTimeout.current); dragExpandTimeout.current = null; }
    if (edgeScrollRaf.current) { cancelAnimationFrame(edgeScrollRaf.current); edgeScrollRaf.current = null; }
    document.body.style.userSelect = '';
  }, []);

  const executeDrop = useCallback((dragged: DraggedItem, indicator: DropIndicator | null) => {
    if (!dragged || !indicator) return;

    if (dragged.type === 'workspace') {
      const targetFilename = indicator.itemId;
      if (targetFilename === dragged.filename) return;
      const filenames = workspaces.map(w => w.filename);
      const fromIdx = filenames.indexOf(dragged.filename);
      if (fromIdx < 0) return;
      filenames.splice(fromIdx, 1);
      let toIdx = filenames.indexOf(targetFilename);
      if (toIdx < 0) return;
      if (indicator.position === 'after') toIdx += 1;
      filenames.splice(toIdx, 0, dragged.filename);
      fetch('/api/workspaces/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: filenames }),
      }).catch(() => {});
      return;
    }

    const { wsFilename: targetWs, containerId: targetContainerId, afterId } = indicator;
    const dragId = dragged.type === 'doc' ? dragged.file : dragged.id;
    const sourceWs = dragged.sourceWs;
    if (indicator.itemId === dragId) return;

    if (dragged.type === 'container') {
      if (sourceWs !== targetWs || !targetWs) return;
      fetch(`/api/workspaces/${encodeURIComponent(targetWs)}/docs/${encodeURIComponent(dragId)}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetContainerId: targetContainerId ?? null, afterFile: afterId }),
      }).catch(() => {});
      return;
    }

    const file = dragged.file;
    if (sourceWs === null && targetWs === null) return;

    if (sourceWs === null && targetWs !== null) {
      fetch(`/api/workspaces/${encodeURIComponent(targetWs)}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, title: file.replace(/\.md$/, ''), containerId: targetContainerId ?? null, afterFile: afterId }),
      }).catch(() => {});
      return;
    }

    if (sourceWs !== null && targetWs === null) {
      fetch(`/api/workspaces/${encodeURIComponent(sourceWs)}/docs/${encodeURIComponent(file)}`, { method: 'DELETE' }).catch(() => {});
      return;
    }

    if (sourceWs === targetWs && targetWs !== null) {
      fetch(`/api/workspaces/${encodeURIComponent(targetWs)}/docs/${encodeURIComponent(file)}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetContainerId: targetContainerId ?? null, afterFile: afterId }),
      }).catch(() => {});
      return;
    }

    if (sourceWs !== null && targetWs !== null) {
      fetch(`/api/workspaces/${encodeURIComponent(targetWs)}/docs/${encodeURIComponent(file)}/cross-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceWorkspace: sourceWs, containerId: targetContainerId ?? null, afterFile: afterId, title: file.replace(/\.md$/, '') }),
      }).catch(() => {});
    }
  }, [workspaces]);

  const resolveDropTarget = useCallback((x: number, y: number): DropIndicator | null => {
    const ghost = ghostRef.current;
    if (ghost) ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (ghost) ghost.style.display = '';
    if (!el) return null;

    if (draggedItem?.type === 'workspace') {
      const wsHeader = el.closest('[data-ws-drag]') as HTMLElement | null;
      if (wsHeader) {
        const targetWsFilename = wsHeader.dataset.wsDrag!;
        const rect = wsHeader.getBoundingClientRect();
        const ratio = (y - rect.top) / rect.height;
        return { itemId: targetWsFilename, position: ratio < 0.5 ? 'before' : 'after', wsFilename: null, containerId: null, afterId: null };
      }
      return null;
    }

    const item = el.closest('[data-drag-id]') as HTMLElement | null;
    if (!item) {
      const section = el.closest('[data-drop-ws]') as HTMLElement | null;
      if (section) {
        return {
          itemId: '__section__', position: 'inside',
          wsFilename: section.dataset.dropWs === '__docs__' ? null : section.dataset.dropWs!,
          containerId: section.dataset.dropContainer || null, afterId: null,
        };
      }
      return null;
    }

    const targetId = item.dataset.dragId!;
    const targetType = item.dataset.dragType as 'doc' | 'container-header';
    const wsFilename = item.dataset.dragWs === '__docs__' ? null : item.dataset.dragWs!;
    const rect = item.getBoundingClientRect();
    const ratio = (y - rect.top) / rect.height;

    if (targetType === 'container-header') {
      const containerId = targetId;
      const parentContainerId = item.dataset.dragParent || null;
      const ctx = findNodeContext(containerId, wsFilename);
      if (!ctx) return null;
      if (ratio < 0.25) return { itemId: containerId, position: 'before', wsFilename, containerId: parentContainerId, afterId: computeAfterId(ctx.siblings, ctx.index, 'before') };
      if (ratio > 0.75) return { itemId: containerId, position: 'after', wsFilename, containerId: parentContainerId, afterId: computeAfterId(ctx.siblings, ctx.index, 'after') };
      return { itemId: containerId, position: 'inside', wsFilename, containerId: containerId, afterId: null };
    }

    const parentContainerId = item.dataset.dragContainer || null;
    const ctx = findNodeContext(targetId, wsFilename);
    if (!ctx) return null;
    const position = ratio < 0.5 ? 'before' : 'after';
    return { itemId: targetId, position, wsFilename, containerId: parentContainerId, afterId: computeAfterId(ctx.siblings, ctx.index, position) };
  }, [findNodeContext, draggedItem]);

  const updateEdgeScroll = useCallback((clientY: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const EDGE = 80, MAX_SPEED = 18;
    let speed = 0;
    if (clientY < rect.top + EDGE) speed = -MAX_SPEED * Math.max(0, 1 - (clientY - rect.top) / EDGE);
    else if (clientY > rect.bottom - EDGE) speed = MAX_SPEED * Math.max(0, 1 - (rect.bottom - clientY) / EDGE);
    if (edgeScrollRaf.current) { cancelAnimationFrame(edgeScrollRaf.current); edgeScrollRaf.current = null; }
    if (speed !== 0) {
      const tick = () => { el.scrollTop += speed; edgeScrollRaf.current = requestAnimationFrame(tick); };
      edgeScrollRaf.current = requestAnimationFrame(tick);
    }
  }, [scrollRef]);

  const updateDragExpand = useCallback((x: number, y: number) => {
    const ghost = ghostRef.current;
    if (ghost) ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (ghost) ghost.style.display = '';
    const header = el?.closest('[data-section-key]') as HTMLElement | null;
    if (!header) {
      if (dragExpandTimeout.current) { clearTimeout(dragExpandTimeout.current); dragExpandTimeout.current = null; }
      return;
    }
    const key = header.dataset.sectionKey!;
    if (dragExpandTimeout.current) clearTimeout(dragExpandTimeout.current);
    dragExpandTimeout.current = setTimeout(() => {
      setCollapsedSections(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 500);
  }, [setCollapsedSections]);

  useEffect(() => {
    if (!draggedItem) return;
    const onPointerMove = (e: PointerEvent) => {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${e.clientX + 12}px`;
        ghostRef.current.style.top = `${e.clientY - 8}px`;
      }
      setDropIndicator(resolveDropTarget(e.clientX, e.clientY));
      updateEdgeScroll(e.clientY);
      updateDragExpand(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      executeDrop(draggedItem, resolveDropTarget(e.clientX, e.clientY));
      endDrag();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [draggedItem, resolveDropTarget, executeDrop, endDrag, updateEdgeScroll, updateDragExpand]);

  const handlePointerDown = useCallback((e: React.PointerEvent, item: DraggedItem, label: string) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, button, .sidebar-tag-remove, .sidebar-tag-add, .sidebar-container-actions, .sidebar-delete-btn, .sidebar-confirm-delete, .sidebar-inline-confirm')) return;

    dragStartPos.current = { x: e.clientX, y: e.clientY };
    pendingDrag.current = item;

    const onMove = (me: PointerEvent) => {
      if (!dragStartPos.current || !pendingDrag.current) return;
      const dx = me.clientX - dragStartPos.current.x;
      const dy = me.clientY - dragStartPos.current.y;
      if (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD) {
        document.body.style.userSelect = 'none';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDraggedItem(pendingDrag.current);
        pendingDrag.current = null;
        const ghost = document.createElement('div');
        ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;padding:4px 10px;background:var(--bg-surface, white);border:1px solid var(--border, #cbd5e1);border-radius:6px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.12);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-dark, #334155);';
        ghost.textContent = label;
        document.body.appendChild(ghost);
        ghostRef.current = ghost;
        ghost.style.left = `${me.clientX + 12}px`;
        ghost.style.top = `${me.clientY - 8}px`;
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragStartPos.current = null;
      pendingDrag.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const dropClass = (itemId: string): string => {
    if (!dropIndicator || dropIndicator.itemId !== itemId) return '';
    if (dropIndicator.position === 'before') return 'drop-before';
    if (dropIndicator.position === 'after') return 'drop-after';
    if (dropIndicator.position === 'inside') return 'drop-inside';
    return '';
  };

  const isDragging = (id: string): boolean => {
    if (!draggedItem) return false;
    if (draggedItem.type === 'doc') return draggedItem.file === id;
    if (draggedItem.type === 'workspace') return draggedItem.filename === id;
    return draggedItem.id === id;
  };

  const isContainerDropTarget = (containerId: string): boolean => {
    if (!dropIndicator || !draggedItem) return false;
    return dropIndicator.containerId === containerId;
  };

  return {
    draggedItem, dropIndicator, handlePointerDown,
    dropClass, isDragging, isContainerDropTarget,
  };
}
