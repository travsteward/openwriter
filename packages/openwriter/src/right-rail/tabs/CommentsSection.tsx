/**
 * Comments in the Review tab: previous/next stepping through the active doc's
 * open comments in reading order, like pending changes. Deliberately no list —
 * the underline's hover popover shows each comment. The one exception is a
 * comment whose words were reworded: it has no underline, so landing on it
 * shows its note and a Resolve button here. Resolved comments (by hand, or
 * by accepting the fix that covered them) sit behind a collapsed "N resolved"
 * toggle, each with Restore.
 * adr: adr/bookmarks.md, adr/comment-auto-resolve.md
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
  const [all, setAll] = useState<CommentData[]>([]);
  const [current, setCurrent] = useState(-1);
  const [showResolved, setShowResolved] = useState(false);
  const comments = all.filter((c) => !c.resolvedAt);
  // Resolved by hand or by accepting a fix; newest first, each restorable.
  const resolved = all
    .filter((c) => c.resolvedAt)
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));

  useEffect(() => {
    let cancelled = false;
    setCurrent(-1);
    setShowResolved(false);
    const load = () => {
      if (!filename) { setAll([]); return; }
      fetch(`/api/comments/${encodeURIComponent(filename)}?resolved=1`)
        .then((r) => r.json())
        .then((data) => { if (!cancelled) setAll(Array.isArray(data.comments) ? data.comments : []); })
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

  const post = (path: 'resolve' | 'unresolve', id: string) => {
    fetch(`/api/comments/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    }).catch((err) => console.error(`[Comments] ${path} failed:`, err));
  };
  const resolve = (id: string) => post('resolve', id);
  const restore = (id: string) => post('unresolve', id);

  const go = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setCurrent(index);
    jumpToBlock(editors, row.nodeId);
  };
  const step = (delta: number) => {
    if (rows.length === 0) return;
    const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
    go((base + delta + rows.length) % rows.length);
  };

  if (rows.length === 0 && resolved.length === 0) return null;
  const currentRow = current >= 0 ? rows[current] : undefined;

  return (
    <div className="review-tab__section">
      <div className="review-tab__section-label">Comments</div>
      {rows.length > 0 && (
        <div className="review-tab__row">
          <button className="review-panel__btn" onClick={() => step(-1)} title="Previous comment"><ChevronUp /></button>
          <button className="review-panel__btn" onClick={() => step(1)} title="Next comment"><ChevronDown /></button>
          <span className="review-panel__counter">{current >= 0 ? `${current + 1} / ${rows.length}` : `${rows.length}`}</span>
        </div>
      )}
      {currentRow?.stale && (
        <div className="comments-stale">
          <span className="comments-stale__text" title={currentRow.comment.note}>
            <em>Wording changed</em> · {currentRow.comment.note || '(no note)'}
          </span>
          <button
            type="button"
            className="comments-stale__resolve"
            onClick={() => { resolve(currentRow.comment.id); setCurrent(-1); }}
            title="Resolve this comment"
          >
            Resolve
          </button>
        </div>
      )}
      {resolved.length > 0 && (
        <button
          type="button"
          className="comments-resolved__toggle"
          onClick={() => setShowResolved((v) => !v)}
          aria-expanded={showResolved}
        >
          {showResolved ? 'Hide resolved' : `${resolved.length} resolved`}
        </button>
      )}
      {showResolved && (
        <ul className="bookmarks-list comments-resolved">
          {resolved.map((c) => (
            <li key={c.id} className="bookmarks-row">
              <div className="bookmarks-row__main comments-resolved__main">
                <span className="bookmarks-row__note">{c.note || '(no note)'}</span>
                <span className="bookmarks-row__preview">{c.text}</span>
              </div>
              <button
                type="button"
                className="comments-stale__resolve comments-resolved__restore"
                onClick={() => restore(c.id)}
                title="Reopen this comment"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
