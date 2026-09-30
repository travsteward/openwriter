/**
 * Renders a bookmark icon in the left margin beside each bookmarked
 * paragraph. Decorations only: the document itself never changes, so
 * bookmarks cannot reach the saved file or an agent.
 * adr: adr/bookmarks.md
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';
import { getBookmarks, subscribeBookmarks, findBlock, type Bookmark } from './bookmarks-store';
import './bookmarks.css';

const bookmarkKey = new PluginKey<DecorationSet>('bookmarkDecoration');

// The block briefly highlighted after a jump. Held here and drawn as a
// decoration, because ProseMirror redraws away classes set on its DOM.
let flashNodeId: string | null = null;
let flashTimer: number | undefined;

/** Scroll a block (bookmarked or commented) to the middle of the view and
 *  flash it. The Review rail's bookmark and comment lists both jump here. */
export function jumpToBlock(editors: Editor[], nodeId: string): boolean {
  const target = findBlock(editors, nodeId);
  if (!target) return false;
  const { view } = target.editor;
  const dom = view.nodeDOM(target.pos) as HTMLElement | null;
  if (!dom || typeof dom.scrollIntoView !== 'function') return false;
  dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const redraw = () => { if (!(view as any).isDestroyed) view.dispatch(view.state.tr.setMeta(bookmarkKey, true).setMeta('addToHistory', false)); };
  // Clear first so a repeat jump restarts the animation.
  flashNodeId = null;
  redraw();
  void (view.nodeDOM(target.pos) as HTMLElement | null)?.offsetWidth;
  flashNodeId = nodeId;
  redraw();
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { flashNodeId = null; redraw(); }, 1600);
  return true;
}

const ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 1.5h8a1 1 0 0 1 1 1v12.2a.5.5 0 0 1-.8.4L8 12l-4.2 3.1a.5.5 0 0 1-.8-.4V2.5a1 1 0 0 1 1-1z"/></svg>';

function renderIcon(bookmark: Bookmark): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ow-bookmark-icon';
  el.contentEditable = 'false';
  el.dataset.bookmarkId = bookmark.id;
  el.title = bookmark.note || 'Bookmark';
  el.innerHTML = ICON;
  // Keep the cursor where it is; the click opens the note editor instead.
  el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('ow-bookmark-open', {
      detail: { id: bookmark.id, x: e.clientX, y: e.clientY },
    }));
  });
  return el;
}

function build(doc: any): DecorationSet {
  const list = getBookmarks();
  if (list.length === 0 && !flashNodeId) return DecorationSet.empty;
  const byNode = new Map(list.map((b) => [b.nodeId, b]));
  const decorations: Decoration[] = [];
  doc.descendants((node: any, pos: number) => {
    const id = node.isTextblock ? node.attrs?.id : undefined;
    if (!id) return true;
    const bookmark = byNode.get(id);
    const classes = [bookmark ? 'ow-bookmarked' : '', id === flashNodeId ? 'ow-bookmark-flash' : ''].filter(Boolean).join(' ');
    if (classes) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: classes }));
    if (bookmark) {
      decorations.push(Decoration.widget(pos + 1, () => renderIcon(bookmark), {
        side: -1,
        ignoreSelection: true,
        key: `bookmark-${bookmark.id}-${bookmark.note}`,
      }));
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

export const Bookmarks = Extension.create({
  name: 'bookmarks',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: bookmarkKey,
        state: {
          init: (_, state) => build(state.doc),
          apply(tr, old, _oldState, newState) {
            if (tr.docChanged || tr.getMeta(bookmarkKey)) return build(newState.doc);
            return old;
          },
        },
        props: {
          decorations(state) { return bookmarkKey.getState(state); },
        },
        view(view) {
          const unsubscribe = subscribeBookmarks(() => {
            if ((view as any).isDestroyed) return;
            view.dispatch(view.state.tr.setMeta(bookmarkKey, true).setMeta('addToHistory', false));
          });
          return { destroy: unsubscribe };
        },
      }),
    ];
  },
});
