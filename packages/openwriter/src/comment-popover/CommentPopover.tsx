/**
 * CommentPopover — hover-anchored popover for inline comments.
 *
 * Behavior:
 *  - Mouse enters a `[data-comment-id]` span → popover appears anchored above
 *    (or below, if no room above) the span, showing the comment's note.
 *  - Every comment under the mouse stacks as a card: the same words, or a
 *    sentence comment nested inside a longer one. Comments elsewhere in the
 *    paragraph don't show.
 *  - Each card has four icon actions: Edit, Add (new sibling on same range),
 *    Resolve (state change), Delete (destructive).
 *  - Mouse leaves the span OR the popover → close after a short grace period.
 *  - Close immediately on scroll (popover is fixed-positioned and would
 *    otherwise float free) unless mid-edit.
 *
 * Right-click on a comment still works — that menu is the keyboard-driven
 * surface. The popover is the mouse-driven one.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCommentsData, type CommentData } from '../decorations/comments-plugin';

interface PopoverTarget {
  commentIds: string[];
  rect: DOMRect;
}

interface CommentPopoverProps {
  documentId?: string;
}

type Mode =
  | { kind: 'view' }
  | { kind: 'edit'; commentId: string }
  | { kind: 'compose'; parentCommentId: string };

const HIDE_GRACE_MS = 80;
const POPOVER_GAP_PX = 8;
const VIEWPORT_PAD_PX = 8;
const MAX_HEIGHT_PX = 400;

/** Ids of every comment covering the hovered text. Each comment renders its
 *  own span, so overlapping comments nest; walk out from the innermost. */
function commentIdsAt(span: Element): string[] {
  const ids: string[] = [];
  for (let el: Element | null = span; el; el = el.parentElement?.closest('[data-comment-id]') ?? null) {
    const id = el.getAttribute('data-comment-id');
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The comments under the mouse, sorted oldest-first. */
function stackFor(ids: string[], all: CommentData[]): CommentData[] {
  return all
    .filter((c) => ids.includes(c.id))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export default function CommentPopover({ documentId }: CommentPopoverProps) {
  const [target, setTarget] = useState<PopoverTarget | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [noteDraft, setNoteDraft] = useState('');
  // Bumps whenever a `ow-comments-changed` WS event fires. Forces a re-render
  // so the popover picks up newly-added siblings or removed cards.
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; placement: 'above' | 'below' }>({ left: 0, top: 0, placement: 'above' });
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hideTimer = useRef<number | null>(null);
  const targetRef = useRef<PopoverTarget | null>(null);
  const modeRef = useRef<Mode>({ kind: 'view' });

  useEffect(() => { targetRef.current = target; }, [target]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Subscribe to comments-changed so the popover refreshes when siblings get
  // added/resolved/deleted without re-hovering.
  useEffect(() => {
    const handler = () => setCommentsVersion((v) => v + 1);
    window.addEventListener('ow-comments-changed', handler);
    return () => window.removeEventListener('ow-comments-changed', handler);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      if (modeRef.current.kind !== 'view') return; // don't yank an edit/compose surface
      setTarget(null);
    }, HIDE_GRACE_MS);
  }, [cancelHide]);

  const closeNow = useCallback(() => {
    cancelHide();
    setTarget(null);
    setMode({ kind: 'view' });
    setNoteDraft('');
  }, [cancelHide]);

  // The stack of comments to render. Empty when nothing is hovered or the
  // anchor comment vanished (e.g. user deleted it from another surface).
  const stack = useMemo<CommentData[]>(() => {
    if (!target) return [];
    return stackFor(target.commentIds, getCommentsData());
    // commentsVersion in deps so we recompute when comments change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, commentsVersion]);

  // If our anchor disappears (resolved/deleted), close the popover.
  useEffect(() => {
    if (target && stack.length === 0) {
      closeNow();
    }
  }, [target, stack.length, closeNow]);

  // Position the popover. Prefer above; flip below if no room. Clamp to viewport.
  useLayoutEffect(() => {
    if (!target) return;
    const pop = popoverRef.current;
    if (!pop) return;
    const popRect = pop.getBoundingClientRect();
    const { rect } = target;
    const roomAbove = rect.top;
    const roomBelow = window.innerHeight - rect.bottom;
    const placement: 'above' | 'below' =
      roomAbove >= popRect.height + POPOVER_GAP_PX || roomAbove >= roomBelow ? 'above' : 'below';

    const top = placement === 'above'
      ? Math.max(VIEWPORT_PAD_PX, rect.top - popRect.height - POPOVER_GAP_PX)
      : Math.min(window.innerHeight - popRect.height - VIEWPORT_PAD_PX, rect.bottom + POPOVER_GAP_PX);

    let left = rect.left;
    if (left + popRect.width > window.innerWidth - VIEWPORT_PAD_PX) {
      left = window.innerWidth - popRect.width - VIEWPORT_PAD_PX;
    }
    if (left < VIEWPORT_PAD_PX) left = VIEWPORT_PAD_PX;

    setPosition({ left, top, placement });
  }, [target, mode, stack.length, commentsVersion]);

  useEffect(() => {
    const handleOver = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const span = t?.closest?.('[data-comment-id]') as HTMLElement | null;
      if (span) {
        const ids = commentIdsAt(span);
        if (ids.length === 0) return;
        if (targetRef.current?.commentIds.join(',') === ids.join(',')) {
          cancelHide();
          return;
        }
        cancelHide();
        setMode({ kind: 'view' });
        setNoteDraft('');
        setTarget({ commentIds: ids, rect: span.getBoundingClientRect() });
        return;
      }
      if (popoverRef.current?.contains(t)) {
        cancelHide();
        return;
      }
      if (targetRef.current) scheduleHide();
    };

    const handleOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Element | null;
      if (related && popoverRef.current?.contains(related)) {
        cancelHide();
        return;
      }
      if (related && related.closest?.('[data-comment-id]')) return;
      if (targetRef.current) scheduleHide();
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!targetRef.current) return;
      e.preventDefault();
      // Esc from edit/compose returns to view; Esc from view closes
      if (modeRef.current.kind !== 'view') {
        setMode({ kind: 'view' });
        setNoteDraft('');
        return;
      }
      closeNow();
    };

    const handleScroll = (e: Event) => {
      if (!targetRef.current) return;
      if (modeRef.current.kind !== 'view') return;
      if (popoverRef.current?.contains(e.target as Node)) return;
      closeNow();
    };

    document.addEventListener('mouseover', handleOver);
    document.addEventListener('mouseout', handleOut);
    document.addEventListener('keydown', handleKey);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mouseover', handleOver);
      document.removeEventListener('mouseout', handleOut);
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('scroll', handleScroll, true);
      cancelHide();
    };
  }, [cancelHide, scheduleHide, closeNow]);

  useEffect(() => {
    if (mode.kind !== 'view') textareaRef.current?.focus();
  }, [mode]);

  const startEdit = useCallback((commentId: string) => {
    const c = getCommentsData().find((c) => c.id === commentId);
    if (!c) return;
    setNoteDraft(c.note || '');
    setMode({ kind: 'edit', commentId });
  }, []);

  const startCompose = useCallback((parentCommentId: string) => {
    setNoteDraft('');
    setMode({ kind: 'compose', parentCommentId });
  }, []);

  const cancelDraft = useCallback(() => {
    setMode({ kind: 'view' });
    setNoteDraft('');
  }, []);

  const saveEdit = useCallback(() => {
    if (mode.kind !== 'edit' || !documentId) return;
    fetch('/api/comments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: documentId, id: mode.commentId, note: noteDraft.trim() }),
    })
      .then(() => {
        // After save, drop back to view mode so user sees the updated stack
        setMode({ kind: 'view' });
        setNoteDraft('');
      })
      .catch((err) => console.error('[CommentPopover] Save failed:', err));
  }, [mode, documentId, noteDraft]);

  const saveCompose = useCallback(() => {
    if (mode.kind !== 'compose' || !documentId) return;
    const parent = getCommentsData().find((c) => c.id === mode.parentCommentId);
    if (!parent) return;
    fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: documentId,
        text: parent.text,
        note: noteDraft.trim(),
        nodeId: parent.nodeId,
        nodeIds: parent.nodeIds,
      }),
    })
      .then(() => {
        setMode({ kind: 'view' });
        setNoteDraft('');
      })
      .catch((err) => console.error('[CommentPopover] Create failed:', err));
  }, [mode, documentId, noteDraft]);

  const resolve = useCallback((commentId: string) => {
    fetch('/api/comments/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [commentId] }),
    }).catch((err) => console.error('[CommentPopover] Resolve failed:', err));
  }, []);

  const remove = useCallback((commentId: string) => {
    fetch('/api/comments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [commentId] }),
    }).catch((err) => console.error('[CommentPopover] Delete failed:', err));
  }, []);

  if (!target || stack.length === 0) return null;

  const isDrafting = mode.kind !== 'view';
  const draftHint = mode.kind === 'compose' ? 'Adding a new comment on the same range' : null;

  return (
    <div
      ref={popoverRef}
      className={`ow-comment-popover ow-comment-popover-${position.placement}`}
      style={{ left: position.left, top: position.top, maxHeight: MAX_HEIGHT_PX }}
      onMouseEnter={cancelHide}
      onMouseLeave={scheduleHide}
    >
      {isDrafting ? (
        <>
          {draftHint && <div className="ow-comment-popover-empty">{draftHint}</div>}
          <textarea
            ref={textareaRef}
            className="ow-comment-popover-textarea"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (mode.kind === 'edit') saveEdit();
                else if (mode.kind === 'compose') saveCompose();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelDraft();
              }
            }}
            rows={4}
            placeholder="Note for agent (optional)..."
          />
          <div className="ow-comment-popover-actions">
            <span className="ow-comment-popover-hint">⌘↵ to save · Esc to cancel</span>
            <button
              className="ow-icon-btn"
              onClick={mode.kind === 'edit' ? saveEdit : saveCompose}
              title="Save"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </button>
          </div>
        </>
      ) : (
        <div className="ow-comment-popover-stack">
          {stack.map((c, idx) => (
            <div key={c.id} className={`ow-comment-popover-card${idx > 0 ? ' ow-comment-popover-card-divider' : ''}`}>
              {c.note ? (
                <div className="ow-comment-popover-text">{c.note}</div>
              ) : (
                <div className="ow-comment-popover-empty">No note</div>
              )}
              <div className="ow-comment-popover-actions">
                <button className="ow-icon-btn" onClick={() => startEdit(c.id)} title="Edit comment">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
                <button className="ow-icon-btn" onClick={() => startCompose(c.id)} title="Add another comment on this range">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <button className="ow-icon-btn" onClick={() => resolve(c.id)} title="Resolve (mark addressed)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
                <button className="ow-icon-btn ow-icon-btn-danger" onClick={() => remove(c.id)} title="Delete (remove permanently)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
