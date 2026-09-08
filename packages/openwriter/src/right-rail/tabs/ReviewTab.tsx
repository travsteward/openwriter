/**
 * Review tab — pending agent changes for the active doc.
 *
 * Migrated from src/review/ReviewPanel.tsx (which lived as a floating
 * action bar at the bottom of the editor). Same logic, restructured for
 * a vertical rail body. Auto-open of this tab when pending writes arrive
 * lives in RightRail.tsx — this component is just the body.
 *
 * adr: adr/right-rail.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './FocusReview.css';
import type { Editor } from '@tiptap/react';
import { usePendingState, derivePendingState } from '../../hooks/usePendingState';
import { setPreviewState, isPreviewActive, getSavedModifiedContent, getPreviewGroupId } from '../../decorations/plugin';
import { findNodeById, findGroupMembers } from '../../decorations/apply';
import type { RightRailTabProps } from '../types';
import type { WorkspaceFull, WorkspaceNode, WorkspaceWithData } from '../../sidebar/sidebar-types';
import ManuscriptRailSections from './ManuscriptRailSections';

/** Scope filter — which subset of pending docs the navigator cycles through.
 *  Persisted to localStorage so the choice survives reloads.
 *  - 'all'       — every doc in the profile with pending changes (default)
 *  - 'workspace' — only docs in the current doc's workspace */
type ReviewScope = 'all' | 'workspace';
const SCOPE_STORAGE_KEY = 'ow-review-scope';

function readScopePreference(): ReviewScope {
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
    return raw === 'workspace' ? 'workspace' : 'all';
  } catch { return 'all'; }
}

function writeScopePreference(scope: ReviewScope): void {
  try { localStorage.setItem(SCOPE_STORAGE_KEY, scope); } catch { /* storage denied */ }
}

/** Walk a workspace tree to collect every `file` path. */
function collectFiles(items: WorkspaceNode[] | undefined): string[] {
  if (!items) return [];
  const out: string[] = [];
  for (const item of items) {
    if (item.type === 'doc' && item.file) out.push(item.file);
    if (item.type === 'container' && item.items) out.push(...collectFiles(item.items));
  }
  return out;
}

/** Does a workspace tree contain the given filename anywhere? */
function workspaceContainsFile(root: WorkspaceNode[] | undefined, filename: string): boolean {
  if (!root) return false;
  for (const item of root) {
    if (item.type === 'doc' && item.file === filename) return true;
    if (item.type === 'container' && item.items && workspaceContainsFile(item.items, filename)) return true;
  }
  return false;
}

const s = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const ChevronLeft = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" {...s} /></svg>;
const ChevronRight = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" {...s} /></svg>;
const ChevronUp = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 10l5-5 5 5" stroke="currentColor" {...s} /></svg>;
const ChevronDown = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" {...s} /></svg>;
const Check = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" {...s} /></svg>;
const DoubleCheck = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8.5l3.5 3.5L11 5" stroke="currentColor" {...s} /><path d="M8 12l.5.5L15 6" stroke="currentColor" {...s} /></svg>;
const XIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" {...s} /></svg>;

function replaceNodeContent(editor: Editor, nodeId: string, newContent: any): boolean {
  const result = findNodeById(editor, nodeId);
  if (!result) return false;
  const { pos, node } = result;
  const replacement = {
    type: newContent.type || node.type.name,
    attrs: {
      ...(newContent.attrs || {}),
      id: node.attrs.id,
      pendingStatus: node.attrs.pendingStatus,
      pendingOriginalContent: node.attrs.pendingOriginalContent,
      pendingSelectionFrom: node.attrs.pendingSelectionFrom,
      pendingSelectionTo: node.attrs.pendingSelectionTo,
      pendingOriginalFrom: node.attrs.pendingOriginalFrom,
      pendingOriginalTo: node.attrs.pendingOriginalTo,
    },
    content: newContent.content,
  };
  try {
    editor.chain()
      .command(({ tr }) => { tr.setMeta('addToHistory', false); return true; })
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, replacement)
      .run();
    return true;
  } catch { return false; }
}

function replaceGroupRange(editor: Editor, groupId: string, newContent: any[]): boolean {
  const members = findGroupMembers(editor, groupId);
  if (members.length === 0) return false;
  const rangeFrom = members[0].pos;
  const rangeTo = members[members.length - 1].pos + members[members.length - 1].node.nodeSize;
  try {
    editor.chain()
      .command(({ tr }) => { tr.setMeta('addToHistory', false); return true; })
      .deleteRange({ from: rangeFrom, to: rangeTo })
      .insertContentAt(rangeFrom, newContent)
      .run();
    return true;
  } catch { return false; }
}

function restoreIfPreviewing(editor: Editor, previewingNodeId: string | null): boolean {
  if (!isPreviewActive() || !previewingNodeId) return false;
  const modified = getSavedModifiedContent();
  const groupId = getPreviewGroupId();
  if (groupId && modified && Array.isArray(modified)) {
    replaceGroupRange(editor, previewingNodeId, modified);
  } else if (modified) {
    replaceNodeContent(editor, previewingNodeId, modified);
  }
  setPreviewState(false);
  return true;
}

function currentDocIndexOf(filenames: string[], current: string): number {
  return filenames.indexOf(current);
}

export default function ReviewTab({
  editors,
  pendingDocs,
  currentFilename,
  docId,
  contentType,
  manuscriptStyle,
  pendingTitle,
  onSwitchDocument,
  sendMessage,
  getDocument,
  docVersionRef,
  focusReviewTarget,
}: RightRailTabProps & { focusReviewTarget?: HTMLElement | null }) {
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
  } = usePendingState(editors);

  // Pending metadata (currently just title rename) for the active doc arrives
  // as a prop from App. It participates in the SAME review cycle as body
  // pending changes — title sits at virtual slot 0, body changes follow.
  // Navigation, accept-current, and reject-current all route by cursor.
  // adr: adr/pending-overlay-model.md
  const [cursor, setCursor] = useState<'title' | 'body'>(pendingTitle ? 'title' : 'body');

  // When the title state appears (agent stages it), focus the title slot so
  // the user lands on the new pending item. When it clears (accept/reject),
  // fall back to body if there's any. When body clears under us while we're
  // on body, fall back to title if available.
  useEffect(() => {
    if (pendingTitle && cursor !== 'title' && counts.total === 0) {
      setCursor('title');
    } else if (!pendingTitle && cursor === 'title') {
      setCursor('body');
    }
  }, [pendingTitle, counts.total, cursor]);

  // Virtual navigation across [title?, body[0], body[1], ...]
  const hasTitleSlot = !!pendingTitle;
  const totalSlots = counts.total + (hasTitleSlot ? 1 : 0);
  const slotIndex = cursor === 'title' ? 0 : (hasTitleSlot ? 1 : 0) + currentIndex;

  // Preview state — body uses this for Modified/Original toggle (rewrites
  // only; controls editor content swap). Title reuses the same flag for
  // its own preview semantics (renders `from` vs `to`). Declared here so
  // both the cursor-dispatch effect and the body preview logic can read it.
  const [showOriginal, setShowOriginal] = useState(false);

  // Reset showOriginal when the cursor leaves the title slot — otherwise
  // toggling Modified/Original on title would persist into body navigation
  // and confuse the body's preview state.
  useEffect(() => {
    if (cursor !== 'title') setShowOriginal(false);
  }, [cursor]);

  // Dispatch ow-pending-review-cursor so the article compose view can mirror
  // the title-focused gutter and respond to the Modified/Original toggle by
  // swapping between the proposed and canonical title. Tight deps (just
  // cursor + pendingTitle + docId + showOriginal) so this effect doesn't
  // re-fire on every App render.
  // adr: adr/pending-overlay-model.md
  useEffect(() => {
    const titleFocused = !!pendingTitle && cursor === 'title';
    const detail = {
      docId,
      titleFocused,
      // When cursor is on title AND user toggled Original, the compose view
      // renders the `from` text without the green pending-insert tint —
      // mirrors body's Modified/Original preview semantics.
      titleShowOriginal: titleFocused && showOriginal,
    };
    window.dispatchEvent(new CustomEvent('ow-pending-review-cursor', { detail }));
    return () => {
      window.dispatchEvent(new CustomEvent('ow-pending-review-cursor', { detail: { docId, titleFocused: false, titleShowOriginal: false } }));
    };
  }, [docId, pendingTitle, cursor, showOriginal]);

  const acceptPendingTitleAction = useCallback(() => {
    if (!docId) return;
    sendMessage({ type: 'accept-pending-title', docId });
  }, [docId, sendMessage]);
  const rejectPendingTitleAction = useCallback(() => {
    if (!docId) return;
    sendMessage({ type: 'reject-pending-title', docId });
  }, [docId, sendMessage]);

  const previewNodeIdRef = useRef<string | null>(null);
  const previewEditorRef = useRef<Editor | null>(null);

  // Scope filter — 'all' (profile-wide) or 'workspace' (current doc's workspace).
  // Workspaces fetched once per mount; refetched on `ow-workspaces-changed` so
  // the filter stays accurate when the user reorganises the tree elsewhere.
  const [scope, setScope] = useState<ReviewScope>(() => readScopePreference());
  const [workspaces, setWorkspaces] = useState<WorkspaceWithData[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchWorkspaces() {
      try {
        const res = await fetch('/api/workspaces');
        const wsList: { filename: string; title: string; docCount: number }[] = await res.json();
        if (!Array.isArray(wsList)) return;
        const detailed = await Promise.all(wsList.map(async (w) => {
          try {
            const r = await fetch(`/api/workspaces/${encodeURIComponent(w.filename)}`);
            const workspace: WorkspaceFull = await r.json();
            return { ...w, workspace } as WorkspaceWithData;
          } catch { return w as WorkspaceWithData; }
        }));
        if (!cancelled) setWorkspaces(detailed);
      } catch { /* server unreachable, scope toggle just won't filter */ }
    }
    fetchWorkspaces();
    const handler = () => fetchWorkspaces();
    window.addEventListener('ow-workspaces-changed', handler);
    return () => { cancelled = true; window.removeEventListener('ow-workspaces-changed', handler); };
  }, []);

  // Files in the current doc's workspace. When the current doc isn't in any
  // workspace (untitled, orphaned), this is null and the scope filter falls
  // back to "all" so the user is never stranded with zero results.
  const currentWorkspaceFiles = useMemo<Set<string> | null>(() => {
    if (workspaces.length === 0 || !currentFilename) return null;
    const ws = workspaces.find((w) => workspaceContainsFile(w.workspace?.root, currentFilename));
    if (!ws) return null;
    return new Set(collectFiles(ws.workspace?.root));
  }, [workspaces, currentFilename]);

  const filteredFilenames = useMemo(() => {
    if (scope === 'all' || !currentWorkspaceFiles) return pendingDocs.filenames;
    return pendingDocs.filenames.filter((f) => currentWorkspaceFiles.has(f));
  }, [scope, pendingDocs.filenames, currentWorkspaceFiles]);

  const handleScopeChange = useCallback((next: ReviewScope) => {
    setScope(next);
    writeScopePreference(next);
  }, []);

  const totalPendingDocs = filteredFilenames.length;
  const currentDocIndex = currentDocIndexOf(filteredFilenames, currentFilename);
  const isRewrite = currentNode?.pendingStatus === 'rewrite';
  const isGroup = !!currentNode?.groupId;
  const canPreview = isRewrite;

  const togglePreview = useCallback(() => {
    const editor = currentNode?.editor;
    if (!editor || !currentNode || currentNode.pendingStatus !== 'rewrite') return;

    if (!showOriginal) {
      if (isGroup && currentNode.groupId) {
        const members = findGroupMembers(editor, currentNode.groupId);
        if (members.length === 0) return;
        const originalContent = members[0].node.attrs?.pendingOriginalContent;
        if (!originalContent || !Array.isArray(originalContent)) return;
        const modifiedJsons = members.map((m) => m.node.toJSON());
        const previewNodes = originalContent.map((orig: any, i: number) => ({
          ...orig,
          attrs: {
            ...(orig.attrs || {}),
            pendingStatus: 'rewrite',
            pendingGroupId: currentNode.groupId,
            ...(i === 0 ? { pendingOriginalContent: originalContent } : {}),
          },
        }));
        setPreviewState(true, currentNode.nodeId, modifiedJsons, currentNode.groupId);
        const swapped = replaceGroupRange(editor, currentNode.groupId, previewNodes);
        if (!swapped) {
          setPreviewState(false);
          return;
        }
        previewNodeIdRef.current = currentNode.nodeId;
        previewEditorRef.current = editor;
        setShowOriginal(true);
      } else {
        const result = findNodeById(editor, currentNode.nodeId);
        if (!result) return;
        const { node } = result;
        const originalContent = node.attrs?.pendingOriginalContent;
        if (!originalContent) return;
        const modifiedJson = node.toJSON();
        setPreviewState(true, currentNode.nodeId, modifiedJson);
        const swapped = replaceNodeContent(editor, currentNode.nodeId, originalContent);
        if (!swapped) {
          setPreviewState(false);
          return;
        }
        previewNodeIdRef.current = currentNode.nodeId;
        previewEditorRef.current = editor;
        setShowOriginal(true);
      }
    } else {
      if (previewEditorRef.current) {
        restoreIfPreviewing(previewEditorRef.current, previewNodeIdRef.current);
      }
      previewNodeIdRef.current = null;
      previewEditorRef.current = null;
      setShowOriginal(false);
    }
  }, [currentNode, showOriginal, isGroup]);

  useEffect(() => {
    if (!showOriginal) return;
    const prevNodeId = previewNodeIdRef.current;
    const prevEditor = previewEditorRef.current;
    if (prevNodeId && prevEditor && currentNode?.nodeId !== prevNodeId) {
      restoreIfPreviewing(prevEditor, prevNodeId);
      previewNodeIdRef.current = null;
      previewEditorRef.current = null;
      setShowOriginal(false);
    }
  }, [currentNode?.nodeId, showOriginal]);

  useEffect(() => {
    if (editors.length === 0) return;
    return () => {
      if (isPreviewActive() && previewNodeIdRef.current && previewEditorRef.current) {
        restoreIfPreviewing(previewEditorRef.current, previewNodeIdRef.current);
        previewNodeIdRef.current = null;
        previewEditorRef.current = null;
      }
    };
  }, [editors]);

  const checkResolution = useCallback((action: 'accept' | 'reject') => {
    if (!currentFilename) return;
    const hasRemaining = editors.some((e) => {
      if (!e || e.isDestroyed) return false;
      return derivePendingState(e).length > 0;
    });
    if (!hasRemaining) {
      const doc = getDocument?.();
      if (doc) {
        sendMessage({ type: 'doc-update', document: doc, filename: currentFilename, version: docVersionRef?.current ?? 0 });
      }
      sendMessage({ type: 'pending-resolved', filename: currentFilename, action });
    }
  }, [editors, currentFilename, sendMessage, getDocument, docVersionRef]);

  const restorePreviewIfActive = useCallback(() => {
    if (previewEditorRef.current && showOriginal && previewNodeIdRef.current) {
      restoreIfPreviewing(previewEditorRef.current, previewNodeIdRef.current);
      previewNodeIdRef.current = null;
      previewEditorRef.current = null;
      setShowOriginal(false);
    }
  }, [showOriginal]);

  const handleAcceptCurrent = useCallback(() => {
    if (cursor === 'title' && pendingTitle) {
      acceptPendingTitleAction();
      // After accepting title, if body has pending, focus the first body slot.
      if (counts.total > 0) setCursor('body');
      return;
    }
    restorePreviewIfActive();
    acceptCurrent();
    checkResolution('accept');
  }, [cursor, pendingTitle, acceptPendingTitleAction, counts.total, restorePreviewIfActive, acceptCurrent, checkResolution]);

  const handleRejectCurrent = useCallback(() => {
    if (cursor === 'title' && pendingTitle) {
      rejectPendingTitleAction();
      if (counts.total > 0) setCursor('body');
      return;
    }
    restorePreviewIfActive();
    rejectCurrent();
    checkResolution('reject');
  }, [cursor, pendingTitle, rejectPendingTitleAction, counts.total, restorePreviewIfActive, rejectCurrent, checkResolution]);

  const handleAcceptAll = useCallback(() => {
    restorePreviewIfActive();
    if (pendingTitle) acceptPendingTitleAction();
    acceptAll();
    checkResolution('accept');
  }, [restorePreviewIfActive, pendingTitle, acceptPendingTitleAction, acceptAll, checkResolution]);

  // External "approve all" event from the sidebar context menu.
  useEffect(() => {
    const handler = () => handleAcceptAll();
    window.addEventListener('ow-accept-all', handler);
    return () => window.removeEventListener('ow-accept-all', handler);
  }, [handleAcceptAll]);

  const handleRejectAll = useCallback(() => {
    restorePreviewIfActive();
    if (pendingTitle) rejectPendingTitleAction();
    rejectAll();
    checkResolution('reject');
  }, [restorePreviewIfActive, pendingTitle, rejectPendingTitleAction, rejectAll, checkResolution]);

  // Cycle-aware navigation: title is virtual slot 0 when staged; body changes
  // follow. j/k and ↑/↓ cycle through every slot in order.
  //
  // Body's internal cursor (managed by usePendingState) needs to stay aligned
  // with the visible position. Invariant we maintain: when cursor === 'title',
  // body's internal currentIndex is 0. That way title → body forward lands on
  // body[0], and title → body backward via goToPrevious() wraps 0 → last.
  //
  // When transitioning body[last] → title forward, we call goToNext() FIRST
  // (which wraps body internal to 0 via modulo), then flip cursor. When
  // transitioning body[0] → title backward, body is already at 0, so we just
  // flip cursor without moving it.
  const handleGoToNext = useCallback(() => {
    if (totalSlots <= 1) return;
    if (cursor === 'title') {
      // Title → body[0]. Body's internal cursor is already 0 by invariant.
      setCursor('body');
      return;
    }
    // cursor === 'body'
    if (hasTitleSlot && currentIndex >= counts.total - 1) {
      // At last body → wrap body to body[0] (so the invariant holds), then
      // flip cursor to title.
      goToNext();
      setCursor('title');
      return;
    }
    goToNext();
  }, [totalSlots, cursor, hasTitleSlot, currentIndex, counts.total, goToNext]);

  const handleGoToPrevious = useCallback(() => {
    if (totalSlots <= 1) return;
    if (cursor === 'title') {
      // Title → body[last]. Body's internal cursor is 0 by invariant, so
      // goToPrevious wraps 0 → last via modulo. Then flip cursor.
      goToPrevious();
      setCursor('body');
      return;
    }
    if (hasTitleSlot && currentIndex === 0) {
      // At body[0] backward → flip cursor to title without moving body
      // (which is already at 0; invariant preserved).
      setCursor('title');
      return;
    }
    goToPrevious();
  }, [totalSlots, cursor, hasTitleSlot, currentIndex, goToPrevious]);

  const goToPreviousDoc = useCallback(() => {
    if (totalPendingDocs === 0) return;
    if (totalPendingDocs === 1 && currentDocIndex === 0) return;
    const idx = currentDocIndex <= 0 ? totalPendingDocs - 1 : currentDocIndex - 1;
    onSwitchDocument(filteredFilenames[idx]);
  }, [totalPendingDocs, currentDocIndex, filteredFilenames, onSwitchDocument]);

  const goToNextDoc = useCallback(() => {
    if (totalPendingDocs === 0) return;
    if (totalPendingDocs === 1 && currentDocIndex === 0) return;
    const idx = currentDocIndex >= totalPendingDocs - 1 ? 0 : currentDocIndex + 1;
    onSwitchDocument(filteredFilenames[idx]);
  }, [totalPendingDocs, currentDocIndex, filteredFilenames, onSwitchDocument]);

  // Global keyboard shortcuts — only active when there's pending work
  // (title OR body).
  useEffect(() => {
    if (!hasPending && !pendingTitle) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLElement && e.target.closest('[contenteditable]')) return;

      switch (e.key) {
        case 'j': case 'ArrowDown':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); handleGoToNext(); } break;
        case 'k': case 'ArrowUp':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); handleGoToPrevious(); } break;
        case 'h': case 'ArrowLeft':
          if (!e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); goToPreviousDoc(); } break;
        case 'l': case 'ArrowRight':
          if (!e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); goToNextDoc(); } break;
        case 'a':
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); handleAcceptCurrent(); } break;
        case 'r':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); handleRejectCurrent(); } break;
        case 'A':
          if (e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); handleAcceptAll(); } break;
        case 'R':
          if (e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); handleRejectAll(); } break;
        case 'o':
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            if (cursor === 'title') {
              setShowOriginal((v) => !v);
            } else {
              togglePreview();
            }
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasPending, pendingTitle, handleGoToNext, handleGoToPrevious, goToPreviousDoc, goToNextDoc, handleAcceptCurrent, handleRejectCurrent, handleAcceptAll, handleRejectAll, togglePreview]);

  // Doc navigator counter. When the current doc isn't in the filtered pending
  // list (just resolved it, never had pending, or filter excludes it), show
  // `— / N` instead of `?/N` — the dash reads as "no current position" and
  // doesn't look like an error placeholder.
  const docCounterText = currentDocIndex >= 0
    ? `${currentDocIndex + 1} / ${totalPendingDocs}`
    : `— / ${totalPendingDocs}`;
  const unfilteredTotal = pendingDocs.filenames.length;
  const workspaceScopeUnavailable = !currentWorkspaceFiles;
  const showScopeToggle = unfilteredTotal > 0;

  const scopeSection = showScopeToggle ? (
    <div className="review-tab__section">
      <div className="review-tab__section-label">Scope</div>
      <div className="review-tab__toggle">
        <button
          type="button"
          className={`review-panel__toggle-btn${scope === 'all' ? ' review-panel__toggle-btn--active' : ''}`}
          onClick={() => handleScopeChange('all')}
          title="Cycle every pending doc in the profile"
        >
          All
        </button>
        <button
          type="button"
          className={`review-panel__toggle-btn${scope === 'workspace' ? ' review-panel__toggle-btn--active' : ''}`}
          onClick={() => !workspaceScopeUnavailable && handleScopeChange('workspace')}
          disabled={workspaceScopeUnavailable}
          title={workspaceScopeUnavailable ? 'Current doc is not in a workspace' : 'Only cycle pending docs in this workspace'}
        >
          Workspace
        </button>
      </div>
    </div>
  ) : null;

  // Current doc has nothing pending — show "All caught up" regardless of
  // whether other docs have pending. The sidebar already surfaces other
  // docs' pending state via the green dot indicator, so the Review panel
  // doesn't need to nag here. Without this, branch 3 used to fire and show
  // a `—/N` doc navigator on every clean doc, which read like an error.
  // adr: adr/pending-overlay-model.md
  // One controller, two presentations. The portal is outside the collapsed
  // rail's inert DOM, so Focus controls remain accessible and interactive.
  if (focusReviewTarget !== undefined) {
    if (!focusReviewTarget || totalSlots === 0) return null;
    return createPortal(
      <div className="focus-review" role="group" aria-label="Review changes">
        <button type="button" onClick={handleGoToPrevious} disabled={totalSlots <= 1} aria-label="Previous change" title="Previous change"><ChevronLeft /></button>
        <span className="focus-review__count" aria-live="polite" aria-atomic="true" title={cursor === 'title' && pendingTitle ? `${pendingTitle.from} → ${pendingTitle.to}` : 'Current change'}>{cursor === 'title' ? 'Title ' : ''}{slotIndex + 1}/{totalSlots}</span>
        <button type="button" onClick={handleGoToNext} disabled={totalSlots <= 1} aria-label="Next change" title="Next change"><ChevronRight /></button>
        <button type="button" className="focus-review__accept" onClick={handleAcceptCurrent} aria-label="Accept current change" title="Accept current change"><Check /></button>
        <button type="button" className="focus-review__reject" onClick={handleRejectCurrent} aria-label="Reject current change" title="Reject current change"><XIcon /></button>
      </div>,
      focusReviewTarget,
    );
  }

  if (!hasPending && !pendingTitle) {
    return (
      <>
        <div className="review-tab__empty">
          <div className="review-tab__empty-title">All caught up</div>
          <div className="review-tab__empty-note">No pending agent changes. New writes from agents will land here for review.</div>
        </div>
        <div className="review-tab">
          <ManuscriptRailSections contentType={contentType} docId={docId} manuscriptStyle={manuscriptStyle} onSwitchDocument={onSwitchDocument} />
        </div>
      </>
    );
  }

  return (
    <div className="review-tab">
      {scopeSection}
      {totalPendingDocs > 1 && (
        <div className="review-tab__section">
          <div className="review-tab__section-label">Document</div>
          <div className="review-tab__row">
            <button className="review-panel__btn" onClick={goToPreviousDoc} title="Previous doc (h)"><ChevronLeft /></button>
            <button className="review-panel__btn" onClick={goToNextDoc} title="Next doc (l)"><ChevronRight /></button>
            <span className="review-panel__counter">{docCounterText}</span>
          </div>
        </div>
      )}

      <div className="review-tab__section review-tab__section--actions">
        <div className="review-tab__toggle">
          <button
            className={`review-panel__toggle-btn${(canPreview || cursor === 'title') && !showOriginal ? ' review-panel__toggle-btn--active' : ''}`}
            onClick={() => {
              if (cursor === 'title') {
                if (showOriginal) setShowOriginal(false);
              } else if (canPreview && showOriginal) {
                togglePreview();
              }
            }}
            disabled={!canPreview && cursor !== 'title'}
            title="Show modified (o)"
          >
            Modified
          </button>
          <button
            className={`review-panel__toggle-btn${(canPreview || cursor === 'title') && showOriginal ? ' review-panel__toggle-btn--active' : ''}`}
            onClick={() => {
              if (cursor === 'title') {
                if (!showOriginal) setShowOriginal(true);
              } else if (canPreview && !showOriginal) {
                togglePreview();
              }
            }}
            disabled={!canPreview && cursor !== 'title'}
            title="Show original (o)"
          >
            Original
          </button>
        </div>
      </div>

      <div className="review-tab__section">
        <div className="review-tab__section-label">{cursor === 'title' ? 'Title' : 'Change'}</div>
        <div className="review-tab__row">
          <button className="review-panel__btn" onClick={handleGoToPrevious} disabled={totalSlots <= 1} title="Previous (k)"><ChevronUp /></button>
          <button className="review-panel__btn" onClick={handleGoToNext} disabled={totalSlots <= 1} title="Next (j)"><ChevronDown /></button>
          <span className="review-panel__counter">{slotIndex + 1} / {totalSlots}</span>
        </div>
      </div>

      <div className="review-tab__section">
        <div className="review-tab__row">
          <button className="review-tab__judge-btn review-tab__judge-btn--accept" onClick={handleAcceptCurrent} title="Accept (a)"><Check /><span>Accept</span></button>
          <button className="review-tab__judge-btn review-tab__judge-btn--reject" onClick={handleRejectCurrent} title="Reject (r)"><XIcon /><span>Reject</span></button>
        </div>
      </div>

      <div className="review-tab__section">
        <div className="review-tab__row">
          <button className="review-tab__bulk-btn review-tab__bulk-btn--accept" onClick={handleAcceptAll} title="Accept all (Shift+A)"><DoubleCheck /><span>Accept all</span></button>
          <button className="review-tab__bulk-btn review-tab__bulk-btn--reject" onClick={handleRejectAll} title="Reject all (Shift+R)"><XIcon /><span>Reject all</span></button>
        </div>
      </div>

      <ManuscriptRailSections contentType={contentType} docId={docId} manuscriptStyle={manuscriptStyle} onSwitchDocument={onSwitchDocument} />
    </div>
  );
}
