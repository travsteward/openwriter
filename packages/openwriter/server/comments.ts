/**
 * Comments: sidecar JSON storage for inline user feedback (formerly "agent marks").
 * Each document gets a sidecar file at DATA_DIR/_marks/{filename}.json.
 * Storage directory name `_marks/` is retained for backwards compatibility with
 * existing user data; the public vocabulary is "comment" everywhere else.
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { getDataDir, ensureDataDir } from './helpers.js';

export interface Comment {
  id: string;
  text: string;
  note: string;
  nodeId: string;
  nodeIds?: string[];
  createdAt: string;
  /** ISO timestamp set when the user/agent marks the comment as addressed.
   *  When set, the comment stays in storage but is filtered out of normal
   *  listings (use `includeResolved: true` to see them). Resolving and
   *  deleting are different actions: resolve = "addressed, archive it";
   *  delete = "remove this record entirely." */
  resolvedAt?: string;
}

interface CommentFile {
  /** The document this sidecar belongs to. The sidecar's own name is lossy
   *  (path separators become `_`), so the doc filename is stored here rather
   *  than reverse-mapped from it. Absent on sidecars written before this field. */
  filename?: string;
  marks: Comment[];
}

function isResolved(c: Comment): boolean {
  return typeof c.resolvedAt === 'string' && c.resolvedAt.length > 0;
}

function getCommentsDir(): string { return join(getDataDir(), '_marks'); }

function ensureCommentsDir(): void {
  ensureDataDir();
  if (!existsSync(getCommentsDir())) mkdirSync(getCommentsDir(), { recursive: true });
}

function commentFilePath(filename: string): string {
  const safe = filename.replace(/[/\\]/g, '_');
  return join(getCommentsDir(), `${safe}.json`);
}

function readCommentFile(filename: string): CommentFile {
  const path = commentFilePath(filename);
  if (!existsSync(path)) return { marks: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { marks: [] };
  }
}

function writeCommentFile(filename: string, data: CommentFile): void {
  ensureCommentsDir();
  writeCommentPath(commentFilePath(filename), { ...data, filename });
}

/** Write a sidecar back to the exact path it was read from. */
function writeCommentPath(path: string, data: CommentFile): void {
  if (data.marks.length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/** The document a sidecar belongs to. Legacy sidecars without a stored
 *  filename fall back to their own name, exact for any top-level doc. */
function sidecarDocFilename(file: string, data: CommentFile): string {
  return data.filename ?? file.replace(/\.json$/, '');
}

export function addComment(filename: string, text: string, note: string, nodeId: string, nodeIds?: string[]): Comment {
  const data = readCommentFile(filename);
  const comment: Comment = {
    id: randomUUID().slice(0, 8),
    text,
    note,
    nodeId,
    ...(nodeIds && nodeIds.length > 1 ? { nodeIds } : {}),
    createdAt: new Date().toISOString(),
  };
  data.marks.push(comment);
  writeCommentFile(filename, data);
  return comment;
}

export interface GetCommentsOptions {
  /** Include comments that have been marked resolved. Default: false. */
  includeResolved?: boolean;
}

export function getComments(filename?: string, opts: GetCommentsOptions = {}): Record<string, Comment[]> {
  const keep = (list: Comment[]) => opts.includeResolved ? list : list.filter((c) => !isResolved(c));

  if (filename) {
    const data = readCommentFile(filename);
    const list = keep(data.marks);
    if (list.length === 0) return {};
    return { [filename]: list };
  }

  ensureCommentsDir();
  const result: Record<string, Comment[]> = {};
  try {
    const files: string[] = readdirSync(getCommentsDir());
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const path = join(getCommentsDir(), file);
      try {
        const data: CommentFile = JSON.parse(readFileSync(path, 'utf-8'));
        const list = keep(data.marks);
        if (list.length > 0) result[sidecarDocFilename(file, data)] = list;
      } catch { /* skip corrupt files */ }
    }
  } catch { /* dir doesn't exist yet */ }
  return result;
}

export function getCommentCount(filename: string): number {
  return readCommentFile(filename).marks.filter((c) => !isResolved(c)).length;
}

/** Count unresolved comments across all documents, optionally excluding one filename. */
export function getGlobalCommentSummary(excludeFilename?: string): { totalComments: number; docCount: number } {
  ensureCommentsDir();
  let totalComments = 0;
  let docCount = 0;
  try {
    const files: string[] = readdirSync(getCommentsDir());
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      if (excludeFilename) {
        const safe = excludeFilename.replace(/[/\\]/g, '_');
        if (file === `${safe}.json`) continue;
      }
      const path = join(getCommentsDir(), file);
      try {
        const data: CommentFile = JSON.parse(readFileSync(path, 'utf-8'));
        const unresolved = data.marks.filter((c) => !isResolved(c));
        if (unresolved.length > 0) {
          totalComments += unresolved.length;
          docCount++;
        }
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist */ }
  return { totalComments, docCount };
}

export function editComment(filename: string, id: string, note: string): Comment | null {
  const data = readCommentFile(filename);
  const comment = data.marks.find((m) => m.id === id);
  if (!comment) return null;
  comment.note = note;
  writeCommentFile(filename, data);
  return comment;
}

/** What an id-based change did: the comment ids it changed, and the docs
 *  they belong to. Callers announce comments-changed for those docs. The
 *  server's live doc is the wrong one to announce: a tab refetches only
 *  for the doc it shows, and the live doc can be another tab's, so its
 *  underlines went stale until reload. */
export interface CommentChange { ids: string[]; filenames: string[] }

/** Apply `change` to every comment in `ids`, across all sidecars. `change`
 *  returns the new mark, null to remove it, or the same mark for no change. */
function changeCommentsById(ids: string[], change: (c: Comment) => Comment | null): CommentChange {
  const idSet = new Set(ids);
  const changed: string[] = [];
  const filenames = new Set<string>();

  ensureCommentsDir();
  try {
    const files: string[] = readdirSync(getCommentsDir());
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(getCommentsDir(), file);
      try {
        const data: CommentFile = JSON.parse(readFileSync(filePath, 'utf-8'));
        let touched = false;
        const marks: Comment[] = [];
        for (const c of data.marks) {
          const next = idSet.has(c.id) ? change(c) : c;
          if (next !== c) { changed.push(c.id); touched = true; }
          if (next) marks.push(next);
        }
        if (touched) {
          data.marks = marks;
          writeCommentPath(filePath, data);
          filenames.add(sidecarDocFilename(file, data));
        }
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist */ }

  return { ids: changed, filenames: [...filenames] };
}

/** Mark comments as resolved (state change, NOT deletion). The records stay
 *  on disk but get filtered out of normal `getComments` listings — so the
 *  decoration disappears in the browser without losing the history. */
export function resolveComments(ids: string[]): CommentChange {
  const now = new Date().toISOString();
  return changeCommentsById(ids, (c) => isResolved(c) ? c : { ...c, resolvedAt: now });
}

/** Clear the resolved state on comments. Inverse of resolveComments. */
export function unresolveComments(ids: string[]): CommentChange {
  return changeCommentsById(ids, (c) => {
    if (!isResolved(c)) return c;
    const { resolvedAt: _, ...rest } = c;
    return rest as Comment;
  });
}

/** Permanently remove comments from the sidecar. Distinct from resolveComments —
 *  resolve is a state change ("addressed, archive it"), delete is the destructive
 *  "this record never should have existed" path. */
export function deleteComments(ids: string[]): CommentChange {
  return changeCommentsById(ids, () => null);
}

export function pruneStaleComments(filename: string, validNodeIds: string[]): number {
  const data = readCommentFile(filename);
  if (data.marks.length === 0) return 0;

  const validSet = new Set(validNodeIds);
  const before = data.marks.length;
  data.marks = data.marks.filter((m) => {
    if (m.nodeIds && m.nodeIds.length > 0) {
      return m.nodeIds.some((id) => validSet.has(id));
    }
    return validSet.has(m.nodeId);
  });
  const pruned = before - data.marks.length;
  if (pruned > 0) writeCommentFile(filename, data);
  return pruned;
}

/** Rename a comment sidecar file when a document is renamed. */
export function renameComments(oldFilename: string, newFilename: string): void {
  const oldPath = commentFilePath(oldFilename);
  if (!existsSync(oldPath)) return;
  // Rewrite rather than rename so the stored doc filename follows the doc.
  const data = readCommentFile(oldFilename);
  unlinkSync(oldPath);
  writeCommentFile(newFilename, data);
}
