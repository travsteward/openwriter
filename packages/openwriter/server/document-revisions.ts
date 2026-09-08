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

export function createRevision(sourceDocId: string, requestedTitle?: string) {
  const sourceFile = filenameByDocId(sourceDocId);
  const source = sourceFile ? readFrontmatter(sourceFile) : null;
  if (!source) throw new Error('Choose an existing document to create a revision.');
  const sourceType = deriveContentType(source.data) || 'document';
  const isManuscript = sourceType === 'manuscript';
  let body = source.content;
  let sourceTitle = String(source.data.title || 'Untitled');
  if (isManuscript) {
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
  const baseTitle = requestedTitle?.trim() || `${sourceTitle} (Revision)`;
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
    masterDocId: sourceDocId, variantType: 'revision',
    references: [...new Set([sourceDocId, ...references])],
    revisionSourceHash: createHash('sha256').update(body).digest('hex'),
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
  commitFromFile(draft.docId, path, {
    trigger: 'manual', actor: 'unknown', nowTs: Date.now(), note: isManuscript ? 'Original manuscript copy' : 'Original document copy',
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
    ...draft, sourceDocId,
    wordCount: body.trim().split(/\s+/).length,
    chapters,
    readingHint: 'Use outline_doc and peek_doc to read a chapter or passage; read_pad returns only the opening by default.',
  };
}

/** Compatibility name for callers of the former standalone editing-draft action. */
export const createEditingDraft = createRevision;
