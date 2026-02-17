/**
 * Export routes: GET /api/export?format=md|html|docx|txt|pdf
 * Converts the current document to the requested format.
 */

import { Router } from 'express';
import MarkdownIt from 'markdown-it';
import markdownItIns from 'markdown-it-ins';
import markdownItMark from 'markdown-it-mark';
import markdownItSub from 'markdown-it-sub';
import markdownItSup from 'markdown-it-sup';
import { tiptapToMarkdown } from './markdown.js';
import { getDocument, getTitle, getPlainText, getMetadata } from './state.js';
import { buildExportHtml } from './export-html-template.js';

// markdown-it instance matching markdown-parse.ts configuration
const md = new MarkdownIt({ linkify: false });
md.enable('strikethrough');
md.use(markdownItIns);
md.use(markdownItMark);
md.use(markdownItSub);
md.use(markdownItSup);

/** Strip YAML frontmatter (---\n...\n---\n\n) from markdown output. */
function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n\n/);
  return match ? markdown.slice(match[0].length) : markdown;
}

function sanitizeFilename(title: string): string {
  return title.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 100);
}

export function createExportRouter(): Router {
  const router = Router();

  router.get('/api/export', async (req, res) => {
    const format = (req.query.format as string || '').toLowerCase();
    const title = getTitle();
    const safeName = sanitizeFilename(title);

    try {
      switch (format) {
        case 'md': {
          const raw = tiptapToMarkdown(getDocument(), title, getMetadata());
          const clean = stripFrontmatter(raw);
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}.md"`);
          res.send(clean);
          break;
        }

        case 'html': {
          const raw = tiptapToMarkdown(getDocument(), title, getMetadata());
          const clean = stripFrontmatter(raw);
          const bodyHtml = md.render(clean);
          const fullHtml = buildExportHtml(title, bodyHtml);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}.html"`);
          res.send(fullHtml);
          break;
        }

        case 'docx': {
          const raw = tiptapToMarkdown(getDocument(), title, getMetadata());
          const clean = stripFrontmatter(raw);
          const bodyHtml = md.render(clean);
          const { default: HtmlToDocx } = await import('@turbodocx/html-to-docx');
          const docxBuffer = await HtmlToDocx(bodyHtml, undefined, {
            title,
            margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          });
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
          res.send(Buffer.from(docxBuffer));
          break;
        }

        case 'txt': {
          const text = getPlainText();
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}.txt"`);
          res.send(text);
          break;
        }

        case 'pdf': {
          const raw = tiptapToMarkdown(getDocument(), title, getMetadata());
          const clean = stripFrontmatter(raw);
          const bodyHtml = md.render(clean);
          const fullHtml = buildExportHtml(title, bodyHtml);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Content-Disposition', 'inline');
          res.send(fullHtml);
          break;
        }

        default:
          res.status(400).json({ error: `Unknown format: ${format}. Use md, html, docx, txt, or pdf.` });
      }
    } catch (err: any) {
      console.error('[Export] Error:', err.message);
      res.status(500).json({ error: 'Export failed' });
    }
  });

  return router;
}
