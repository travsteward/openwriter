/**
 * Manifest loaders — shared by the HTTP routes and the MCP tools. Resolving an
 * outline doc by stable docId, the book's render settings, and the export
 * filename helper all live here so both surfaces read identical data.
 *
 * adr: adr/manuscript-engine.md
 */
import { filenameByDocId } from '../documents.js';
import { readFrontmatter } from '../backlinks.js';
import type { ManifestMeta } from './index.js';

/** Render meta from a book doc's frontmatter (an outline or its manuscript,
 *  round-trip-safe): the book title defaults to the doc title minus a trailing
 *  "— Manuscript" or "— Outline"; author/output/trim/style come from
 *  manuscriptContext. */
export function bookMeta(data: Record<string, any>): ManifestMeta {
  const ctx = (data.manuscriptContext || {}) as Record<string, any>;
  const title =
    (typeof ctx.title === 'string' && ctx.title) ||
    String(data.title || '').replace(/\s*[—–-]\s*(manuscript|outline)\s*$/i, '') ||
    'Untitled';
  return {
    title,
    author: typeof ctx.author === 'string' ? ctx.author : undefined,
    output: typeof ctx.output === 'string' ? ctx.output : undefined,
    trim: typeof ctx.trim === 'string' ? ctx.trim : undefined,
    // Render-time book style; defaults to 'spaced' downstream in bookCss().
    paragraphStyle: ctx.paragraphStyle === 'indented' ? 'indented' : 'spaced',
  };
}

/** Load a manifest doc by docId: its body (ordered pointer list) + render meta. */
export function loadManifest(docId: string): { body: string; meta: ManifestMeta } | null {
  if (!docId) return null;
  const filename = filenameByDocId(docId);
  if (!filename) return null;
  const fm = readFrontmatter(filename);
  if (!fm) return null;
  return { body: fm.content, meta: bookMeta(fm.data) };
}

/** Filesystem-safe filename stem from a book title. */
export function safeName(title: string): string {
  return (title || 'manuscript').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 100);
}
