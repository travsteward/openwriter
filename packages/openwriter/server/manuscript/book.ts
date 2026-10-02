/**
 * A book is two docs. The Outline (content_type "manuscript") lists chapter
 * headings over beat pointers. The Manuscript is the full text built from it
 * once: an ordinary document with variantType "manuscript" and the outline as
 * its masterDocId. The manuscript is the book: agents edit it, downloads export
 * its accepted text, and a chapter the outline gains later arrives in it as one
 * pending change the author reviews like any edit.
 *
 * Which outline chapter a manuscript already holds is recorded in its
 * frontmatter (manuscriptChapters: the chapter heading's node id and the
 * chapter's beats), so renaming a chapter on either side doesn't make it look
 * missing. Chapters with no record fall back to matching heading text.
 *
 * adr: adr/manuscript-engine.md
 */
import { createHash } from 'crypto';
import { statSync } from 'fs';
import { listDocuments, getActiveFilename } from '../documents.js';
import { readFrontmatter, writeFrontmatter } from '../backlinks.js';
import { loadDocFromDisk, listOverlayTimes } from '../pending-overlay.js';
import {
  getDocument, getMetadata, setMetadata, mergeMetadataUpdates, save, applyChanges, applyChangesToFile,
  invalidateDocCache, isAutoAcceptActive, type DocumentInfo, type NodeChange, type PadDocument,
} from '../state.js';
import { parseMarkdownContent } from '../compact.js';
import { tiptapToMarkdownChecked } from '../markdown.js';
import { resolveDocPath, generateNodeId, LEAF_BLOCK_TYPES } from '../helpers.js';
import { listCommits } from '../commits.js';
import { getVersionContent, writeSnapshotAt } from '../versions.js';
import { broadcastDocumentsChanged, broadcastMetadataChanged, broadcastPendingDocsChanged } from '../ws.js';
import {
  parseManifest, assemble, compileManuscript, renderBookHtml, renderEpub, renderDocx,
  type ManifestMeta, type ManifestSection,
} from './index.js';
import { resolveManifestDocs } from './resolve.js';
import { bookMeta, loadManifest } from './load.js';

export interface BookDoc { docId: string; title: string; filename: string }
export interface OutlineChapter { heading: string; beats: string[]; sections: ManifestSection[] }
export interface ChapterRecord { heading: string; headingId: string; beats: string[] }
export interface ChapterState { heading: string; state: 'present' | 'pending' | 'missing'; headingId?: string }

/** A refusal the author or agent can act on. `status` is the HTTP code. */
export class BookError extends Error {
  constructor(message: string, public status = 400, public manuscript?: BookDoc) { super(message); }
}

const toBookDoc = (d: DocumentInfo): BookDoc => ({ docId: d.docId!, title: d.title, filename: d.filename });
const isOutline = (d: DocumentInfo) => d.contentType === 'manuscript' && !!d.docId;
const isManuscript = (d: DocumentInfo) => d.variantType === 'manuscript' && !!d.masterDocId && !!d.docId;

/** Manuscripts built from an outline, most recently changed first. */
export function manuscriptsOf(outlineDocId: string, docs: DocumentInfo[] = listDocuments()): BookDoc[] {
  return docs
    .filter((d) => isManuscript(d) && d.masterDocId === outlineDocId)
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
    .map(toBookDoc);
}

/** Every book in the profile: its outline and, once built, its manuscript. */
export function listBooks(): { title: string; outline: BookDoc; manuscript: BookDoc | null }[] {
  const docs = listDocuments();
  return docs.filter(isOutline)
    .map((o) => ({ title: bookMeta({ title: o.title }).title!, outline: toBookDoc(o), manuscript: manuscriptsOf(o.docId!, docs)[0] ?? null }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Chapters in outline order: each book-level heading (## in the outline) with
 *  every section and beat under it. Front matter before the first chapter
 *  belongs to no chapter. */
export function outlineChapters(outlineBody: string): OutlineChapter[] {
  const chapters: OutlineChapter[] = [];
  for (const section of parseManifest(outlineBody).sections) {
    if (section.heading && section.level <= 2) chapters.push({ heading: section.heading, beats: [], sections: [] });
    const chapter = chapters[chapters.length - 1];
    if (!chapter) continue;
    chapter.sections.push(section);
    for (const item of section.items) if (item.docId) chapter.beats.push(item.docId);
  }
  return chapters;
}

/** Heading text compared loosely: inline markers, spacing and case ignored. */
const plain = (text: string) => text.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

interface BookHeading { id: string; text: string; pending: boolean }

/** A manuscript's chapter headings: its top-level h1s. */
function bookHeadings(doc: PadDocument): BookHeading[] {
  return (doc.content || [])
    .filter((n: any) => n.type === 'heading' && n.attrs?.level === 1 && n.attrs?.id)
    .map((n: any) => ({
      id: n.attrs.id,
      text: (n.content || []).map((c: any) => c.text || '').join(''),
      pending: n.attrs.pendingStatus === 'insert',
    }));
}

function recordsOf(metadata: Record<string, any>): ChapterRecord[] {
  const raw = metadata?.manuscriptChapters;
  return Array.isArray(raw)
    ? raw.filter((r) => r && typeof r.heading === 'string' && typeof r.headingId === 'string' && Array.isArray(r.beats))
    : [];
}

/** Where each outline chapter stands in a manuscript. A recorded heading wins
 *  (it survives renames on both sides); otherwise the heading text decides. */
export function chapterStates(chapters: OutlineChapter[], headings: BookHeading[], records: ChapterRecord[]): ChapterState[] {
  const byId = new Map(headings.map((h) => [h.id, h]));
  const claimed = new Set<string>();
  const recordFor = (c: OutlineChapter) =>
    records.find((r) => plain(r.heading) === plain(c.heading)) ??
    records.find((r) => r.beats.some((b) => c.beats.includes(b)));
  return chapters.map((chapter) => {
    const recorded = byId.get(recordFor(chapter)?.headingId ?? '');
    const found = recorded && !claimed.has(recorded.id)
      ? recorded
      : headings.find((h) => !claimed.has(h.id) && plain(h.text) === plain(chapter.heading));
    if (!found) return { heading: chapter.heading, state: 'missing' };
    claimed.add(found.id);
    return { heading: chapter.heading, state: found.pending ? 'pending' : 'present', headingId: found.id };
  });
}

/** Records for the chapters a newly built or adopted manuscript holds. */
export function recordChapters(chapters: OutlineChapter[], doc: PadDocument): ChapterRecord[] {
  return chapterStates(chapters, bookHeadings(doc), []).flatMap((s, i) =>
    s.headingId ? [{ heading: chapters[i].heading, headingId: s.headingId, beats: chapters[i].beats }] : []);
}

const viewCache = new Map<string, { stamp: string; doc: PadDocument; metadata: Record<string, any> }>();

/** A manuscript as the editor shows it (accepted text plus pending changes)
 *  with its frontmatter. The live doc comes from memory; any other from disk,
 *  cached until the file or its pending changes move. */
function manuscriptView(m: BookDoc): { doc: PadDocument; metadata: Record<string, any> } {
  if (m.filename === getActiveFilename()) return { doc: getDocument(), metadata: getMetadata() };
  const stamp = `${statSync(resolveDocPath(m.filename)).mtimeMs}:${listOverlayTimes().get(m.docId)?.getTime() ?? 0}`;
  const cached = viewCache.get(m.filename);
  if (cached?.stamp === stamp) return cached;
  const loaded = loadDocFromDisk(m.filename);
  const view = { stamp, doc: loaded.document as PadDocument, metadata: loaded.metadata || {} };
  viewCache.set(m.filename, view);
  return view;
}

function statesFor(outline: BookDoc, manuscript: BookDoc): { chapters: OutlineChapter[]; states: ChapterState[] } {
  const fm = readFrontmatter(outline.filename);
  const chapters = fm ? outlineChapters(fm.content) : [];
  const view = manuscriptView(manuscript);
  return { chapters, states: chapterStates(chapters, bookHeadings(view.doc), recordsOf(view.metadata)) };
}

/** Manuscripts that already hold this beat's chapter. Edits to the beat no
 *  longer reach them; a beat whose chapter isn't in yet is still a draft. */
function manuscriptsHolding(beatDocId: string, docs: DocumentInfo[]): BookDoc[] {
  const out: BookDoc[] = [];
  for (const outline of docs.filter(isOutline)) {
    const manuscripts = manuscriptsOf(outline.docId!, docs);
    if (manuscripts.length === 0) continue;
    for (const m of manuscripts) {
      const { chapters, states } = statesFor(toBookDoc(outline), m);
      const index = chapters.findIndex((c) => c.beats.includes(beatDocId));
      if (index >= 0 && states[index].state !== 'missing') out.push(m);
    }
  }
  return out;
}

export interface BookStatus {
  role: 'outline' | 'manuscript' | null;
  outline?: BookDoc;
  /** Outline: manuscripts built from it. */
  manuscripts?: BookDoc[];
  /** Outline: older copies under it that can become its manuscript. */
  revisions?: BookDoc[];
  /** Manuscript: where each outline chapter stands. */
  chapters?: ChapterState[];
  /** Any other doc: manuscripts that already hold it as a beat. */
  inManuscripts?: BookDoc[];
}

export function bookStatus(docId: string): BookStatus {
  const docs = listDocuments();
  const doc = docs.find((d) => d.docId === docId);
  if (!doc) throw new BookError('Document not found.', 404);
  if (isOutline(doc)) {
    return {
      role: 'outline',
      outline: toBookDoc(doc),
      manuscripts: manuscriptsOf(docId, docs),
      revisions: docs.filter((d) => d.masterDocId === docId && d.variantType === 'revision' && d.docId).map(toBookDoc),
    };
  }
  if (isManuscript(doc)) {
    const outline = docs.find((d) => d.docId === doc.masterDocId && isOutline(d));
    if (!outline) return { role: 'manuscript' };
    return { role: 'manuscript', outline: toBookDoc(outline), chapters: statesFor(toBookDoc(outline), toBookDoc(doc)).states };
  }
  return { role: null, inManuscripts: manuscriptsHolding(docId, docs) };
}

/** Merge metadata into a doc: the live doc through memory (saved, and pushed to
 *  its tabs), any other doc by rewriting only its frontmatter. */
function writeMetadata(filename: string, updates: Record<string, any>): void {
  if (filename === getActiveFilename()) {
    setMetadata(updates);
    save();
    broadcastMetadataChanged(getMetadata());
  } else {
    const fm = readFrontmatter(filename);
    if (!fm) throw new BookError('Document not found.', 404);
    writeFrontmatter(filename, mergeMetadataUpdates(fm.data, updates) ?? fm.data);
    invalidateDocCache(resolveDocPath(filename));
  }
  broadcastDocumentsChanged();
}

/** The book's settings (style, title, author) without the type marker. */
export function bookSettings(outlineData: Record<string, any>): Record<string, any> {
  const { active: _active, ...settings } = (outlineData.manuscriptContext || {}) as Record<string, any>;
  return structuredClone(settings);
}

/**
 * Make an older copy under an outline (a Revision) its manuscript. Only
 * metadata changes; the body, comments, pending changes and history stay as
 * they are. A pruned original copy is put back when the outline still
 * compiles to exactly the text the copy was made from.
 */
export function adoptManuscript(outlineDocId: string, docId: string): { manuscript: BookDoc; chapters: number; restoredOriginal: boolean } {
  const docs = listDocuments();
  const outline = docs.find((d) => d.docId === outlineDocId && isOutline(d));
  const doc = docs.find((d) => d.docId === docId);
  if (!outline || !doc || doc.masterDocId !== outlineDocId) throw new BookError('Choose a copy that sits under this outline.');
  if (doc.variantType === 'manuscript') throw new BookError(`"${doc.title}" is already this book's manuscript.`);
  const outlineFm = readFrontmatter(outline.filename);
  if (!outlineFm) throw new BookError('Outline not found.', 404);
  const records = recordChapters(outlineChapters(outlineFm.content), manuscriptView(toBookDoc(doc)).doc);
  writeMetadata(doc.filename, {
    variantType: 'manuscript',
    manuscriptContext: bookSettings(outlineFm.data),
    manuscriptChapters: records,
  });
  return { manuscript: toBookDoc(doc), chapters: records.length, restoredOriginal: restoreOriginal(docId, doc.filename, outlineDocId) };
}

/** Put back a copy's pruned original version, only when the outline still
 *  compiles to exactly the text the copy was made from (same hash). */
function restoreOriginal(docId: string, filename: string, outlineDocId: string): boolean {
  const original = listCommits(docId)[0];
  if (!original?.note || getVersionContent(docId, original.snapshotTs) !== null) return false;
  const fm = readFrontmatter(filename);
  const sourceHash = fm?.data.editingDraft?.sourceHash ?? fm?.data.revisionSourceHash;
  const ms = loadManifest(outlineDocId);
  if (!fm || !sourceHash || !ms) return false;
  const compiled = compileManuscript(ms.body, ms.meta);
  if (compiled.warnings.length || createHash('sha256').update(compiled.markdown).digest('hex') !== sourceHash) return false;
  const { nodes: _nodes, graveyard: _graveyard, ...metadata } = fm.data;
  const document: PadDocument = { type: 'doc', content: parseMarkdownContent(compiled.markdown) };
  const { markdown } = tiptapToMarkdownChecked(document, String(fm.data.title || ''), metadata);
  return writeSnapshotAt(docId, original.snapshotTs, markdown);
}

/** Mark a chapter as one pending change: every block shares a group id, and a
 *  top-level list or quote is marked as a whole, so it saves and reloads as one
 *  piece instead of an empty shell in the accepted text plus loose items.
 *  adr: adr/pending-overlay-model.md */
function markChapter(nodes: any[], groupId: string, nested = false): void {
  for (const node of nodes) {
    const leaf = LEAF_BLOCK_TYPES.has(node.type);
    if (leaf || !nested) node.attrs = { ...node.attrs, pendingStatus: 'insert', pendingGroupId: groupId };
    if (!leaf && Array.isArray(node.content)) markChapter(node.content, groupId, true);
  }
}

/**
 * Insert an outline chapter the manuscript lacks, compiled from its beats, as
 * one pending change in its place: before the next chapter the manuscript
 * holds, or at the end. The author accepts or rejects it like any edit.
 */
export function addChapter(docId: string, heading: string): { heading: string; position: string; words: number; manuscript: BookDoc } {
  const docs = listDocuments();
  const doc = docs.find((d) => d.docId === docId);
  if (!doc) throw new BookError('Document not found.', 404);
  const manuscript = isOutline(doc) ? manuscriptsOf(doc.docId!, docs)[0] : isManuscript(doc) ? toBookDoc(doc) : undefined;
  if (!manuscript) throw new BookError(isOutline(doc) ? 'Build the manuscript first.' : 'Choose a manuscript or its outline.');
  const outline = docs.find((d) => d.docId === (isOutline(doc) ? doc.docId : doc.masterDocId) && isOutline(d));
  if (!outline) throw new BookError('This manuscript has no outline.');

  const { chapters, states } = statesFor(toBookDoc(outline), manuscript);
  const index = chapters.findIndex((c, i) => plain(c.heading) === plain(heading) && states[i].state === 'missing');
  if (index < 0) {
    if (chapters.some((c) => plain(c.heading) === plain(heading))) throw new BookError(`"${heading}" is already in the manuscript.`);
    throw new BookError(`The outline has no chapter "${heading}".`);
  }
  const chapter = chapters[index];

  // Compile just this chapter, the same way the whole book compiles.
  const sections = chapter.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.kind === 'doc') }));
  const manifest = { meta: {}, sections, warnings: [] };
  const resolved = resolveManifestDocs(manifest);
  const { markdown, warnings } = assemble(manifest, resolved.bodyMap);
  const problems = [...resolved.warnings, ...warnings];
  if (problems.length) throw new BookError(`"${chapter.heading}" could not be copied completely: ${problems.join('; ')}`);
  if (/\[\^[^\]\s]+\]/.test(markdown)) {
    throw new BookError(`"${chapter.heading}" has footnotes, which Add chapter can't place yet. Add it by hand.`);
  }

  const view = manuscriptView(manuscript);
  const next = states.slice(index + 1).find((s) => s.state !== 'missing');
  let afterNodeId = 'end';
  if (next) {
    const at = view.doc.content.findIndex((n: any) => n.attrs?.id === next.headingId);
    if (at === 0) throw new BookError(`"${chapter.heading}" goes before the start of the manuscript. Add it by hand.`);
    if (at > 0) afterNodeId = view.doc.content[at - 1].attrs.id;
  }

  const nodes = parseMarkdownContent(markdown);
  const headingNode = nodes.find((n: any) => n.type === 'heading' && n.attrs?.level === 1);
  // Auto-accepting manuscripts take it like any agent edit: straight in.
  if (!isAutoAcceptActive(manuscript.filename, view.metadata)) markChapter(nodes, generateNodeId() + generateNodeId());
  const record: ChapterRecord = { heading: chapter.heading, headingId: headingNode.attrs.id, beats: chapter.beats };
  const records = [
    ...recordsOf(view.metadata).filter((r) => plain(r.heading) !== plain(chapter.heading) && !r.beats.some((b) => chapter.beats.includes(b))),
    record,
  ];
  const change: NodeChange = { operation: 'insert', afterNodeId, content: nodes };

  // Record first: the edit then saves (or broadcasts) after it, so the browser
  // ends on the edit's version. adr: adr/pending-overlay-model.md
  if (manuscript.filename === getActiveFilename()) {
    setMetadata({ manuscriptChapters: records });
    applyChanges([change]);
  } else {
    writeMetadata(manuscript.filename, { manuscriptChapters: records });
    applyChangesToFile(manuscript.filename, [change]);
    broadcastPendingDocsChanged();
  }
  return {
    heading: chapter.heading,
    position: next ? `before "${next.heading}"` : 'at the end',
    words: markdown.trim().split(/\s+/).length,
    manuscript,
  };
}

export const BOOK_FORMATS = ['epub', 'docx', 'html', 'md'] as const;
export type BookFormat = (typeof BOOK_FORMATS)[number];

/** The book's text and settings: a manuscript's accepted text, or, for an
 *  outline, its manuscript's (the outline compiled when none is built yet). */
export function bookSource(docId: string): { markdown: string; meta: ManifestMeta; warnings: string[]; from: BookDoc } {
  const docs = listDocuments();
  let doc = docs.find((d) => d.docId === docId);
  if (!doc) throw new BookError('Document not found.', 404);
  if (isOutline(doc)) {
    const built = manuscriptsOf(doc.docId!, docs)[0];
    if (!built) {
      const ms = loadManifest(doc.docId!);
      if (!ms) throw new BookError('Outline not found.', 404);
      const compiled = compileManuscript(ms.body, ms.meta);
      return { markdown: compiled.markdown, meta: compiled.meta, warnings: compiled.warnings, from: toBookDoc(doc) };
    }
    doc = docs.find((d) => d.docId === built.docId)!;
  }
  if (!isManuscript(doc)) throw new BookError('Only a manuscript or its outline downloads as a book.');
  // Unsaved edits to the open manuscript belong in the download.
  if (doc.filename === getActiveFilename()) save();
  const fm = readFrontmatter(doc.filename);
  if (!fm) throw new BookError('Document not found.', 404);
  return { markdown: fm.content.trim() + '\n', meta: bookMeta(fm.data), warnings: [], from: toBookDoc(doc) };
}

export async function renderBook(markdown: string, meta: ManifestMeta, format: BookFormat): Promise<{ data: Buffer | string; type: string }> {
  switch (format) {
    case 'epub': return { data: await renderEpub(markdown, meta), type: 'application/epub+zip' };
    case 'docx': return { data: await renderDocx(markdown, meta), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    case 'html': return { data: renderBookHtml(markdown, meta), type: 'text/html; charset=utf-8' };
    case 'md': return { data: markdown, type: 'text/markdown; charset=utf-8' };
  }
}

/** Set a manuscript's paragraph style for downloads. */
export function setBookStyle(docId: string, paragraphStyle: 'spaced' | 'indented'): void {
  const doc = listDocuments().find((d) => d.docId === docId);
  if (!doc || !isManuscript(doc)) throw new BookError('Choose a manuscript.');
  writeMetadata(doc.filename, { manuscriptContext: { paragraphStyle } });
}
