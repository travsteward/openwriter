/**
 * Bookmark HTTP routes. Browser-only surface: no MCP tool reads or writes
 * bookmarks, so they stay the user's private notes.
 * adr: adr/bookmarks.md
 */

import { Router } from 'express';
import { getBookmarks, addBookmark, editBookmark, deleteBookmark } from './bookmarks.js';
import { broadcastBookmarksChanged } from './ws.js';

export function createBookmarkRouter(): Router {
  const router = Router();

  router.get('/api/bookmarks/:filename', (req, res) => {
    res.json({ bookmarks: getBookmarks(req.params.filename) });
  });

  router.post('/api/bookmarks', (req, res) => {
    const { filename, nodeId, note } = req.body;
    if (!filename || !nodeId) {
      res.status(400).json({ error: 'filename and nodeId are required' });
      return;
    }
    const bookmark = addBookmark(filename, nodeId, typeof note === 'string' ? note.trim() : '');
    broadcastBookmarksChanged(filename);
    res.json({ success: true, bookmark });
  });

  router.patch('/api/bookmarks', (req, res) => {
    const { filename, id, note } = req.body;
    if (!filename || !id || typeof note !== 'string') {
      res.status(400).json({ error: 'filename, id, and note are required' });
      return;
    }
    const bookmark = editBookmark(filename, id, note.trim());
    if (!bookmark) {
      res.status(404).json({ error: 'bookmark not found' });
      return;
    }
    broadcastBookmarksChanged(filename);
    res.json({ success: true, bookmark });
  });

  router.delete('/api/bookmarks', (req, res) => {
    const { filename, id } = req.body;
    if (!filename || !id) {
      res.status(400).json({ error: 'filename and id are required' });
      return;
    }
    const deleted = deleteBookmark(filename, id);
    broadcastBookmarksChanged(filename);
    res.json({ success: true, deleted });
  });

  return router;
}
