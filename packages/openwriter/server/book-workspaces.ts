/** Book workspace configuration and its attached brief. No source-document rewrites.
 * adr: adr/book-workspaces.md */
import { createHash } from 'crypto';
import { z } from 'zod';
import { getWorkspace, listWorkspaces, writeWorkspace, addDoc } from './workspaces.js';
import { listDocuments, createDocumentFile, getActiveFilename } from './documents.js';
import { readFrontmatter } from './backlinks.js';
import { parseMarkdownContent } from './compact.js';
import { writeResolvedDocFile, getCanonical, getOverlayEntries } from './state.js';
import { tiptapToBody } from './markdown.js';
import { loadOverlay } from './pending-overlay.js';
import { broadcastDocumentsChanged, broadcastWorkspacesChanged } from './ws.js';
import { createOutline } from './manuscript/outline-info.js';
import { bookWorkspaceView, configureBookModel, type BookWorkspaceUpdate } from './book-workspace-model.js';
import type { ToolDef } from './mcp.js';
import { voiceStatusLine } from './voice/voice-status.js';

export const bookWorkspaceSchema = z.object({
  workspaceType: z.enum(['general', 'book']).optional(),
  outlineDocId: z.string().regex(/^[0-9a-f]{8}$/).nullable().optional(),
  manuscriptDocId: z.string().regex(/^[0-9a-f]{8}$/).nullable().optional(),
  briefDocId: z.string().regex(/^[0-9a-f]{8}$/).nullable().optional(),
}).strict();

export function configureBookWorkspace(filename: string, input: BookWorkspaceUpdate) {
  const update = bookWorkspaceSchema.parse(input);
  const next = configureBookModel(getWorkspace(filename), update, listDocuments());
  writeWorkspace(filename, next);
  broadcastWorkspacesChanged();
  return next;
}

export function createWorkspaceOutline(filename: string) {
  const ws = getWorkspace(filename);
  if (ws.workspaceType !== 'book') throw new Error('Set this workspace’s type to Book first.');
  const view = bookWorkspaceView(ws, listDocuments());
  if (view.outline) return view.outline;
  if (view.outlines.length) throw new Error('This workspace already has an outline. Choose it in Workspace type.');
  const made = createOutline(`${ws.title} — Outline`, filename);
  configureBookWorkspace(filename, { outlineDocId: made.docId });
  return made;
}

const briefSections = ['Purpose and reader promise', 'Audience', 'Voice and form', 'How we work', 'Author decisions', 'Sources and evidence', 'Open questions'];
export function createWorkspaceBrief(filename: string) {
  const ws = getWorkspace(filename);
  if (ws.workspaceType !== 'book') throw new Error('Set this workspace’s type to Book first.');
  const existing = bookWorkspaceView(ws, listDocuments()).brief;
  if (existing) return existing;
  configureBookModel(ws, { briefDocId: null }, listDocuments());
  const made = createDocumentFile(`${ws.title} — Brief`);
  // An empty user-requested scaffold is accepted; agents' later writing uses normal review.
  const body = 'This brief holds the book’s direction and links to its source documents. Unfilled sections are open questions.\n\n'
    + briefSections.map(s => `## ${s}\n\n`).join('');
  writeResolvedDocFile(made.filename, { type: 'doc', content: parseMarkdownContent(body) }, made.title, { title: made.title, docId: made.docId, content_type: 'document' });
  addDoc(filename, null, made.filename, made.title);
  configureBookWorkspace(filename, { briefDocId: made.docId });
  broadcastDocumentsChanged();
  return made;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const acceptedText = (filename: string): string | null => filename === getActiveFilename()
  ? tiptapToBody(getCanonical()).trim() : readFrontmatter(filename)?.content.trim() ?? null;
const pendingCount = (doc: { docId?: string; filename: string }) => doc.filename === getActiveFilename()
  ? getOverlayEntries().length : doc.docId ? loadOverlay(doc.docId).length : 0;

/** Current accepted brief plus revisions of its directly linked sources. Pending prose is never authority. */
export function bookContexts(docId?: string, workspaceFile?: string) {
  const docs = listDocuments();
  const candidates = listWorkspaces().flatMap(info => {
    const ws = getWorkspace(info.filename);
    if (ws.workspaceType !== 'book') return [];
    const view = bookWorkspaceView(ws, docs);
    if (docId && !view.members.some(d => d.docId === docId)) return [];
    if (workspaceFile && info.filename !== workspaceFile) return [];
    if (!docId && !workspaceFile) return [];
    const body = view.brief ? acceptedText(view.brief.filename) ?? '' : '';
    const sourceIds = [...new Set([...body.matchAll(/doc:([0-9a-f]{8})/g)].map(m => m[1]))];
    const sources = sourceIds.map(id => {
      const doc = docs.find(d => d.docId === id);
      const source = doc ? acceptedText(doc.filename) : null;
      return { docId: id, title: doc?.title ?? 'Missing source', revision: source !== null ? digest(source) : 'missing', pendingChanges: doc ? pendingCount(doc) : 0 };
    });
    const compact = (d: typeof view.outline) => d ? { docId: d.docId, title: d.title } : null;
    const context = { workspaceFile: info.filename, title: ws.title, outline: compact(view.outline), manuscript: compact(view.manuscript), brief: compact(view.brief), briefText: body, sources, pendingChanges: view.brief ? pendingCount(view.brief) : 0 };
    return [{ ...context, revision: digest(context), role: docId && docId === view.brief?.docId ? 'brief' : docId && docId === view.outline?.docId ? 'outline' : docId && docId === view.manuscript?.docId ? 'manuscript' : 'source' }];
  });
  return candidates;
}

const deliveredBriefs = new Map<string, Map<string, string>>();
const documentBooks = new Map<string, Map<string, string>>();
export function bookContextGuidance(session: string, contexts: ReturnType<typeof bookContexts>, docId?: string): string | null {
  let documents = documentBooks.get(session);
  if (!documents) documentBooks.set(session, documents = new Map());
  const previousBook = docId ? documents.get(docId) : undefined;
  if (docId) documents.set(docId, contexts.map(c => c.workspaceFile).join(','));
  if (!contexts.length) return previousBook ? '[OpenWriter: this document no longer has a Book workspace context. Earlier book-specific direction is no longer attached; the current document guidance applies.]' : null;
  if (contexts.length > 1) return `[OpenWriter: this document belongs to multiple book workspaces: ${contexts.map(c => `${c.title} (${c.workspaceFile})`).join('; ')}. Use get_item_context with the intended workspaceFile before applying book-specific directions. No book is selected from the active browser tab.]`;
  const context = contexts[0];
  let sent = deliveredBriefs.get(session);
  if (!sent) deliveredBriefs.set(session, sent = new Map());
  const identity = `${context.workspaceFile}:${context.revision}`;
  // The voice changes outside the book (Learn my voice), so its line is read fresh on every touch.
  if (sent.get(context.workspaceFile) === identity) return `[OpenWriter book: ${context.title}; ${context.role}; brief and source revision ${context.revision.slice(0, 12)} unchanged. The attached book context delivered earlier still applies.]\n${voiceStatusLine()}`;
  const changed = sent.has(context.workspaceFile);
  sent.set(context.workspaceFile, identity);
  return [
    `[OpenWriter book context${changed ? ' changed; replaces the earlier snapshot' : ''}: ${context.title}. Role: ${context.role}. Revision: ${context.revision.slice(0, 12)}.]`,
    `Workspace: ${context.workspaceFile}\nOutline: ${JSON.stringify(context.outline)}\nManuscript: ${JSON.stringify(context.manuscript)}\nAttached brief: ${JSON.stringify(context.brief)}`,
    context.brief ? `Accepted brief:\n${context.briefText.trim() || '(empty; direction is not yet recorded)'}` : 'No brief is attached. Book direction is not yet recorded; existing notes are not automatically approved instructions.',
    context.pendingChanges ? `${context.pendingChanges} proposed brief changes await review and are excluded from this accepted snapshot.` : '',
    context.sources.length ? `Linked source revisions (read the relevant documents before writing; missing or proposed material is not settled direction):\n${JSON.stringify(context.sources)}` : '',
    voiceStatusLine(),
  ].filter(Boolean).join('\n\n');
}

export const bookWorkspaceTools: ToolDef[] = [{
  name: 'configure_book_workspace',
  description: 'Set an existing workspace to Book or General and attach its existing outline, manuscript and brief by docId. Preserves every file, folder, pending change and document placement. An unambiguous existing outline/manuscript is reused on conversion; multiple candidates require explicit IDs. General keeps the attachments for a later return to Book. createBrief and createOutline add the empty brief scaffold and the empty outline the Workspace type dialog offers, when the book has none; nothing else is created and no prose is written. A new book starts here: create_workspace, then this with workspaceType "book", createBrief and createOutline.',
  schema: {
    workspaceFile: z.string(),
    ...bookWorkspaceSchema.shape,
    createBrief: z.boolean().optional().describe('Attach a new empty brief (Book type only); an attached brief is kept.'),
    createOutline: z.boolean().optional().describe('Attach a new empty outline (Book type only); an attached outline is kept.'),
  },
  handler: async ({ workspaceFile, createBrief, createOutline, ...update }) => {
    configureBookWorkspace(workspaceFile, update);
    if (createOutline) createWorkspaceOutline(workspaceFile);
    if (createBrief) createWorkspaceBrief(workspaceFile);
    const ws = getWorkspace(workspaceFile);
    return { content: [{ type: 'text', text: JSON.stringify({ workspaceFile, title: ws.title, workspaceType: ws.workspaceType, book: ws.book }) }] };
  },
}];
