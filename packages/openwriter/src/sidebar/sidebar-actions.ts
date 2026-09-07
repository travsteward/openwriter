import { useCallback } from 'react';
import type { DocumentInfo, SidebarActions } from './sidebar-types';
import { checkedFetch, jsonRequest } from '../utils/request';
import { showToast } from '../utils/toast';

// Mutations commit at the server before refreshing the affected projection.
// Keeping the last acknowledged view removes rollback races and phantom deletes.
// adr: adr/sidebar-action-contract.md
export function useSidebarActions(
  fetchDocs: () => Promise<void>,
  fetchWorkspaces: () => Promise<void>,
  docs: DocumentInfo[],
): SidebarActions {
  const run = useCallback(async (
    label: string,
    operation: () => Promise<unknown>,
    scope: 'docs' | 'workspaces' | 'both' = 'both',
  ): Promise<boolean> => {
    try {
      await operation();
    } catch (error) {
      showToast(`${label}: ${error instanceof Error ? error.message : 'Please try again.'}`, 'error');
      return false;
    }
    const reads = await Promise.allSettled([
      scope !== 'workspaces' ? fetchDocs() : undefined,
      scope !== 'docs' ? fetchWorkspaces() : undefined,
    ]);
    if (reads.some(r => r.status === 'rejected')) showToast('Change saved, but the sidebar could not refresh. Please reload.', 'error');
    return true;
  }, [fetchDocs, fetchWorkspaces]);

  const docUrl = (file: string) => `/api/documents/${encodeURIComponent(file)}`;
  const workspaceUrl = (file: string) => `/api/workspaces/${encodeURIComponent(file)}`;

  return {
    fetchDocs,
    handleDelete: file => run('Could not delete document', () => checkedFetch(docUrl(file), { method: 'DELETE' })),
    handleArchive: file => run('Could not archive document', () => checkedFetch(`${docUrl(file)}/archive`, { method: 'POST' })),
    handleUnarchive: file => run('Could not restore document', async () => {
      const result = await (await checkedFetch(`${docUrl(file)}/unarchive`, { method: 'POST' })).json();
      if (result.locationWarning) showToast(result.locationWarning);
    }),
    handleRename: (file, original, title) => {
      if (!title.trim() || title.trim() === original) return;
      return run('Could not rename document', () => checkedFetch(docUrl(file), jsonRequest('PUT', { title: title.trim() })));
    },
    handleCreateWorkspace: () => run('Could not create workspace', () => checkedFetch('/api/workspaces', jsonRequest('POST', { title: 'Untitled Workspace' })), 'workspaces'),
    handleDeleteWorkspace: file => run('Could not delete workspace', () => checkedFetch(workspaceUrl(file), { method: 'DELETE' })),
    handleRenameWorkspace: (file, title) => {
      if (!title.trim()) return;
      return run('Could not rename workspace', () => checkedFetch(workspaceUrl(file), jsonRequest('PUT', { title: title.trim() })), 'workspaces');
    },
    handleCreateInWorkspace: (file, containerId, metadata) => run('Could not create document in folder', async () => {
      const result = await (await checkedFetch('/api/documents', jsonRequest('POST', metadata ? { metadata } : {}))).json();
      await checkedFetch(`${workspaceUrl(file)}/docs`, jsonRequest('POST', { file: result.filename, title: result.title || 'Untitled', containerId }));
    }),
    handleRemoveFromWorkspace: (file, doc) => run('Could not remove document from workspace', () => checkedFetch(`${workspaceUrl(file)}/docs/${encodeURIComponent(doc)}`, { method: 'DELETE' })),
    handleCreateContainer: (file, parentContainerId) => run('Could not create folder', () => checkedFetch(`${workspaceUrl(file)}/containers`, jsonRequest('POST', { name: 'Untitled', parentContainerId })), 'workspaces'),
    handleDeleteContainer: (file, id, cascade = false) => run('Could not delete folder', () => checkedFetch(`${workspaceUrl(file)}/containers/${encodeURIComponent(id)}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' })),
    handleRenameContainer: (file, id, name) => {
      if (!name.trim()) return;
      return run('Could not rename folder', () => checkedFetch(`${workspaceUrl(file)}/containers/${encodeURIComponent(id)}`, jsonRequest('PUT', { name: name.trim() })), 'workspaces');
    },
    getDocTags: file => docs.find(d => d.filename === file)?.tags ?? [],
    handleAddTag: (file, tag) => {
      if (!tag.trim()) return;
      return run('Could not add tag', () => checkedFetch(`/api/doc-tags/${encodeURIComponent(file)}`, jsonRequest('POST', { tag: tag.trim() })), 'docs');
    },
    handleRemoveTag: (file, tag) => run('Could not remove tag', () => checkedFetch(`/api/doc-tags/${encodeURIComponent(file)}/${encodeURIComponent(tag)}`, { method: 'DELETE' }), 'docs'),
  };
}
