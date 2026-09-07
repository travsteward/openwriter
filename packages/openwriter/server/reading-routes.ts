import { Router } from 'express';
import { readFileSync } from 'fs';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { resolveDocId, getActiveFilename } from './documents.js';
import { resolveDocPath } from './helpers.js';
import { getDocument, getMetadata, getTitle } from './state.js';
import { markdownToTiptap, tiptapToMarkdown } from './markdown.js';
import { buildExportHtml } from './export-html-template.js';

// Reading never switches shared state, opens a socket, or writes a document.
// adr: adr/independent-reading.md
const markdown = new MarkdownIt({ html: false, linkify: false }).use(footnote);
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const href = tokens[index].attrGet('href') || '';
  const doc = /^doc:([a-f0-9]{8})(?:$|[#?])/i.exec(href);
  if (doc) tokens[index].attrSet('href', `/read/${doc[1]}`);
  return renderer.renderToken(tokens, index, options);
};

export function createReadingRouter(): Router {
  const router = Router();
  router.get('/read/:docId', (req, res) => {
    try {
      const filename = resolveDocId(req.params.docId);
      const target = filename === getActiveFilename()
        ? { document: getDocument(), metadata: getMetadata(), title: getTitle() }
        : markdownToTiptap(readFileSync(resolveDocPath(filename), 'utf-8'));
      const raw = tiptapToMarkdown(target.document, target.title, target.metadata);
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\s*/, '');
      const header = `<nav aria-label="Reading view" style="font-family:system-ui;font-size:13px;border-bottom:1px solid #ddd;padding-bottom:16px;margin-bottom:24px"><strong>Independent reading view</strong><p>Accepted text. Refresh to see saved changes.</p><a href="/d/${req.params.docId}" target="_blank" rel="noopener">Open in shared editor</a></nav>`;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'");
      res.type('html').send(buildExportHtml(target.title, header + markdown.render(body)));
    } catch {
      res.status(404).type('html').send(buildExportHtml('Document unavailable', '<h1>Document unavailable</h1><p>It may have been deleted or moved.</p>'));
    }
  });
  return router;
}
