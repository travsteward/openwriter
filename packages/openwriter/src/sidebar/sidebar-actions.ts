import { useCallback } from 'react';
import type { SidebarActions, WorkspaceWithData } from './sidebar-types';

export function useSidebarActions(
  workspaces: WorkspaceWithData[],
  fetchDocs: () => void,
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

  const getDocTags = useCallback((wsFilename: string, docFile: string): string[] => {
    const ws = workspaces.find(w => w.filename === wsFilename);
    if (!ws?.workspace?.tags) return [];
    const tags: string[] = [];
    for (const [tag, files] of Object.entries(ws.workspace.tags)) {
      if (files.includes(docFile)) tags.push(tag);
    }
    return tags;
  }, [workspaces]);

  const handleAddTag = useCallback((wsFilename: string, docFile: string, tag: string) => {
    if (!tag.trim()) return;
    fetch(`/api/workspaces/${encodeURIComponent(wsFilename)}/tags/${encodeURIComponent(docFile)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: tag.trim() }),
    }).catch(() => {});
  }, []);

  const handleRemoveTag = useCallback((wsFilename: string, docFile: string, tag: string) => {
    fetch(`/api/workspaces/${encodeURIComponent(wsFilename)}/tags/${encodeURIComponent(docFile)}/${encodeURIComponent(tag)}`, {
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
