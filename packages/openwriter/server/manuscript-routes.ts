/**
 * Manuscript routes: compile + render a manuscript doc to a file or preview.
 *
 *   GET /api/manuscript/preview?docId=<id>            -> book HTML (iframe source)
 *   GET /api/manuscript/export?docId=<id>&format=epub -> epub | docx | html | md
 *
 * Both resolve the manifest doc by stable docId, compile it (resolve pointers +
 * assemble), then render. Preview and export share the same compile() path, so
 * the preview can never disagree with the exported book. adr: adr/manuscript-engine.md
 */
import { Router } from 'express';
import {
  compileManuscript,
  renderBookHtml,
  renderEpub,
  renderDocx,
} from './manuscript/index.js';
import { listManuscripts, loadManifest, safeName } from './manuscript/load.js';
import { createEditingDraft } from './document-revisions.js';

export function createManuscriptRouter(): Router {
  const router = Router();

  router.post('/api/manuscript/editing-draft', (req, res) => {
    try {
      const { docId, title } = req.body || {};
      if (typeof docId !== 'string' || (title !== undefined && typeof title !== 'string')) {
        return res.status(400).json({ error: 'Choose a manuscript and a valid draft title.' });
      }
      res.status(201).json(createEditingDraft(docId, title));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Always-on launcher list for the right rail — every manuscript in the profile.
  router.get('/api/manuscripts', (_req, res) => {
    res.json({ manuscripts: listManuscripts() });
  });

  router.get('/api/manuscript/preview', (req, res) => {
    const ms = loadManifest(String(req.query.docId || ''));
    if (!ms) return res.status(404).json({ error: 'manuscript doc not found' });
    const { markdown, meta } = compileManuscript(ms.body, ms.meta);
    // The manuscript compose view frames this preview SAME-ORIGIN. The global
    // security gate sends X-Frame-Options: DENY + frame-ancestors 'none', which
    // blocks the iframe entirely. Relax BOTH to same-origin for this route only —
    // a self-contained book page, framed by the app itself, nothing external.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'",
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Screen light/dark follows the app's Appearance setting, passed by the
    // compose view. Export (below) never does — the book ships print-light.
    const mode = req.query.mode === 'dark' ? 'dark' : 'light';
    res.send(renderBookHtml(markdown, meta, mode));
  });

  router.get('/api/manuscript/export', async (req, res) => {
    const ms = loadManifest(String(req.query.docId || ''));
    if (!ms) return res.status(404).json({ error: 'manuscript doc not found' });

    const format = String(req.query.format || 'epub').toLowerCase();
    const result = compileManuscript(ms.body, ms.meta);
    const name = safeName(result.meta.title || '');

    try {
      switch (format) {
        case 'epub': {
          const buf = await renderEpub(result.markdown, result.meta);
          res.setHeader('Content-Type', 'application/epub+zip');
          res.setHeader('Content-Disposition', `attachment; filename="${name}.epub"`);
          return res.send(buf);
        }
        case 'docx': {
          const buf = await renderDocx(result.markdown, result.meta);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          res.setHeader('Content-Disposition', `attachment; filename="${name}.docx"`);
          return res.send(buf);
        }
        case 'html': {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${name}.html"`);
          return res.send(renderBookHtml(result.markdown, result.meta));
        }
        case 'md': {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${name}.md"`);
          return res.send(result.markdown);
        }
        default:
          return res.status(400).json({ error: `Unknown format: ${format}. Use epub, docx, html, or md.` });
      }
    } catch (err: any) {
      console.error('[Manuscript] export error:', err?.message);
      return res.status(500).json({ error: 'Manuscript export failed' });
    }
  });

  return router;
}
