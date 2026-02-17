import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentInfo, WorkspaceWithData, WorkspaceInfo, WorkspaceFull } from './sidebar-types';
import { collectFiles } from './sidebar-utils';

export function useSidebarData(refreshKey: number, workspacesRefreshKey: number) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithData[]>([]);
  const [assignedFiles, setAssignedFiles] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchDocs = useCallback(() => {
    fetch('/api/documents')
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setDocs(data); })
      .catch(() => {});
  }, []);

  const fetchWorkspaces = useCallback(() => {
    fetch('/api/workspaces')
      .then((res) => res.json())
      .then(async (wsList: WorkspaceInfo[]) => {
        if (!Array.isArray(wsList)) return;
        const detailed = await Promise.all(wsList.map(async (w) => {
          try {
            const res = await fetch(`/api/workspaces/${encodeURIComponent(w.filename)}`);
            const workspace: WorkspaceFull = await res.json();
            return { ...w, workspace } as WorkspaceWithData;
          } catch { return w as WorkspaceWithData; }
        }));
        setWorkspaces(detailed);
        const assigned = new Set<string>();
        for (const w of detailed) {
          if (w.workspace) collectFiles(w.workspace.root, assigned);
        }
        setAssignedFiles(assigned);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs, refreshKey]);
  useEffect(() => { fetchWorkspaces(); }, [fetchWorkspaces, workspacesRefreshKey, refreshKey]);

  // Scroll active doc into view after docs list re-renders
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const activeItem = scrollRef.current?.querySelector('.sidebar-item.active');
      activeItem?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(raf);
  }, [docs]);

  return { docs, workspaces, assignedFiles, fetchDocs, scrollRef };
}
