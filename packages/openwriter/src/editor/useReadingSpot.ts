/**
 * Reading spot: a page refresh comes back to where the user was. The tab
 * keeps the block at the top of the view, the cursor's block and offset, and
 * whether the text had focus, keyed by doc. On the page's first doc load, if
 * it is the doc the tab showed before, the view, cursor and focus come back.
 * Blocks are found by id, so the spot survives text changes above it.
 * Per-tab (sessionStorage): a new tab or a link opens docs as before.
 */

import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

const KEY = 'ow-reading-spot';

interface Spot {
  docId: string;
  topId?: string;
  topDelta?: number;
  cursorId?: string;
  cursorOffset?: number;
  focused?: boolean;
}

/** Only the page's first doc load restores. */
let firstLoadDone = false;
/** Set while the restored doc stays open, so the page's other landing
 *  scrolls (top of a doc opened by URL, first pending change) stay out. */
let spotRestored = false;

export function isSpotRestored(): boolean {
  return spotRestored;
}

function readSpot(): Spot | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}

function writeSpot(spot: Spot): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(spot)); } catch { /* storage unavailable */ }
}

/** Position of the block with this id, or -1. */
function blockPos(editor: Editor, id: string): number {
  let found = -1;
  editor.state.doc.descendants((node: any, pos: number) => {
    if (found >= 0) return false;
    if (node.attrs?.id === id) { found = pos; return false; }
    return true;
  });
  return found;
}

function captureSpot(editor: Editor, container: HTMLElement, docId: string): Spot {
  const spot: Spot = { docId, focused: editor.view.hasFocus() };
  const top = container.getBoundingClientRect().top;
  for (const el of Array.from(editor.view.dom.children) as HTMLElement[]) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= top) continue;
    try {
      const node = editor.state.doc.resolve(editor.view.posAtDOM(el, 0)).node(1);
      if (node?.attrs?.id) { spot.topId = node.attrs.id; spot.topDelta = rect.top - top; }
    } catch { /* not a document block */ }
    break;
  }
  const { $head } = editor.state.selection;
  if ($head.parent.isTextblock && $head.parent.attrs?.id) {
    spot.cursorId = $head.parent.attrs.id;
    spot.cursorOffset = $head.parentOffset;
  }
  return spot;
}

function restoreSpot(editor: Editor, container: HTMLElement, spot: Spot): void {
  if (spot.cursorId) {
    const pos = blockPos(editor, spot.cursorId);
    const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null;
    if (node?.isTextblock) {
      const at = pos + 1 + Math.min(spot.cursorOffset ?? 0, node.content.size);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)).setMeta('addToHistory', false));
      if (spot.focused) editor.view.focus();
    }
  }
  if (spot.topId) {
    const pos = blockPos(editor, spot.topId);
    const dom = pos >= 0 ? editor.view.nodeDOM(pos) : null;
    if (dom instanceof HTMLElement) {
      container.scrollTop += dom.getBoundingClientRect().top - container.getBoundingClientRect().top - (spot.topDelta ?? 0);
    }
  }
  spotRestored = true;
}

export function useReadingSpot(editor: Editor | null, docId: string | undefined): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed || !docId) return;
    const container = editor.view.dom.closest('.editor-container') as HTMLElement | null;
    if (!container) return;

    if (!firstLoadDone) {
      firstLoadDone = true;
      const saved = readSpot();
      if (saved?.docId === docId) restoreSpot(editor, container, saved);
    } else {
      spotRestored = false;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => writeSpot(captureSpot(editor, container, docId));
    const saveSoon = () => { clearTimeout(timer); timer = setTimeout(save, 200); };
    container.addEventListener('scroll', saveSoon, { passive: true });
    editor.on('selectionUpdate', saveSoon);
    editor.on('focus', saveSoon);
    editor.on('blur', saveSoon);
    window.addEventListener('pagehide', save);
    return () => {
      clearTimeout(timer);
      container.removeEventListener('scroll', saveSoon);
      editor.off('selectionUpdate', saveSoon);
      editor.off('focus', saveSoon);
      editor.off('blur', saveSoon);
      window.removeEventListener('pagehide', save);
    };
  }, [editor, docId]);
}
