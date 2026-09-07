/** Manuscript MCP tools. adr: adr/manuscript-engine.md */
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { z } from 'zod';
import { ROOT_DIR } from '../helpers.js';
import { compileManuscript, renderBookHtml, renderEpub, renderDocx } from './index.js';
import { loadManifest, safeName } from './load.js';
import type { ToolDef } from '../mcp.js';

export const manuscriptTools: ToolDef[] = [
  {
    name: 'compile_manuscript',
    description: 'Compile a manuscript doc (content_type "manuscript") into the assembled master book and report its structure + any problems — WITHOUT writing a file. Resolves every `doc:` pointer in the manifest, concatenates the canonical (accepted) bodies in manifest order under their chapter headings, namespaces footnotes, then returns: title, per-chapter word counts, chapter count, total word count, and warnings. Warnings flag unresolved pointers — a beat that points at a missing/renamed/archived doc — so this is the build-time feedback loop: run it to confirm the binding resolves and see how each chapter is sizing up. Pass includeMarkdown:true to also return the full assembled markdown (large for a real book). Target the manifest by docId (8-char hex).',
    schema: {
      docId: z.string().describe('The manuscript doc (the manifest) by docId (8-char hex from list_documents).'),
      includeMarkdown: z.boolean().optional().describe('Also return the full assembled master markdown. Off by default — for a long book this is very large.'),
    },
    handler: async ({ docId, includeMarkdown }: { docId: string; includeMarkdown?: boolean }) => {
      const ms = loadManifest(docId);
      if (!ms) return { content: [{ type: 'text', text: `No manuscript doc found for docId ${docId}. Is it content_type "manuscript"?` }] };
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
      if (includeMarkdown) summary.markdown = markdown;
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  },
  {
    name: 'export_manuscript',
    description: 'Compile a manuscript doc and WRITE the rendered book to a file: epub (KDP-ready ebook), docx (Word), html (single styled file), or md (the raw assembled master markdown). Same compile + render path as the in-app preview, so the file matches what you see there. Writes to ~/.openwriter/exports/<title>.<ext> by default (or an explicit outputPath) and returns the absolute path plus any compile warnings. EPUB/HTML ship print-light (e-readers handle their own dark mode). Target the manifest by docId (8-char hex).',
    schema: {
      docId: z.string().describe('The manuscript doc (the manifest) by docId (8-char hex from list_documents).'),
      format: z.enum(['epub', 'docx', 'html', 'md']).describe('Output format. epub = KDP-ready ebook; docx = Word; html = single styled file; md = raw assembled master markdown.'),
      outputPath: z.string().optional().describe('Absolute file path to write. Defaults to ~/.openwriter/exports/<title>.<ext>.'),
    },
    handler: async ({ docId, format, outputPath }: { docId: string; format: 'epub' | 'docx' | 'html' | 'md'; outputPath?: string }) => {
      const ms = loadManifest(docId);
      if (!ms) return { content: [{ type: 'text', text: `No manuscript doc found for docId ${docId}. Is it content_type "manuscript"?` }] };
      const result = compileManuscript(ms.body, ms.meta);
      const dir = join(ROOT_DIR, 'exports');
      mkdirSync(dir, { recursive: true });
      const outPath = outputPath || join(dir, `${safeName(result.meta.title || '')}.${format}`);
      switch (format) {
        case 'epub': writeFileSync(outPath, await renderEpub(result.markdown, result.meta)); break;
        case 'docx': writeFileSync(outPath, await renderDocx(result.markdown, result.meta)); break;
        case 'html': writeFileSync(outPath, renderBookHtml(result.markdown, result.meta), 'utf-8'); break;
        case 'md': writeFileSync(outPath, result.markdown, 'utf-8'); break;
      }
      const warn = result.warnings.length
        ? ` — ${result.warnings.length} warning(s): ${result.warnings.slice(0, 3).join('; ')}${result.warnings.length > 3 ? ' …' : ''}`
        : '';
      return { content: [{ type: 'text', text: `Exported "${result.meta.title}" (${format}) → ${outPath}${warn}` }] };
    },
  },
];
