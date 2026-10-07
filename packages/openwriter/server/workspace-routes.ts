/**
 * Express routes for workspace CRUD, doc/container/tag operations.
 * Mounted in index.ts to keep the main file lean.
 */

import { Router } from 'express';
import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  deleteWorkspace,
  reorderWorkspaces,
  addDoc,
  removeDoc,
  moveDoc,
  reorderDoc,
  addContainerToWorkspace,
  removeContainer,
  renameContainer,
  renameWorkspace,
  reorderContainer,
  crossMoveContainer,
  promoteContainerToWorkspace,
} from './workspaces.js';
import { findNode } from './workspace-tree.js';
import type { WorkspaceNode, ContainerItem } from './workspace-types.js';
import { deleteDocument } from './documents.js';

function collectDocFilesInSubtree(nodes: WorkspaceNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'doc') out.push(n.file);
    else if (n.type === 'container') collectDocFilesInSubtree((n as ContainerItem).items, out);
  }
  return out;
}

interface BroadcastFn {
  broadcastWorkspacesChanged: () => void;
}

export function createWorkspaceRouter(b: BroadcastFn): Router {
  const router = Router();

  router.get('/api/workspaces', (req, res) => {
    const list = listWorkspaces();
    // ?full=1 inlines each workspace's tree, so a client needs one request
    // instead of one per workspace.
    if (req.query.full !== '1') return res.json(list);
    res.json(list.map((w) => {
      try { return { ...w, workspace: getWorkspace(w.filename) }; } catch { return w; }
    }));
  });

  router.post('/api/workspaces', (req, res) => {
    try {
      const result = createWorkspace({
        title: req.body.title,
        voiceProfileId: req.body.voiceProfileId,
      });
      b.broadcastWorkspacesChanged();
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Static paths before parameterized — otherwise :filename captures "reorder"
  router.put('/api/workspaces/reorder', (req, res) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
      reorderWorkspaces(order);
      b.broadcastWorkspacesChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Promote container to standalone workspace
  router.post('/api/workspaces/promote-container', (req, res) => {
    try {
      const { sourceWorkspace, containerId, afterWorkspaceFilename } = req.body;
      if (!sourceWorkspace || !containerId) return res.status(400).json({ error: 'sourceWorkspace and containerId required' });
      const result = promoteContainerToWorkspace(sourceWorkspace, containerId, afterWorkspaceFilename ?? null);
      b.broadcastWorkspacesChanged();
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/api/workspaces/:filename', (req, res) => {
    try {
      res.json(getWorkspace(req.params.filename));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.put('/api/workspaces/:filename', (req, res) => {
    try {
      const ws = renameWorkspace(req.params.filename, req.body.title);
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/api/workspaces/:filename', async (req, res) => {
    try {
      await deleteWorkspace(req.params.filename);
      b.broadcastWorkspacesChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Doc operations
  router.post('/api/workspaces/:filename/docs', (req, res) => {
    try {
      const ws = addDoc(req.params.filename, req.body.containerId ?? null, req.body.file, req.body.title || req.body.file, req.body.afterFile ?? null);
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/api/workspaces/:filename/docs/:docFile', (req, res) => {
    try {
      const ws = removeDoc(req.params.filename, req.params.docFile);
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/api/workspaces/:filename/docs/:docFile/move', (req, res) => {
    try {
      const ws = moveDoc(req.params.filename, req.params.docFile, req.body.targetContainerId ?? null, req.body.afterFile ?? null);
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/api/workspaces/:filename/docs/:docFile/reorder', (req, res) => {
    try {
      const ws = reorderDoc(req.params.filename, req.params.docFile, req.body.afterFile ?? null);
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Container operations
  router.post('/api/workspaces/:filename/containers', (req, res) => {
    try {
      const result = addContainerToWorkspace(req.params.filename, req.body.parentContainerId ?? null, req.body.name);
      b.broadcastWorkspacesChanged();
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/api/workspaces/:filename/containers/:containerId', async (req, res) => {
    try {
      const cascade = req.query.cascade === 'true' || req.query.cascade === '1';
      let deletedDocs = 0;
      if (cascade) {
        // Find the container, collect all docs in its subtree, delete them from disk.
        const current = getWorkspace(req.params.filename);
        const found = findNode(current.root, (n) => n.type === 'container' && n.id === req.params.containerId);
        if (found && found.node.type === 'container') {
          const files = collectDocFilesInSubtree((found.node as ContainerItem).items);
          for (const file of files) {
            try {
              await deleteDocument(file);
              deletedDocs++;
            } catch { /* swallow per-doc failures; keep going */ }
          }
        }
      }
      const ws = removeContainer(req.params.filename, req.params.containerId);
      b.broadcastWorkspacesChanged();
      res.json({ ...ws, deletedDocs });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/api/workspaces/:filename/containers/:containerId', (req, res) => {
    try {
      let ws;
      if (req.body.name !== undefined) {
        ws = renameContainer(req.params.filename, req.params.containerId, req.body.name);
      }
      b.broadcastWorkspacesChanged();
      res.json(ws || getWorkspace(req.params.filename));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/api/workspaces/:filename/containers/:containerId/reorder', (req, res) => {
    try {
      const ws = reorderContainer(req.params.filename, req.params.containerId, req.body.afterIdentifier ?? null);
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Cross-workspace container move
  router.post('/api/workspaces/:targetFilename/containers/:containerId/cross-move', (req, res) => {
    try {
      const { sourceWorkspace } = req.body;
      if (!sourceWorkspace) return res.status(400).json({ error: 'sourceWorkspace required' });
      const ws = crossMoveContainer(
        sourceWorkspace, req.params.targetFilename, req.params.containerId,
        req.body.targetContainerId ?? null, req.body.afterIdentifier ?? null,
      );
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Cross-workspace move (from one workspace to another)
  router.post('/api/workspaces/:targetFilename/docs/:docFile/cross-move', (req, res) => {
    try {
      const { sourceWorkspace } = req.body;
      removeDoc(sourceWorkspace, req.params.docFile);
      const ws = addDoc(req.params.targetFilename, req.body.containerId ?? null, req.params.docFile, req.body.title || req.params.docFile, req.body.afterFile ?? null);
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
