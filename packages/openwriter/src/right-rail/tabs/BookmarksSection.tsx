/**
 * Bookmarks section of the Review tab: the user's own markers in the active
 * doc, in reading order, with previous/next stepping like pending changes.
 * adr: adr/bookmarks.md
 */

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useBookmarks, findBookmarkTarget, removeBookmark } from '../../bookmarks/bookmarks-store';
import { jumpToBookmark } from '../../bookmarks/bookmark-plugin';

interface Props {
  editors: Editor[];
  filename: string;
}

const s = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const ChevronUp = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 10l5-5 5 5" stroke="currentColor" {...s} /></svg>;
const ChevronDown = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" {...s} /></svg>;
const XIcon = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" {...s} /></svg>;

export default function BookmarksSection({ editors, filename }: Props) {
  const bookmarks = useBookmarks(filename);
  const [current, setCurrent] = useState(-1);

  useEffect(() => { setCurrent(-1); }, [filename]);

  // Reading order, with a text preview; bookmarks whose paragraph is gone sort last.
  const rows = bookmarks
    .map((b) => ({ bookmark: b, target: findBookmarkTarget(editors, b.nodeId) }))
    .sort((a, b) => (a.target?.pos ?? Infinity) - (b.target?.pos ?? Infinity));

  const go = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setCurrent(index);
    jumpToBookmark(editors, row.bookmark.nodeId);
  };
  const step = (delta: number) => {
    if (rows.length === 0) return;
    const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
    go((base + delta + rows.length) % rows.length);
  };

  return (
    <div className="review-tab__section">
      <div className="review-tab__section-label">Bookmarks</div>
      {rows.length === 0 ? (
        <div className="bookmarks-empty">Right-click a paragraph and choose Add bookmark to mark your place.</div>
      ) : (
        <>
          <div className="review-tab__row">
            <button className="review-panel__btn" onClick={() => step(-1)} title="Previous bookmark"><ChevronUp /></button>
            <button className="review-panel__btn" onClick={() => step(1)} title="Next bookmark"><ChevronDown /></button>
            <span className="review-panel__counter">{current >= 0 ? `${current + 1} / ${rows.length}` : `${rows.length}`}</span>
          </div>
          <ul className="bookmarks-list">
            {rows.map(({ bookmark, target }, i) => (
              <li key={bookmark.id} className={i === current ? 'bookmarks-row bookmarks-row--active' : 'bookmarks-row'}>
                <button
                  type="button"
                  className="bookmarks-row__main"
                  onClick={() => go(i)}
                  disabled={!target}
                  title={target ? 'Jump to bookmark' : 'This paragraph was removed'}
                >
                  <span className="bookmarks-row__note">{bookmark.note || 'Bookmark'}</span>
                  <span className="bookmarks-row__preview">{target ? target.text.slice(0, 90) || '(empty paragraph)' : 'Paragraph removed'}</span>
                </button>
                <button
                  type="button"
                  className="bookmarks-row__remove"
                  onClick={() => removeBookmark(bookmark.id)}
                  title="Remove bookmark"
                  aria-label="Remove bookmark"
                >
                  <XIcon />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
