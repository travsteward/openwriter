/**
 * Comments in the Review tab: every open comment on the active doc in reading
 * order, with previous/next stepping like pending changes. Navigation only;
 * editing and resolving stay on the in-editor comment menu and popover.
 * adr: adr/bookmarks.md
 */

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { locateComment, type CommentData } from '../../decorations/comments-plugin';
import { findBlock } from '../../bookmarks/bookmarks-store';
import { jumpToBlock } from '../../bookmarks/bookmark-plugin';

interface Props {
  editors: Editor[];
  filename: string;
}

const s = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const ChevronUp = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 10l5-5 5 5" stroke="currentColor" {...s} /></svg>;
const ChevronDown = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" {...s} /></svg>;

export default function CommentsSection({ editors, filename }: Props) {
  const [comments, setComments] = useState<CommentData[]>([]);
  const [current, setCurrent] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    setCurrent(-1);
    const load = () => {
      if (!filename) { setComments([]); return; }
      fetch(`/api/comments/${encodeURIComponent(filename)}`)
        .then((r) => r.json())
        .then((data) => { if (!cancelled) setComments(Array.isArray(data.comments) ? data.comments : []); })
        .catch(() => {});
    };
    load();
    const handler = (e: Event) => { if ((e as CustomEvent).detail?.filename === filename) load(); };
    window.addEventListener('ow-comments-changed', handler);
    return () => { cancelled = true; window.removeEventListener('ow-comments-changed', handler); };
  }, [filename]);

  // Reading order: block position, then where the quoted text sits in it.
  // A comment is "placed" exactly when the editor underlines it. One whose
  // words were edited away is stale: it jumps to its paragraph if that still
  // exists, and can only be resolved from here since it has no underline.
  const rows = comments
    .map((c) => {
      for (const editor of editors) {
        if (!editor || editor.isDestroyed) continue;
        const from = locateComment(editor.state.doc, c);
        if (from === null) continue;
        const nodeId = editor.state.doc.resolve(from).parent.attrs?.id ?? c.nodeId;
        return { comment: c, nodeId, target: true, stale: false, order: from };
      }
      const nodeId = c.nodeIds?.[0] ?? c.nodeId;
      const block = findBlock(editors, nodeId);
      return { comment: c, nodeId, target: !!block, stale: true, order: block ? block.pos : Infinity };
    })
    .sort((a, b) => a.order - b.order);

  const resolve = (id: string) => {
    fetch('/api/comments/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    }).catch((err) => console.error('[Comments] resolve failed:', err));
  };

  const go = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setCurrent(index);
    jumpToBlock(editors, row.nodeId);
    // Keep the active row visible in the capped-height list.
    requestAnimationFrame(() => document.querySelector('.comments-list .bookmarks-row--active')?.scrollIntoView({ block: 'nearest' }));
  };
  const step = (delta: number) => {
    if (rows.length === 0) return;
    const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
    go((base + delta + rows.length) % rows.length);
  };

  if (rows.length === 0) return null;

  return (
    <div className="review-tab__section">
      <div className="review-tab__section-label">Comments</div>
      <div className="review-tab__row">
        <button className="review-panel__btn" onClick={() => step(-1)} title="Previous comment"><ChevronUp /></button>
        <button className="review-panel__btn" onClick={() => step(1)} title="Next comment"><ChevronDown /></button>
        <span className="review-panel__counter">{current >= 0 ? `${current + 1} / ${rows.length}` : `${rows.length}`}</span>
      </div>
      <ul className="bookmarks-list comments-list">
        {rows.map(({ comment, target, stale }, i) => (
          <li key={comment.id} className={`bookmarks-row${i === current ? ' bookmarks-row--active' : ''}${stale ? ' comments-row--stale' : ''}`}>
            <button
              type="button"
              className="bookmarks-row__main"
              onClick={() => go(i)}
              disabled={!target}
              title={!target ? 'The commented paragraph was removed' : stale ? 'The commented words were changed; jumps to the paragraph' : 'Jump to comment'}
            >
              <span className="bookmarks-row__note">{comment.note || '(no note)'}</span>
              <span className="bookmarks-row__preview">
                {stale && <span className="comments-row__stale-tag">Wording changed · </span>}
                “{comment.text.replace(/\s+/g, ' ').trim()}”
              </span>
            </button>
            {stale && (
              <button
                type="button"
                className="comments-row__resolve"
                onClick={() => resolve(comment.id)}
                title="Resolve this comment"
              >
                Resolve
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
