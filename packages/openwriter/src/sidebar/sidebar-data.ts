import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentInfo, WorkspaceWithData } from './sidebar-types';
import { collectFiles } from './sidebar-utils';
import { checkedFetch } from '../utils/request';

/** Every workspace with its tree, in one request. */
export async function loadWorkspaces(): Promise<WorkspaceWithData[] | null> {
  const list: WorkspaceWithData[] = await (await checkedFetch('/api/workspaces?full=1')).json();
  return Array.isArray(list) ? list : null;
}

export function useSidebarData(refreshKey: number, workspacesRefreshKey: number) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  // False until the first list arrives, so "loading" never reads as "no documents".
  const [docsLoaded, setDocsLoaded] = useState(false);
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
    if (request === docsRequest.current && Array.isArray(data)) {
      setDocs(data);
      setDocsLoaded(true);
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    const request = ++workspacesRequest.current;
    const list = await loadWorkspaces();
    if (list && request === workspacesRequest.current) setWorkspaces(list);
  }, []);

  useEffect(() => { void fetchDocs().catch(() => {}); }, [fetchDocs, refreshKey]);
  useEffect(() => { void fetchWorkspaces().catch(() => {}); }, [fetchWorkspaces, workspacesRefreshKey]);
  return { docs, docsLoaded, setDocs, workspaces, assignedFiles, fetchDocs, fetchWorkspaces, scrollRef };
}
