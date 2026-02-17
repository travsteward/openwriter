/**
 * Express routes for GitHub sync.
 * Mounted in index.ts — follows version-routes.ts pattern.
 */

import { Router } from 'express';
import {
  getSyncStatus,
  getCapabilities,
  getPendingFiles,
  setupWithGh,
  setupWithPat,
  connectExisting,
  pushSync,
  type SyncStatus,
} from './git-sync.js';

export function createSyncRouter(broadcastSyncStatus: (status: SyncStatus) => void): Router {
  const router = Router();

  router.get('/api/sync/status', async (_req, res) => {
    try {
      res.json(await getSyncStatus());
    } catch (err: any) {
      res.status(500).json({ state: 'error', error: err.message });
    }
  });

  router.get('/api/sync/capabilities', async (_req, res) => {
    try {
      res.json(await getCapabilities());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/sync/pending', async (_req, res) => {
    try {
      res.json(await getPendingFiles());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/sync/setup', async (req, res) => {
    try {
      const { method, repoName, remoteUrl, pat, isPrivate } = req.body;

      if (method === 'gh') {
        await setupWithGh(repoName || 'openwriter-docs', isPrivate !== false);
      } else if (method === 'pat') {
        if (!pat) { res.status(400).json({ error: 'PAT is required' }); return; }
        await setupWithPat(pat, repoName || 'openwriter-docs', isPrivate !== false);
      } else if (method === 'connect') {
        if (!remoteUrl) { res.status(400).json({ error: 'Remote URL is required' }); return; }
        await connectExisting(remoteUrl, pat);
      } else {
        res.status(400).json({ error: 'Invalid method. Use: gh, pat, or connect' });
        return;
      }

      const status = await getSyncStatus();
      broadcastSyncStatus(status);
      res.json({ success: true, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/sync/push', async (_req, res) => {
    try {
      const result = await pushSync(broadcastSyncStatus);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ state: 'error', error: err.message });
    }
  });

  return router;
}
