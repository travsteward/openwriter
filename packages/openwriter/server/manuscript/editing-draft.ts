/** Independent, accepted copy of a compiled manuscript. adr: adr/manuscript-engine.md */
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { filenameByDocId, createDocumentFile } from '../documents.js';
import { readFrontmatter, invalidateBacklinksCache } from '../backlinks.js';
import { parseMarkdownContent } from '../compact.js';
import { tiptapToMarkdownChecked } from '../markdown.js';
import { atomicWriteFileSync, resolveDocPath, filePathForTitle } from '../helpers.js';
import { unmarkAgentStub, invalidateDocCache, type PadDocument } from '../state.js';
import { commitFromFile } from '../commits.js';
import { captureAttribution } from '../attribution.js';
import { tiptapToBlocks } from '../node-blocks.js';
import { findWorkspacesContainingDoc, getWorkspace, addDoc } from '../workspaces.js';
import { findDocNode } from '../workspace-tree.js';
import { broadcastDocumentsChanged, broadcastWorkspacesChanged } from '../ws.js';
import { compileManuscript } from './index.js';
import { loadManifest } from './load.js';

export function createEditingDraft(sourceDocId: string, requestedTitle?: string) {
  const sourceFile = filenameByDocId(sourceDocId);
  const source = sourceFile ? readFrontmatter(sourceFile) : null;
  if (!source || source.data.content_type !== 'manuscript') {
    throw new Error('Choose a manuscript to create an editing draft.');
  }
  const manuscript = loadManifest(sourceDocId)!;
  const compiled = compileManuscript(manuscript.body, manuscript.meta);
  if (compiled.warnings.length) {
    throw new Error(`The manuscript could not be copied completely: ${compiled.warnings.join('; ')}`);
  }
  if (!compiled.markdown.trim()) throw new Error('The manuscript has no content to copy.');

  const document: PadDocument = { type: 'doc', content: parseMarkdownContent(compiled.markdown) };
  const baseTitle = requestedTitle?.trim() || `${compiled.meta.title} — Editing draft`;
  let title = baseTitle;
  for (let number = 2; existsSync(filePathForTitle(title)); number++) title = `${baseTitle} ${number}`;
  const extraMeta = {
    content_type: 'document', status: 'draft', autoAccept: false,
    references: [sourceDocId],
    editingDraft: {
      sourceDocId, sourceTitle: source.data.title,
      createdAt: new Date().toISOString(),
      sourceHash: createHash('sha256').update(compiled.markdown).digest('hex'),
    },
  };
  // Check the copy before creating a file. No source identity, review settings,
  // pending proposals, or live pointers are inherited into its editable body.
  const checked = tiptapToMarkdownChecked(document, title, extraMeta);
  if (!checked.syncReport.ok) throw new Error('The manuscript could not be copied without changing its structure.');

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
    trigger: 'manual', actor: 'unknown', nowTs: Date.now(), note: 'Original manuscript copy',
  });

  const workspace = findWorkspacesContainingDoc(sourceFile!)[0];
  if (workspace) {
    const location = findDocNode(getWorkspace(workspace.filename).root, sourceFile!);
    const parentId = location && !Array.isArray(location.parent) ? location.parent.id : null;
    addDoc(workspace.filename, parentId, draft.filename, title, sourceFile);
    broadcastWorkspacesChanged();
  }
  invalidateBacklinksCache();
  broadcastDocumentsChanged();
  const chapters = document.content
    .filter((node: any) => node.type === 'heading' && node.attrs?.level === 1)
    .map((node: any) => ({ nodeId: node.attrs.id, title: node.content?.map((part: any) => part.text || '').join('') || '' }));
  return {
    ...draft, sourceDocId,
    wordCount: compiled.markdown.trim().split(/\s+/).length,
    chapters,
    readingHint: 'Use outline_doc and peek_doc to read a chapter or passage; read_pad returns only the opening by default.',
  };
}
