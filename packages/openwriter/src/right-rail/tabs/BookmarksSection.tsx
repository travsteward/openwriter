/**
 * Bookmarks in the Review tab. Bookmarks are few, so there is no stepping:
 * BookmarkReturn is the one-click jump to the newest bookmark at the top of
 * the panel, and BookmarksSection is the short list further down.
 * adr: adr/bookmarks.md
 */

import type { Editor } from '@tiptap/react';
import { useBookmarks, findBlock, removeBookmark } from '../../bookmarks/bookmarks-store';
import { jumpToBlock } from '../../bookmarks/bookmark-plugin';

interface Props {
  editors: Editor[];
  filename: string;
}

const s = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const XIcon = () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" {...s} /></svg>;
const BookmarkIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 1.5h8a1 1 0 0 1 1 1v12.2a.5.5 0 0 1-.8.4L8 12l-4.2 3.1a.5.5 0 0 1-.8-.4V2.5a1 1 0 0 1 1-1z" /></svg>;

/** One-click return to the most recently placed bookmark. Hidden when none. */
export function BookmarkReturn({ editors, filename }: Props) {
  const bookmarks = useBookmarks(filename);
  const latest = bookmarks.reduce<typeof bookmarks[number] | null>(
    (a, b) => (!a || b.createdAt > a.createdAt ? b : a), null);
  if (!latest || !findBlock(editors, latest.nodeId)) return null;
  return (
    <div className="review-tab__section bookmark-return-section">
      <button
        type="button"
        className="bookmark-return"
        onClick={() => jumpToBlock(editors, latest.nodeId)}
        title={latest.note || 'Jump to your latest bookmark'}
      >
        <BookmarkIcon />
        <span className="bookmark-return__label">Back to bookmark</span>
        {latest.note && <span className="bookmark-return__note">{latest.note}</span>}
      </button>
    </div>
  );
}

export default function BookmarksSection({ editors, filename }: Props) {
  const bookmarks = useBookmarks(filename);

  // Reading order, with a text preview; bookmarks whose paragraph is gone sort last.
  const rows = bookmarks
    .map((b) => ({ bookmark: b, target: findBlock(editors, b.nodeId) }))
    .sort((a, b) => (a.target?.pos ?? Infinity) - (b.target?.pos ?? Infinity));

  return (
    <div className="review-tab__section">
      <div className="review-tab__section-label">Bookmarks</div>
      {rows.length === 0 ? (
        <div className="bookmarks-empty">Right-click a paragraph and choose Add bookmark to mark your place.</div>
      ) : (
        <ul className="bookmarks-list">
          {rows.map(({ bookmark, target }) => (
            <li key={bookmark.id} className="bookmarks-row">
              <button
                type="button"
                className="bookmarks-row__main"
                onClick={() => jumpToBlock(editors, bookmark.nodeId)}
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
      )}
    </div>
  );
}
