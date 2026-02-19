import { useCallback, useRef, useEffect, useState } from 'react';
import type { SidebarActions, WorkspaceWithData } from './sidebar-types';

export function useSidebarActions(
  workspaces: WorkspaceWithData[],
  fetchDocs: () => void,
  docTagsRefreshKey?: number,
): SidebarActions {
  const handleDelete = useCallback((filename: string) => {
    fetch(`/api/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const handleRename = useCallback((filename: string, originalTitle: string, newTitle: string) => {
    if (!newTitle.trim() || newTitle.trim() === originalTitle) return;
    fetch(`/api/documents/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() }),
    })
      .then(() => fetchDocs())
      .catch(() => {});
  }, [fetchDocs]);

  const handleCreateWorkspace = useCallback(() => {
    fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled Workspace' }),
    }).catch(() => {});
  }, []);

  const handleDeleteWorkspace = useCallback((wsFilename: string) => {
    fetch(`/api/workspaces/${encodeURIComponent(wsFilename)}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const handleCreateInWorkspace = useCallback((wsFilename: string, containerId: string | null) => {
    fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((result) => {
        if (result.filename) {
          return fetch(`/api/workspaces/${encodeURIComponent(wsFilename)}/docs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: result.filename, title: result.title || 'Untitled', containerId }),
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleRemoveFromWorkspace = useCallback((wsFilename: string, docFilename: string) => {
    fetch(`/api/workspaces/${encodeURIComponent(wsFilename)}/docs/${encodeURIComponent(docFilename)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }, []);

  const handleCreateContainer = useCallback((wsFilename: string, parentContainerId: string | null) => {
    fetch(`/api/workspaces/${encodeURIComponent(wsFilename)}/containers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Untitled', parentContainerId }),
    }).catch(() => {});
  }, []);

  const handleDeleteContainer = useCallback((wsFilename: string, containerId: string) => {
    fetch(`/api/workspaces/${encodeURIComponent(wsFilename)}/containers/${encodeURIComponent(containerId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }, []);

  const handleRenameContainer = useCallback((wsFilename: string, containerId: string, newName: string) => {
    if (!newName.trim()) return;
    fetch(`/api/workspaces/${encodeURIComponent(wsFilename)}/containers/${encodeURIComponent(containerId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    }).catch(() => {});
  }, []);

  // Doc-level tags: cached in memory, refreshed on docTagsRefreshKey change
  const [docTagsCache, setDocTagsCache] = useState<Record<string, string[]>>({});
  const fetchedTagsKey = useRef(-1);

  useEffect(() => {
    if (docTagsRefreshKey === fetchedTagsKey.current) return;
    fetchedTagsKey.current = docTagsRefreshKey ?? 0;
    // Fetch tags for all known docs
    fetch('/api/documents')
      .then(r => r.json())
      .then((docs: { filename: string }[]) => {
        const cache: Record<string, string[]> = {};
        return Promise.all(
          docs.map(d =>
            fetch(`/api/doc-tags/${encodeURIComponent(d.filename)}`)
              .then(r => r.json())
              .then(data => { if (data.tags?.length) cache[d.filename] = data.tags; })
              .catch(() => {})
          )
        ).then(() => setDocTagsCache(cache));
      })
      .catch(() => {});
  }, [docTagsRefreshKey]);

  const getDocTags = useCallback((docFile: string): string[] => {
    return docTagsCache[docFile] || [];
  }, [docTagsCache]);

  const handleAddTag = useCallback((docFile: string, tag: string) => {
    if (!tag.trim()) return;
    // Optimistic update
    setDocTagsCache(prev => {
      const existing = prev[docFile] || [];
      if (existing.includes(tag.trim())) return prev;
      return { ...prev, [docFile]: [...existing, tag.trim()] };
    });
    fetch(`/api/doc-tags/${encodeURIComponent(docFile)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: tag.trim() }),
    }).catch(() => {});
  }, []);

  const handleRemoveTag = useCallback((docFile: string, tag: string) => {
    // Optimistic update
    setDocTagsCache(prev => {
      const existing = prev[docFile] || [];
      const filtered = existing.filter(t => t !== tag);
      if (filtered.length === 0) { const next = { ...prev }; delete next[docFile]; return next; }
      return { ...prev, [docFile]: filtered };
    });
    fetch(`/api/doc-tags/${encodeURIComponent(docFile)}/${encodeURIComponent(tag)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }, []);

  return {
    fetchDocs,
    handleDelete,
    handleRename,
    handleCreateWorkspace,
    handleDeleteWorkspace,
    handleCreateInWorkspace,
    handleRemoveFromWorkspace,
    handleCreateContainer,
    handleDeleteContainer,
    handleRenameContainer,
    getDocTags,
    handleAddTag,
    handleRemoveTag,
  };
}
