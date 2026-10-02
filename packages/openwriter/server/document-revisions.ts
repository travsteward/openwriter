/** Accepted-text revisions use the existing variant relationship.
 * adr: adr/document-variants.md
 * adr: adr/manuscript-engine.md
 */
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { filenameByDocId, createDocumentFile } from './documents.js';
import { readFrontmatter, invalidateBacklinksCache } from './backlinks.js';
import { parseMarkdownContent } from './compact.js';
import { tiptapToMarkdownChecked } from './markdown.js';
import { atomicWriteFileSync, resolveDocPath, filePathForTitle } from './helpers.js';
import { unmarkAgentStub, invalidateDocCache, type PadDocument } from './state.js';
import { commitFromFile } from './commits.js';
import { captureAttribution } from './attribution.js';
import { tiptapToBlocks } from './node-blocks.js';
import { broadcastDocumentsChanged, broadcastWorkspacesChanged } from './ws.js';
import { deriveContentType, resolveTypeMeta } from './content-type-meta.js';
import { compileManuscript } from './manuscript/index.js';
import { loadManifest } from './manuscript/load.js';
import { BookError, manuscriptsOf, outlineChapters, recordChapters, bookSettings } from './manuscript/book.js';

/**
 * Copy a document's accepted text into a new child. An ordinary document gets
 * a Revision. A book outline gets its Manuscript: the compiled full text,
 * which is the book from then on. A second manuscript needs `confirm`.
 */
export function createRevision(sourceDocId: string, requestedTitle?: string, opts: { confirm?: boolean } = {}) {
  const sourceFile = filenameByDocId(sourceDocId);
  const source = sourceFile ? readFrontmatter(sourceFile) : null;
  if (!source) throw new Error('Choose an existing document to create a revision.');
  const sourceType = deriveContentType(source.data) || 'document';
  const isManuscript = sourceType === 'manuscript';
  let body = source.content;
  let sourceTitle = String(source.data.title || 'Untitled');
  if (isManuscript) {
    const existing = manuscriptsOf(sourceDocId)[0];
    if (existing && !opts.confirm) {
      throw new BookError(`This outline already has a manuscript: "${existing.title}". Open it, or confirm to build another.`, 409, existing);
    }
    const manuscript = loadManifest(sourceDocId)!;
    const compiled = compileManuscript(manuscript.body, manuscript.meta);
    if (compiled.warnings.length) {
      throw new Error(`The manuscript could not be copied completely: ${compiled.warnings.join('; ')}`);
    }
    body = compiled.markdown;
    sourceTitle = compiled.meta.title || sourceTitle;
  }
  if (!body.trim()) throw new Error('The document has no content to copy.');

  const document: PadDocument = { type: 'doc', content: parseMarkdownContent(body) };
  const baseTitle = requestedTitle?.trim() || (isManuscript ? `${sourceTitle} — Manuscript` : `${sourceTitle} (Revision)`);
  let title = baseTitle;
  for (let number = 2; existsSync(filePathForTitle(title)); number++) title = `${baseTitle} ${number}`;
  const type = isManuscript ? 'document' : sourceType;
  const typeMeta = resolveTypeMeta(type) || {};
  // Preserve the format's writing fields, not unrelated format contexts or
  // document identity/history. Review and status always belong to this revision.
  for (const key of Object.keys(typeMeta)) {
    if (key.endsWith('Context') && source.data[key]) typeMeta[key] = structuredClone(source.data[key]);
  }
  const references = Array.isArray(source.data.references) ? source.data.references.filter((id: unknown) => typeof id === 'string') : [];
  const extraMeta = {
    ...typeMeta, content_type: type, status: 'draft', autoAccept: false,
    masterDocId: sourceDocId, variantType: isManuscript ? 'manuscript' : 'revision',
    references: [...new Set([sourceDocId, ...references])],
    revisionSourceHash: createHash('sha256').update(body).digest('hex'),
    // The manuscript carries the book's download settings and which outline
    // chapters it holds. adr: adr/manuscript-engine.md
    ...(isManuscript ? {
      manuscriptContext: bookSettings(source.data),
      manuscriptChapters: recordChapters(outlineChapters(source.content), document),
    } : {}),
  };
  // Check the copy before creating a file. No source identity, review settings,
  // pending proposals, or live pointers are inherited into its editable body.
  const checked = tiptapToMarkdownChecked(document, title, extraMeta);
  if (!checked.syncReport.ok) throw new Error('The document could not be copied without changing its structure.');

  const draft = createDocumentFile(title, undefined, extraMeta);
  const metadata = { ...extraMeta, docId: draft.docId, title };
  const serialized = tiptapToMarkdownChecked(document, title, metadata);
  const path = resolveDocPath(draft.filename);
  atomicWriteFileSync(path, serialized.markdown);
  unmarkAgentStub(draft.filename);
  invalidateDocCache(path);
  // A visible, restorable baseline in the existing Versions panel. Copying
  // existing prose does not claim that the agent or human authored it anew.
  captureAttribution(draft.docId, tiptapToBlocks(document), 'unknown', Date.now());
  // A named version, so it never ages out (versions.ts pruneVersions).
  const built = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  commitFromFile(draft.docId, path, {
    trigger: 'manual', actor: 'unknown', nowTs: Date.now(), note: isManuscript ? `Built from outline, ${built}` : 'Original document copy',
  });

  // The existing variant tree discovers children by masterDocId. Adding an
  // explicit workspace row would create an unwanted standalone duplicate.
  broadcastWorkspacesChanged();
  invalidateBacklinksCache();
  broadcastDocumentsChanged();
  const chapters = document.content
    .filter((node: any) => node.type === 'heading' && node.attrs?.level === 1)
    .map((node: any) => ({ nodeId: node.attrs.id, title: node.content?.map((part: any) => part.text || '').join('') || '' }));
  return {
    ...draft, sourceDocId, variantType: extraMeta.variantType,
    wordCount: body.trim().split(/\s+/).length,
    chapters,
    readingHint: 'Use outline_doc and peek_doc to read a chapter or passage; read_pad returns only the opening by default.',
  };
}

/** Compatibility name for callers of the former standalone editing-draft action. */
export const createEditingDraft = createRevision;
