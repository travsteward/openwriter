/**
 * Express routes for document version history.
 * Mounted in index.ts to keep the main file lean.
 */

import { Router } from 'express';
import { forceSnapshot, listVersions, getVersionContent, restoreVersion } from './versions.js';
import { markAllNodesAsPending } from './state.js';
import type { PadDocument } from './state.js';

interface StateGetters {
  getDocId: () => string;
  getFilePath: () => string;
  updateDocument: (doc: PadDocument) => void;
  save: () => void;
  broadcastDocumentSwitched: (document: any, title: string, filename: string) => void;
}

export function createVersionRouter(s: StateGetters): Router {
  const router = Router();

  // List versions for current doc
  router.get('/api/versions', (_req, res) => {
    const docId = s.getDocId();
    if (!docId) { res.json([]); return; }
    res.json(listVersions(docId));
  });

  // Get version content by timestamp
  router.get('/api/versions/:ts', (req, res) => {
    const docId = s.getDocId();
    const ts = parseInt(req.params.ts, 10);
    if (!docId || isNaN(ts)) { res.status(400).json({ error: 'Invalid request' }); return; }

    const content = getVersionContent(docId, ts);
    if (!content) { res.status(404).json({ error: 'Version not found' }); return; }
    res.json({ content });
  });

  // Restore a version
  router.post('/api/versions/:ts/restore', (req, res) => {
    const docId = s.getDocId();
    const ts = parseInt(req.params.ts, 10);
    const mode = req.body.mode as 'review' | 'full';
    if (!docId || isNaN(ts) || !mode) {
      res.status(400).json({ error: 'docId, ts, and mode are required' });
      return;
    }

    // Safety net: snapshot current state before restoring
    try { forceSnapshot(docId, s.getFilePath()); } catch { /* best effort */ }

    const parsed = restoreVersion(docId, ts);
    if (!parsed) { res.status(404).json({ error: 'Version not found' }); return; }

    if (mode === 'review') {
      markAllNodesAsPending(parsed.document, 'rewrite');
    }

    s.updateDocument(parsed.document);
    s.save();

    const filePath = s.getFilePath();
    const filename = filePath ? filePath.split(/[/\\]/).pop() || '' : '';
    s.broadcastDocumentSwitched(parsed.document, parsed.title, filename);

    res.json({ success: true, mode });
  });

  // Manual checkpoint
  router.post('/api/versions/snapshot', (_req, res) => {
    const docId = s.getDocId();
    if (!docId) { res.status(400).json({ error: 'No active document' }); return; }
    try {
      forceSnapshot(docId, s.getFilePath());
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
