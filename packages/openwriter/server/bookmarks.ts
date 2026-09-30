/**
 * Bookmarks: the user's private "where I left off" markers. Sidecar JSON at
 * DATA_DIR/_bookmarks/{filename}.json, one entry per bookmarked paragraph,
 * keyed by nodeId so node identity carries it through edits. Never in the
 * .md file and never exposed to agents.
 * adr: adr/bookmarks.md
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { randomUUID } from 'crypto';
import { getDataDir, ensureDataDir } from './helpers.js';

export interface Bookmark {
  id: string;
  nodeId: string;
  note: string;
  createdAt: string;
}

interface BookmarkFile {
  bookmarks: Bookmark[];
}

function getBookmarksDir(): string { return join(getDataDir(), '_bookmarks'); }

function bookmarkFilePath(filename: string): string {
  const safe = filename.replace(/[/\\]/g, '_');
  return join(getBookmarksDir(), `${safe}.json`);
}

function readBookmarkFile(filename: string): BookmarkFile {
  const path = bookmarkFilePath(filename);
  if (!existsSync(path)) return { bookmarks: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return { bookmarks: Array.isArray(data?.bookmarks) ? data.bookmarks : [] };
  } catch {
    return { bookmarks: [] };
  }
}

function writeBookmarkFile(filename: string, data: BookmarkFile): void {
  const path = bookmarkFilePath(filename);
  if (data.bookmarks.length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  ensureDataDir();
  if (!existsSync(getBookmarksDir())) mkdirSync(getBookmarksDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function getBookmarks(filename: string): Bookmark[] {
  return readBookmarkFile(filename).bookmarks;
}

/** One bookmark per paragraph: bookmarking an already-bookmarked paragraph
 *  updates its note instead of stacking a second icon in the same spot. */
export function addBookmark(filename: string, nodeId: string, note: string): Bookmark {
  const data = readBookmarkFile(filename);
  const existing = data.bookmarks.find((b) => b.nodeId === nodeId);
  if (existing) {
    existing.note = note;
    writeBookmarkFile(filename, data);
    return existing;
  }
  const bookmark: Bookmark = {
    id: randomUUID().slice(0, 8),
    nodeId,
    note,
    createdAt: new Date().toISOString(),
  };
  data.bookmarks.push(bookmark);
  writeBookmarkFile(filename, data);
  return bookmark;
}

export function editBookmark(filename: string, id: string, note: string): Bookmark | null {
  const data = readBookmarkFile(filename);
  const bookmark = data.bookmarks.find((b) => b.id === id);
  if (!bookmark) return null;
  bookmark.note = note;
  writeBookmarkFile(filename, data);
  return bookmark;
}

export function deleteBookmark(filename: string, id: string): boolean {
  const data = readBookmarkFile(filename);
  const before = data.bookmarks.length;
  data.bookmarks = data.bookmarks.filter((b) => b.id !== id);
  if (data.bookmarks.length === before) return false;
  writeBookmarkFile(filename, data);
  return true;
}

/** Carry the sidecar across a document rename. */
export function renameBookmarks(oldFilename: string, newFilename: string): void {
  const oldPath = bookmarkFilePath(oldFilename);
  if (!existsSync(oldPath)) return;
  renameSync(oldPath, bookmarkFilePath(newFilename));
}
