/** Shared, pure book-workspace projection. Pins never move tree nodes.
 * adr: adr/book-workspaces.md */
import type { BookMethod, Workspace, WorkspaceNode } from './workspace-types.js';

export interface WorkspaceDocument {
  docId?: string; filename: string; title: string; contentType?: string;
  masterDocId?: string; variantType?: string;
}
export type BookWorkspace = Pick<Workspace, 'root' | 'book' | 'workspaceType'>;
export interface BookWorkspaceUpdate {
  workspaceType?: 'general' | 'book';
  outlineDocId?: string | null;
  manuscriptDocId?: string | null;
  briefDocId?: string | null;
  method?: BookMethod;
}

/** A book without a choice yet is guided step by step. */
export const bookMethod = (workspace: Pick<Workspace, 'book'>): BookMethod => workspace.book?.method ?? 'guided';

export function workspaceDocuments<T extends WorkspaceDocument>(workspace: BookWorkspace, docs: T[]): T[] {
  const files = new Set<string>();
  const visit = (nodes: WorkspaceNode[]) => {
    for (const n of nodes) {
      if (n.type === 'doc') { files.add(n.file); if (n.children) visit(n.children); }
      else visit(n.items);
    }
  };
  visit(workspace.root);
  const ids = new Set(docs.filter(d => files.has(d.filename)).map(d => d.docId));
  // Revisions inherit membership from their master, including nested revisions.
  let added = true;
  while (added) {
    added = false;
    for (const d of docs) if (d.masterDocId && ids.has(d.masterDocId) && !files.has(d.filename)) {
      files.add(d.filename); ids.add(d.docId); added = true;
    }
  }
  return docs.filter(d => files.has(d.filename));
}

export function bookWorkspaceView<T extends WorkspaceDocument>(workspace: BookWorkspace, docs: T[]) {
  const members = workspaceDocuments(workspace, docs);
  const outlines = members.filter(d => d.contentType === 'manuscript' && d.docId);
  const outline = outlines.find(d => d.docId === workspace.book?.outlineDocId) ?? null;
  const manuscripts = outline ? members.filter(d => d.variantType === 'manuscript' && d.masterDocId === outline.docId) : [];
  const manuscript = workspace.book?.manuscriptDocId
    ? manuscripts.find(d => d.docId === workspace.book?.manuscriptDocId) ?? null
    : manuscripts.length === 1 ? manuscripts[0] : null;
  const brief = members.find(d => d.docId === workspace.book?.briefDocId && d.contentType !== 'manuscript' && d.variantType !== 'manuscript') ?? null;
  return { members, outlines, outline, manuscripts, manuscript, brief };
}

/** Validate the complete update before changing even workspace metadata. */
export function configureBookModel(workspace: Workspace, update: BookWorkspaceUpdate, docs: WorkspaceDocument[]): Workspace {
  if (update.workspaceType !== undefined && !['general', 'book'].includes(update.workspaceType)) throw new Error('Choose General or Book.');
  const next = structuredClone(workspace);
  next.workspaceType = update.workspaceType ?? next.workspaceType ?? 'general';
  const book = { ...next.book };
  for (const key of ['outlineDocId', 'manuscriptDocId', 'briefDocId'] as const) {
    if (!(key in update)) continue;
    const id = update[key];
    if (id !== null && (typeof id !== 'string' || !/^[0-9a-f]{8}$/.test(id))) throw new Error(`Choose a valid ${key.replace('DocId', '')} document.`);
    if (id === null) delete book[key]; else book[key] = id;
  }
  if (update.method !== undefined) {
    if (!['guided', 'writer'].includes(update.method)) throw new Error('Choose Guide me step by step or I’ll lead.');
    book.method = update.method;
  }
  next.book = book;
  // Turning behavior off must also work when an attachment was archived/deleted.
  if (next.workspaceType === 'general') return next;
  // Only the explicit conversion infers an unambiguous existing outline.
  let view = bookWorkspaceView(next, docs);
  if (update.workspaceType === 'book' && workspace.workspaceType !== 'book' && !('outlineDocId' in update) && !book.outlineDocId && view.outlines.length === 1) {
    book.outlineDocId = view.outlines[0].docId;
    view = bookWorkspaceView(next, docs);
  }
  if (book.outlineDocId && !view.outline) throw new Error('Choose an outline that belongs to this workspace.');
  if (book.manuscriptDocId && !view.manuscript) throw new Error('Choose a manuscript built from this workspace’s selected outline.');
  if (book.briefDocId && !view.brief) throw new Error('Choose a brief document that belongs to this workspace.');
  if (view.manuscript && !book.manuscriptDocId) book.manuscriptDocId = view.manuscript.docId;
  return next;
}
