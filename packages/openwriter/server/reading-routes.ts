import { Router } from 'express';
import { resolveDocId } from './documents.js';

// Compatibility for saved reading links: use the normal editor and Focus mode.
// adr: adr/independent-reading.md

export function createReadingRouter(): Router {
  const router = Router();
  router.get('/read/:docId', (req, res) => {
    try {
      resolveDocId(req.params.docId);
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(303, `/d/${encodeURIComponent(req.params.docId)}?focus=1`);
    } catch {
      res.status(404).type('text').send('Document unavailable.');
    }
  });
  return router;
}
