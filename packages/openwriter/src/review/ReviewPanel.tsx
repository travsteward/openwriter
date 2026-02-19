/**
 * Floating review panel for navigating and accepting/rejecting pending changes.
 * Supports cross-document navigation when multiple docs have pending changes.
 */

import { useCallback, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { usePendingState, derivePendingState } from '../hooks/usePendingState';
import type { PendingDocsPayload } from '../ws/client';

const s = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const ChevronLeft = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" {...s} /></svg>;
const ChevronRight = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" {...s} /></svg>;
const ChevronUp = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 10l5-5 5 5" stroke="currentColor" {...s} /></svg>;
const ChevronDown = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" {...s} /></svg>;
const Check = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" {...s} /></svg>;
const XIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" {...s} /></svg>;

interface ReviewPanelProps {
  editor: Editor | null;
  pendingDocs: PendingDocsPayload;
  currentFilename: string;
  onSwitchDocument: (filename: string) => void;
  sendMessage: (msg: Record<string, any>) => void;
}

export default function ReviewPanel({ editor, pendingDocs, currentFilename, onSwitchDocument, sendMessage }: ReviewPanelProps) {
  const {
    counts,
    currentNode,
    currentIndex,
    hasPending,
    goToNext,
    goToPrevious,
    acceptCurrent,
    rejectCurrent,
    acceptAll,
    rejectAll,
  } = usePendingState(editor);

  const totalPendingDocs = pendingDocs.filenames.length;
  // Don't count current doc in "other docs" tally when it's in the list
  const otherPendingDocs = currentDocIndexOf(pendingDocs.filenames, currentFilename) >= 0
    ? totalPendingDocs - 1
    : totalPendingDocs;
  const hasAnyPending = hasPending || totalPendingDocs > 0;
  const currentDocIndex = currentDocIndexOf(pendingDocs.filenames, currentFilename);

  // After a resolve action, check if doc is fully resolved → notify server
  const checkResolution = useCallback((action: 'accept' | 'reject') => {
    if (!editor || !currentFilename) return;
    const remaining = derivePendingState(editor);
    if (remaining.length === 0) {
      // Flush resolved editor state to server before pending-resolved
      // (bypasses the 1s debounce so server sees the clean document)
      sendMessage({ type: 'doc-update', document: editor.getJSON(), filename: currentFilename });
      sendMessage({
        type: 'pending-resolved',
        filename: currentFilename,
        action,
      });
    }
  }, [editor, currentFilename, sendMessage]);

  const handleAcceptCurrent = useCallback(() => {
    acceptCurrent();
    checkResolution('accept');
  }, [acceptCurrent, checkResolution]);

  const handleRejectCurrent = useCallback(() => {
    rejectCurrent();
    checkResolution('reject');
  }, [rejectCurrent, checkResolution]);

  const handleAcceptAll = useCallback(() => {
    acceptAll();
    checkResolution('accept');
  }, [acceptAll, checkResolution]);

  const handleRejectAll = useCallback(() => {
    rejectAll();
    checkResolution('reject');
  }, [rejectAll, checkResolution]);

  const goToPreviousDoc = useCallback(() => {
    if (totalPendingDocs === 0) return;
    if (totalPendingDocs === 1 && currentDocIndex === 0) return;
    const idx = currentDocIndex <= 0 ? totalPendingDocs - 1 : currentDocIndex - 1;
    onSwitchDocument(pendingDocs.filenames[idx]);
  }, [totalPendingDocs, currentDocIndex, pendingDocs.filenames, onSwitchDocument]);

  const goToNextDoc = useCallback(() => {
    if (totalPendingDocs === 0) return;
    if (totalPendingDocs === 1 && currentDocIndex === 0) return;
    const idx = currentDocIndex >= totalPendingDocs - 1 ? 0 : currentDocIndex + 1;
    onSwitchDocument(pendingDocs.filenames[idx]);
  }, [totalPendingDocs, currentDocIndex, pendingDocs.filenames, onSwitchDocument]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!hasAnyPending) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input or in the editor (contenteditable)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLElement && e.target.closest('[contenteditable]')) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); goToNext(); }
          break;
        case 'k':
        case 'ArrowUp':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); goToPrevious(); }
          break;
        case 'h':
        case 'ArrowLeft':
          if (!e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); goToPreviousDoc(); }
          break;
        case 'l':
        case 'ArrowRight':
          if (!e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); goToNextDoc(); }
          break;
        case 'a':
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); handleAcceptCurrent(); }
          break;
        case 'r':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); handleRejectCurrent(); }
          break;
        case 'A':
          if (e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); handleAcceptAll(); }
          break;
        case 'R':
          if (e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); handleRejectAll(); }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasAnyPending, goToNext, goToPrevious, goToPreviousDoc, goToNextDoc, handleAcceptCurrent, handleRejectCurrent, handleAcceptAll, handleRejectAll]);

  if (!hasAnyPending) return null;

  const changeType = currentNode?.pendingStatus || 'rewrite';
  const dotClass = `review-panel__dot review-panel__dot--${changeType}`;

  // Current doc has no pending but others do
  if (!hasPending && otherPendingDocs > 0) {
    return (
      <div className="review-panel">
        <div className="review-panel__status">
          No changes here &mdash; {otherPendingDocs} other doc{otherPendingDocs > 1 ? 's have' : ' has'} changes
        </div>
        <div className="review-panel__divider" />
        <div className="review-panel__nav">
          <button
            className="review-panel__btn"
            onClick={goToNextDoc}
            title="Next doc (l)"
          >
            <ChevronRight />
          </button>
        </div>
      </div>
    );
  }

  // Compute display index for doc nav (handle -1 gracefully)
  const docDisplayIndex = currentDocIndex >= 0 ? currentDocIndex + 1 : '?';

  return (
    <div className="review-panel">
      {/* Doc navigation — only show when multiple docs have pending */}
      {totalPendingDocs > 1 && (
        <>
          <div className="review-panel__nav">
            <button className="review-panel__btn" onClick={goToPreviousDoc} title="Previous doc (h)"><ChevronLeft /></button>
            <button className="review-panel__btn" onClick={goToNextDoc} title="Next doc (l)"><ChevronRight /></button>
            <span className="review-panel__counter">{docDisplayIndex}/{totalPendingDocs}</span>
          </div>
          <div className="review-panel__divider" />
        </>
      )}

      {/* Change nav + counter merged */}
      <div className="review-panel__nav">
        <button className="review-panel__btn" onClick={goToPrevious} disabled={counts.total <= 1} title="Previous (k)"><ChevronUp /></button>
        <button className="review-panel__btn" onClick={goToNext} disabled={counts.total <= 1} title="Next (j)"><ChevronDown /></button>
        <span className="review-panel__counter">
          {currentIndex + 1}/{counts.total}
        </span>
      </div>

      <div className="review-panel__divider" />

      {/* Actions: single then bulk */}
      <div className="review-panel__actions">
        <button className="review-panel__accept" onClick={handleAcceptCurrent} title="Accept (a)"><Check /></button>
        <button className="review-panel__reject" onClick={handleRejectCurrent} title="Reject (r)"><XIcon /></button>
        <button className="review-panel__accept-all" onClick={handleAcceptAll} title="Accept all (Shift+A)"><Check /><span>All</span></button>
        <button className="review-panel__reject-all" onClick={handleRejectAll} title="Reject all (Shift+R)"><XIcon /><span>All</span></button>
      </div>
    </div>
  );
}

function currentDocIndexOf(filenames: string[], current: string): number {
  return filenames.indexOf(current);
}
