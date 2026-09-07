import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentInfo, WorkspaceWithData, WorkspaceInfo, WorkspaceFull } from './sidebar-types';
import { collectFiles } from './sidebar-utils';
import { checkedFetch } from '../utils/request';

export function useSidebarData(refreshKey: number, workspacesRefreshKey: number) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithData[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docsRequest = useRef(0);
  const workspacesRequest = useRef(0);

  const assignedFiles = useMemo(() => {
    const assigned = new Set<string>();
    for (const w of workspaces) if (w.workspace) collectFiles(w.workspace.root, assigned);
    return assigned;
  }, [workspaces]);

  // Only the newest read can replace the last acknowledged projection.
  // adr: adr/sidebar-action-contract.md
  const fetchDocs = useCallback(async () => {
    const request = ++docsRequest.current;
    const data = await (await checkedFetch('/api/documents')).json();
    if (request === docsRequest.current && Array.isArray(data)) setDocs(data);
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    const request = ++workspacesRequest.current;
    const list: WorkspaceInfo[] = await (await checkedFetch('/api/workspaces')).json();
    if (!Array.isArray(list)) return;
    const detailed = await Promise.all(list.map(async w => {
      const workspace: WorkspaceFull = await (await checkedFetch(`/api/workspaces/${encodeURIComponent(w.filename)}`)).json();
      return { ...w, workspace };
    }));
    if (request === workspacesRequest.current) setWorkspaces(detailed);
  }, []);

  useEffect(() => { void fetchDocs().catch(() => {}); }, [fetchDocs, refreshKey]);
  useEffect(() => { void fetchWorkspaces().catch(() => {}); }, [fetchWorkspaces, workspacesRefreshKey]);
  return { docs, setDocs, workspaces, assignedFiles, fetchDocs, fetchWorkspaces, scrollRef };
}
