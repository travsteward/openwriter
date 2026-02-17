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
  reorderContainer,
  tagDoc,
  untagDoc,
} from './workspaces.js';

interface BroadcastFn {
  broadcastWorkspacesChanged: () => void;
}

export function createWorkspaceRouter(b: BroadcastFn): Router {
  const router = Router();

  router.get('/api/workspaces', (_req, res) => {
    res.json(listWorkspaces());
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

  router.get('/api/workspaces/:filename', (req, res) => {
    try {
      res.json(getWorkspace(req.params.filename));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.delete('/api/workspaces/:filename', (req, res) => {
    try {
      deleteWorkspace(req.params.filename);
      b.broadcastWorkspacesChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

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

  router.delete('/api/workspaces/:filename/containers/:containerId', (req, res) => {
    try {
      const ws = removeContainer(req.params.filename, req.params.containerId);
      b.broadcastWorkspacesChanged();
      res.json(ws);
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

  // Tag operations
  router.post('/api/workspaces/:filename/tags/:docFile', (req, res) => {
    try {
      const ws = tagDoc(req.params.filename, req.params.docFile, req.body.tag);
      b.broadcastWorkspacesChanged();
      res.json(ws);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/api/workspaces/:filename/tags/:docFile/:tag', (req, res) => {
    try {
      const ws = untagDoc(req.params.filename, req.params.docFile, req.params.tag);
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
