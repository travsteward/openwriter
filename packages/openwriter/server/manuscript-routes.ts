/**
 * Book routes. A book is an Outline plus the Manuscript built from it; the
 * manuscript is the book, so downloads export its accepted text.
 *
 *   GET  /api/book?docId=<id>                 -> where this doc stands in a book
 *   GET  /api/books                           -> every book (launcher)
 *   POST /api/book/build {docId, confirm?, useExisting?}
 *   POST /api/book/add-chapter {docId, heading}
 *   POST /api/book/style {docId, paragraphStyle}
 *   GET  /api/book/export?docId=<id>&format=epub|docx|html|md
 *
 * adr: adr/manuscript-engine.md
 */
import { Router, type Response } from 'express';
import { safeName } from './manuscript/load.js';
import {
  BookError, BOOK_FORMATS, type BookFormat, bookStatus, listBooks, adoptManuscript, addChapter, bookSource, renderBook, setBookStyle,
} from './manuscript/book.js';
import { createRevision } from './document-revisions.js';

function fail(res: Response, err: any): void {
  if (err instanceof BookError) {
    res.status(err.status).json({ error: err.message, ...(err.manuscript ? { manuscript: err.manuscript } : {}) });
    return;
  }
  res.status(400).json({ error: err?.message || 'Request failed' });
}

async function sendBook(req: any, res: Response): Promise<void> {
  const format = String(req.query.format || 'epub').toLowerCase() as BookFormat;
  if (!BOOK_FORMATS.includes(format)) {
    res.status(400).json({ error: `Unknown format: ${format}. Use epub, docx, html, or md.` });
    return;
  }
  try {
    const { markdown, meta } = bookSource(String(req.query.docId || ''));
    const { data, type } = await renderBook(markdown, meta, format);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(meta.title || '')}.${format}"`);
    res.send(data);
  } catch (err: any) {
    if (err instanceof BookError) return fail(res, err);
    console.error('[Book] export error:', err?.message);
    res.status(500).json({ error: 'Book export failed' });
  }
}

export function createManuscriptRouter(): Router {
  const router = Router();

  router.get('/api/book', (req, res) => {
    try { res.json(bookStatus(String(req.query.docId || ''))); } catch (err) { fail(res, err); }
  });

  router.get('/api/books', (_req, res) => {
    res.json({ books: listBooks() });
  });

  router.post('/api/book/build', (req, res) => {
    try {
      const { docId, confirm, useExisting } = req.body || {};
      if (typeof docId !== 'string') return res.status(400).json({ error: 'Choose an outline.' });
      if (typeof useExisting === 'string') return res.json(adoptManuscript(docId, useExisting));
      res.status(201).json(createRevision(docId, undefined, { confirm: confirm === true }));
    } catch (err) { fail(res, err); }
  });

  router.post('/api/book/add-chapter', (req, res) => {
    try {
      const { docId, heading } = req.body || {};
      if (typeof docId !== 'string' || typeof heading !== 'string') return res.status(400).json({ error: 'Choose a manuscript and a chapter.' });
      res.json(addChapter(docId, heading));
    } catch (err) { fail(res, err); }
  });

  router.post('/api/book/style', (req, res) => {
    try {
      const { docId, paragraphStyle } = req.body || {};
      if (typeof docId !== 'string' || (paragraphStyle !== 'spaced' && paragraphStyle !== 'indented')) {
        return res.status(400).json({ error: 'Choose a manuscript and a paragraph style.' });
      }
      setBookStyle(docId, paragraphStyle);
      res.json({ success: true });
    } catch (err) { fail(res, err); }
  });

  router.get('/api/book/export', sendBook);
  // Older download links keep working.
  router.get('/api/manuscript/export', sendBook);

  // Older agents and bookmarks: building from an outline still works here.
  router.post('/api/manuscript/editing-draft', (req, res) => {
    try {
      const { docId, title, confirm } = req.body || {};
      if (typeof docId !== 'string' || (title !== undefined && typeof title !== 'string')) {
        return res.status(400).json({ error: 'Choose a manuscript and a valid draft title.' });
      }
      res.status(201).json(createRevision(docId, title, { confirm: confirm === true }));
    } catch (err) { fail(res, err); }
  });

  return router;
}
