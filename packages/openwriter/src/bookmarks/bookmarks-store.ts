/**
 * Client store for the active doc's bookmarks. One module-level list shared
 * by the right-click menu, the margin icons, and the Review rail section.
 * Loads when the active filename changes and refetches on the
 * `bookmarks-changed` broadcast for that file.
 * adr: adr/bookmarks.md
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';

export interface Bookmark {
  id: string;
  nodeId: string;
  note: string;
  createdAt: string;
}

let currentFile = '';
let bookmarks: Bookmark[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function load(filename: string): void {
  fetch(`/api/bookmarks/${encodeURIComponent(filename)}`)
    .then((r) => r.json())
    .then((data) => {
      if (filename !== currentFile) return;
      bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
      emit();
    })
    .catch(() => {});
}

function setBookmarkFile(filename: string): void {
  if (filename === currentFile) return;
  currentFile = filename;
  bookmarks = [];
  emit();
  if (filename) load(filename);
}

window.addEventListener('ow-bookmarks-changed', (e) => {
  const filename = (e as CustomEvent).detail?.filename;
  if (currentFile && filename === currentFile) load(currentFile);
});

export function getBookmarks(): Bookmark[] {
  return bookmarks;
}

export function subscribeBookmarks(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Bookmarks for `filename`; also makes it the store's active file. */
export function useBookmarks(filename: string): Bookmark[] {
  useEffect(() => { setBookmarkFile(filename); }, [filename]);
  return useSyncExternalStore(subscribeBookmarks, getBookmarks);
}

function send(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, string>): void {
  const filename = currentFile;
  if (!filename) return;
  fetch('/api/bookmarks', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, ...body }),
  })
    .then(() => load(filename))
    .catch((err) => console.error('[Bookmarks] request failed:', err));
}

export function addBookmark(nodeId: string, note: string): void { send('POST', { nodeId, note }); }
export function editBookmark(id: string, note: string): void { send('PATCH', { id, note }); }
export function removeBookmark(id: string): void { send('DELETE', { id }); }

/** Locate a block by node ID in whichever editor holds it. */
export function findBlock(editors: Editor[], nodeId: string): { editor: Editor; pos: number; text: string } | null {
  for (const editor of editors) {
    if (!editor || editor.isDestroyed) continue;
    let found: { editor: Editor; pos: number; text: string } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.attrs?.id === nodeId) {
        found = { editor, pos, text: node.textContent };
        return false;
      }
      return true;
    });
    if (found) return found;
  }
  return null;
}
