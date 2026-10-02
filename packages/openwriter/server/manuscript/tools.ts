/** Book MCP tools. A book is an Outline (content_type "manuscript") plus the
 *  Manuscript built from it; the manuscript is the book. adr: adr/manuscript-engine.md */
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { z } from 'zod';
import { ROOT_DIR } from '../helpers.js';
import { compileManuscript } from './index.js';
import { loadManifest, safeName } from './load.js';
import { BookError, bookStatus, addChapter, bookSource, renderBook, type BookFormat } from './book.js';
import type { ToolDef } from '../mcp.js';
import { createEditingDraft } from '../document-revisions.js';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/** Book refusals read as plain answers, not tool crashes. */
async function answer(run: () => Promise<string> | string) {
  try { return text(await run()); } catch (err) {
    if (err instanceof BookError) return text(`Error: ${err.message}`);
    throw err;
  }
}

export const manuscriptTools: ToolDef[] = [
  {
    name: 'create_editing_draft',
    description: 'Build the Manuscript of a book. Compiles its Outline (the doc of chapter headings over beat pointers) into one full-text document nested under the outline, with a permanent "Built from outline" version. From then on the manuscript IS the book: edit it, never the beats; downloads export its accepted text. If the outline already has a manuscript this returns an error naming it; pass confirm:true only when the author asked for a second one. Called on an ordinary document it creates a Revision copy instead. Returns identity and chapter headings, not the body, and does not change the active document. Use normal editing tools and Focus mode on the result.',
    schema: {
      docId: z.string().describe('The outline (or a document to revise) by docId.'),
      title: z.string().optional().describe('Optional name for the new document.'),
      confirm: z.boolean().optional().describe('Build another manuscript even though one exists. Only when the author asked.'),
    },
    handler: async ({ docId, title, confirm }: { docId: string; title?: string; confirm?: boolean }) =>
      answer(() => JSON.stringify(createEditingDraft(docId, title, { confirm }))),
  },
  {
    name: 'compile_manuscript',
    description: 'Compile a book Outline (content_type "manuscript") from its beats and report its structure + any problems — WITHOUT writing a file. Resolves every `doc:` pointer, concatenates the accepted beat bodies under their chapter headings, and returns title, per-chapter word counts, total words, and warnings (unresolved pointers). Once a book has a Manuscript, the manuscript is the book and this compile is only the beats: the report then names the manuscript and lists outline chapters it lacks (add them with add_chapter_to_manuscript) or that wait for the author\'s review. Pass includeMarkdown:true for the full compiled text (large). Target the outline by docId.',
    schema: {
      docId: z.string().describe('The outline by docId (8-char hex from list_documents).'),
      includeMarkdown: z.boolean().optional().describe('Also return the full compiled markdown. Off by default — for a long book this is very large.'),
    },
    handler: async ({ docId, includeMarkdown }: { docId: string; includeMarkdown?: boolean }) => {
      const ms = loadManifest(docId);
      if (!ms) return text(`No outline found for docId ${docId}. Is it content_type "manuscript"?`);
      const { markdown, meta, warnings } = compileManuscript(ms.body, ms.meta);
      const wc = (s: string) => { const t = s.trim(); return t ? t.split(/\s+/).length : 0; };
      const chapters: { title: string; words: number }[] = [];
      let cur: { title: string; words: number } | null = null;
      for (const line of markdown.split('\n')) {
        const h = line.match(/^# (.+)/);
        if (h) { cur = { title: h[1].trim(), words: 0 }; chapters.push(cur); }
        else if (cur) cur.words += wc(line);
      }
      const summary: Record<string, any> = {
        title: meta.title,
        chapterCount: chapters.length,
        totalWords: wc(markdown),
        chapters,
        warnings,
      };
      const status = bookStatus(docId);
      const built = status.manuscripts?.[0];
      if (built) {
        const book = bookStatus(built.docId);
        summary.manuscript = { docId: built.docId, title: built.title };
        summary.missingFromManuscript = (book.chapters || []).filter((c) => c.state === 'missing').map((c) => c.heading);
        summary.waitingForReview = (book.chapters || []).filter((c) => c.state === 'pending').map((c) => c.heading);
      }
      if (includeMarkdown) summary.markdown = markdown;
      return text(JSON.stringify(summary, null, 2));
    },
  },
  {
    name: 'add_chapter_to_manuscript',
    description: 'Add an outline chapter the book\'s Manuscript does not have yet. Compiles that chapter\'s beats and inserts them into the manuscript as ONE pending change, in outline order (before the next chapter the manuscript holds, or at the end); the author accepts or rejects it in review. This is the only way new chapters reach the book. Afterwards tell the author what was inserted and where. Refuses a chapter already in the manuscript or waiting for review, and chapters with footnotes.',
    schema: {
      docId: z.string().describe('The manuscript, or its outline, by docId.'),
      chapter: z.string().describe('The chapter heading exactly as the outline has it, e.g. "Ch 4 — Deep Sleep".'),
    },
    handler: async ({ docId, chapter }: { docId: string; chapter: string }) =>
      answer(() => {
        const r = addChapter(docId, chapter);
        return `Inserted "${r.heading}" (${r.words.toLocaleString()} words) into "${r.manuscript.title}" ${r.position}, as one change waiting for the author's review.`;
      }),
  },
  {
    name: 'export_manuscript',
    description: 'Write a book to a file: epub (KDP-ready ebook), docx (Word), html (single styled file), or md. Exports the Manuscript\'s accepted text with its download settings; given an outline, exports its manuscript (or, before one is built, the outline compiled from its beats). Writes to ~/.openwriter/exports/<title>.<ext> by default (or an explicit outputPath) and returns the absolute path. EPUB/HTML ship print-light (e-readers handle their own dark mode).',
    schema: {
      docId: z.string().describe('The manuscript, or its outline, by docId (8-char hex from list_documents).'),
      format: z.enum(['epub', 'docx', 'html', 'md']).describe('Output format. epub = KDP-ready ebook; docx = Word; html = single styled file; md = the book\'s markdown.'),
      outputPath: z.string().optional().describe('Absolute file path to write. Defaults to ~/.openwriter/exports/<title>.<ext>.'),
    },
    handler: async ({ docId, format, outputPath }: { docId: string; format: BookFormat; outputPath?: string }) =>
      answer(async () => {
        const { markdown, meta, warnings, from } = bookSource(docId);
        const { data } = await renderBook(markdown, meta, format);
        const dir = join(ROOT_DIR, 'exports');
        mkdirSync(dir, { recursive: true });
        const outPath = outputPath || join(dir, `${safeName(meta.title || '')}.${format}`);
        writeFileSync(outPath, data);
        const warn = warnings.length
          ? ` — ${warnings.length} warning(s): ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? ' …' : ''}`
          : '';
        return `Exported "${meta.title}" from "${from.title}" (${format}) → ${outPath}${warn}`;
      }),
  },
];
