import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

import { applyNodeChangesFromBridge } from '../decorations/bridge';
import { applyRewrite } from '../decorations/apply';
import type { SelectionRange } from '../decorations/apply';
import { getCommentsData } from '../decorations/comments-plugin';
import { getBacklinksForNode, type BacklinkEntry } from '../decorations/backlinks-plugin';
import { injectSelectionMarkers, stripSelectionMarkers } from './selection-markers';
import { formatLinkHref, linkHrefIdentifier } from '../editor/link-href';
import { showToast } from '../utils/toast';
import { openTopupCheckout } from '../utils/av-billing';
import { useBookmarks, getBookmarks, addBookmark, editBookmark, removeBookmark } from '../bookmarks/bookmarks-store';

/** Client-side selection cap — mirrors the AV API's apply-editor guard. Toast + cancel
 *  before the request so the user gets instant feedback (not a 413 round-trip). */
const MAX_SELECTION_WORDS = 5000;

/** True if this doc appears in the linked-ids list (matches by docId or filename). */
function isDocLinked(d: { filename: string; docId?: string }, linkedIds: string[]): boolean {
  if (d.docId && linkedIds.includes(d.docId)) return true;
  return linkedIds.includes(d.filename);
}

interface PluginMenuItem {
  label: string;
  shortcut?: string;
  action: string;
  condition?: 'has-selection' | 'empty-node' | 'always';
  promptForInput?: boolean;
  pluginDisplayName?: string;
}

type CoreAction = 'comment' | 'delete' | 'link' | 'unlink';

interface MenuItem {
  action: string;
  label: string;
  shortcut?: string;
  isPlugin?: boolean;
  promptForInput?: boolean;
  pluginDisplayName?: string;
}

interface ContextMenuProps {
  editorRef: React.MutableRefObject<Editor | null>;
  allEditors?: Editor[];
  documentId?: string;
}

interface MenuPosition {
  x: number;
  y: number;
}

const CORE_ACTIONS: Array<{ action: CoreAction; label: string; shortcut?: string; condition?: 'has-selection' }> = [
  { action: 'comment', label: 'Comment', shortcut: 'M', condition: 'has-selection' },
  { action: 'delete', label: 'Delete', shortcut: 'D' },
];

interface CapturedSelection {
  from: number;
  to: number;
  nodes: any[];
  nodeIds: string[];
  /** Selected text, read at right-click. Positions go stale if an agent edit
   *  lands above the selection while a comment is being typed. */
  text: string;
}

export default function ContextMenu({ editorRef, allEditors, documentId }: ContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customAction, setCustomAction] = useState('');
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [docList, setDocList] = useState<Array<{ filename: string; title: string; docId?: string }>>([]);
  const [linkedDocs, setLinkedDocs] = useState<string[]>([]);
  const [showNewLinkInput, setShowNewLinkInput] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [pluginItems, setPluginItems] = useState<PluginMenuItem[]>([]);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentNote, setCommentNote] = useState('');
  const [editingComment, setEditingComment] = useState<{ id: string; text: string } | null>(null);
  const [commentOnlyMenu, setCommentOnlyMenu] = useState<{ id: string; text: string; note: string } | null>(null);
  // Backlinks panel: populated when right-click target is on a `.linked-paragraph` decoration.
  // entries is a snapshot at right-click time so the panel renders deterministically.
  const [backlinksMenu, setBacklinksMenu] = useState<{ nodeId: string; entries: BacklinkEntry[] } | null>(null);
  const [showBacklinksPanel, setShowBacklinksPanel] = useState(false);
  // Outbound doc-link target: populated when right-click target is inside a
  // `.doc-link[href^="doc:"]` mark. Lets the menu offer "Go to target" for
  // right-clickers who expect the same affordance as left-click navigation.
  const [docLinkTarget, setDocLinkTarget] = useState<{ docId: string; nodeId: string | null; title: string | null } | null>(null);
  // Paragraph drill-in for the link picker: when set, the link panel shows the
  // paragraphs of a specific target doc instead of the doc list.
  const [paragraphPicker, setParagraphPicker] = useState<{
    docId: string;
    filename: string;
    title: string;
    paragraphs: Array<{ nodeId: string; type: string; level?: number; preview: string }>;
    loading: boolean;
  } | null>(null);
  // Bookmarks: the paragraph under the right-click (not the prior selection),
  // and the note editor when adding or editing one.
  const bookmarks = useBookmarks(documentId || '');
  const [bookmarkTarget, setBookmarkTarget] = useState<string | null>(null);
  const [bookmarkEditor, setBookmarkEditor] = useState<{ nodeId: string; id?: string } | null>(null);
  const [bookmarkNote, setBookmarkNote] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  // Capture selection at right-click time (before the click changes cursor position)
  const capturedSelection = useRef<CapturedSelection | null>(null);
  // Track which editor was right-clicked (for thread mode with multiple editors)
  const activeEditorRef = useRef<Editor | null>(null);

  // Find which editor contains the click target
  const findEditorForTarget = useCallback((target: Node): Editor | null => {
    // Check allEditors first (thread mode)
    if (allEditors && allEditors.length > 0) {
      for (const editor of allEditors) {
        if (editor.view.dom.contains(target)) return editor;
      }
    }
    // Fallback to single editorRef
    const editor = editorRef.current;
    if (editor && editor.view.dom.contains(target)) return editor;
    return null;
  }, [allEditors, editorRef]);

  // Adjust position to keep menu within viewport
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !visible) return;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    let { x, y } = position;
    if (y + rect.height + pad > window.innerHeight) y = position.y - rect.height;
    if (x + rect.width + pad > window.innerWidth) x = position.x - rect.width;
    if (y < pad) y = pad;
    if (x < pad) x = pad;
    if (x !== position.x || y !== position.y) setPosition({ x, y });
  }, [visible, position]);

  // Fetch plugin menu items
  const fetchPluginItems = useCallback(() => {
    fetch('/api/plugins')
      .then((r) => r.json())
      .then((data) => {
        const items: PluginMenuItem[] = [];
        for (const plugin of data.plugins || []) {
          const displayName = plugin.displayName || undefined;
          for (const item of plugin.contextMenuItems || []) {
            items.push({ ...item, pluginDisplayName: displayName });
          }
        }
        setPluginItems(items);
      })
      .catch(() => {});
  }, []);

  // Fetch on mount
  useEffect(() => { fetchPluginItems(); }, [fetchPluginItems]);

  // Re-fetch when plugins are enabled/disabled
  useEffect(() => {
    const handler = () => fetchPluginItems();
    window.addEventListener('ow-plugins-changed', handler);
    return () => window.removeEventListener('ow-plugins-changed', handler);
  }, [fetchPluginItems]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setVisible(false);
        setShowCustom(false);
        setShowLinkPicker(false);
        setShowCommentInput(false);
        setCommentNote('');
        setEditingComment(null);
        setCommentOnlyMenu(null);
        setDocLinkTarget(null);
        setBookmarkEditor(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Check if selection is inside a link
  const isOnLink = useCallback(() => {
    const editor = activeEditorRef.current || editorRef.current;
    if (!editor) return false;
    return editor.isActive('link');
  }, [editorRef]);

  // Check if any captured node has pending status
  const selectionHasPending = useCallback((): boolean => {
    const editor = activeEditorRef.current || editorRef.current;
    const captured = capturedSelection.current;
    if (!editor || !captured) return false;
    const { from, to } = captured;
    let hasPending = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.attrs?.pendingStatus) hasPending = true;
      return !hasPending; // stop traversal early
    });
    return hasPending;
  }, [editorRef]);

  // Build dynamic actions list based on context (uses captured selection)
  const getActions = useCallback((): MenuItem[] => {
    const editor = activeEditorRef.current || editorRef.current;
    const captured = capturedSelection.current;
    const from = captured?.from ?? 0;
    const to = captured?.to ?? 0;
    const hasSelection = from !== to;
    const isEmptyNode = (() => {
      if (!editor) return false;
      try {
        const $from = editor.state.doc.resolve(from);
        return $from.parent.content.size === 0;
      } catch { return false; }
    })();

    const hasPending = selectionHasPending();

    // Plugin items first (filtered by condition)
    const items: MenuItem[] = [];
    for (const pi of pluginItems) {
      if (pi.condition === 'has-selection' && !hasSelection) continue;
      if (pi.condition === 'empty-node' && !isEmptyNode) continue;
      items.push({
        action: pi.action,
        label: pi.label,
        shortcut: pi.shortcut,
        isPlugin: true,
        promptForInput: pi.promptForInput,
        pluginDisplayName: pi.pluginDisplayName,
      });
    }

    // Core actions
    for (const ca of CORE_ACTIONS) {
      // Comment: only show with text selection and no pending overlap
      if (ca.condition === 'has-selection' && (!hasSelection || hasPending)) continue;
      items.push(ca);
    }
    if (hasSelection) {
      items.push({ action: 'link', label: 'Link to doc', shortcut: 'L' });
    }
    if (isOnLink()) {
      items.push({ action: 'unlink', label: 'Unlink' });
    }
    if (bookmarkTarget) {
      const existing = bookmarks.find((b) => b.nodeId === bookmarkTarget);
      items.push({ action: 'bookmark', label: existing ? 'Edit bookmark' : 'Add bookmark' });
      if (existing) items.push({ action: 'remove-bookmark', label: 'Remove bookmark' });
    }
    // "See connections" surfaces when right-click landed on a linked paragraph.
    // Show it first — it's the most relevant action for a linked node.
    if (backlinksMenu && backlinksMenu.entries.length > 0) {
      items.unshift({
        action: 'see-connections',
        label: `See connections (${backlinksMenu.entries.length})`,
      });
    }
    // "Go to target" surfaces when right-click landed on an outbound `.doc-link`.
    // Same affordance as left-click navigation, just discoverable via context menu.
    if (docLinkTarget) {
      const label = docLinkTarget.title
        ? `Go to "${docLinkTarget.title}"`
        : 'Go to target';
      items.unshift({ action: 'go-to-target', label });
    }
    return items;
  }, [editorRef, isOnLink, pluginItems, selectionHasPending, backlinksMenu, docLinkTarget, bookmarkTarget, bookmarks]);

  // Open on right-click in editor — capture selection BEFORE the click changes it
  useEffect(() => {
    const captureSelectionOnMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return; // Only right-click
      const editor = findEditorForTarget(e.target as Node);
      if (!editor) return;
      activeEditorRef.current = editor;

      // Capture the current selection state NOW, before ProseMirror handles the mousedown
      const { from, to } = editor.state.selection;
      const nodes: any[] = [];
      const nodeIds: string[] = [];

      if (from !== to) {
        editor.state.doc.nodesBetween(from, to, (node) => {
          if (node.isBlock && node.type.name !== 'doc') {
            nodes.push(node.toJSON());
            if (node.attrs.id) nodeIds.push(node.attrs.id);
          }
        });
      }

      // Fallback: cursor on a block with no selection
      if (nodes.length === 0) {
        const { $from } = editor.state.selection;
        const parentNode = $from.parent;
        if (parentNode && parentNode.type.name !== 'doc') {
          nodes.push(parentNode.toJSON());
          if (parentNode.attrs?.id) nodeIds.push(parentNode.attrs.id);
        }
      }

      const text = from !== to ? editor.state.doc.textBetween(from, to, '\n') : '';
      capturedSelection.current = { from, to, nodes, nodeIds, text };
    };

    const handleContextMenu = (e: MouseEvent) => {
      const editor = findEditorForTarget(e.target as Node);
      if (!editor) return;

      // Shift+right-click passes through to native menu (spellcheck, etc.)
      if (e.shiftKey) return;

      // Right-clicking on an existing comment: show comment-only menu (Edit/Resolve)
      const commentEl = (e.target as Element | null)?.closest?.('[data-comment-id]') as HTMLElement | null;
      const commentId = commentEl?.getAttribute('data-comment-id') || null;

      // Right-clicking on a linked paragraph: capture its backlinks for "See connections"
      const linkedEl = (e.target as Element | null)?.closest?.('.linked-paragraph[data-backlinks-node]') as HTMLElement | null;
      const linkedNodeId = linkedEl?.getAttribute('data-backlinks-node') || null;

      // Right-clicking on an outbound .doc-link: capture target for "Go to target".
      // PadLink renders internal links as `<span class="doc-link" data-doc="DOCID[#NODEID][?quote=…]">`
      // (see editor/extensions.ts). data-doc is everything after the `doc:` prefix.
      const docLinkEl = (e.target as Element | null)?.closest?.('span.doc-link[data-doc]') as HTMLElement | null;
      const docLinkData = docLinkEl?.getAttribute('data-doc') || null;

      // The paragraph actually under the pointer; the captured selection is
      // wherever the cursor was before the right-click.
      let clickedBlockId: string | null = null;
      const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (hit) {
        const $pos = editor.state.doc.resolve(hit.pos);
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d);
          if (node.isTextblock && node.attrs?.id) { clickedBlockId = node.attrs.id; break; }
        }
      }
      setBookmarkTarget(clickedBlockId);
      setBookmarkEditor(null);

      e.preventDefault();
      setPosition({ x: e.clientX, y: e.clientY });
      setVisible(true);
      setShowCustom(false);
      setShowLinkPicker(false);
      setShowBacklinksPanel(false);
      setShowCommentInput(false);
      setCommentNote('');
      setEditingComment(null);

      if (commentId) {
        // If the user has a non-empty selection at right-click time, they
        // probably want to act on the selection — including placing a
        // sub-range comment inside an existing one. Fall through to the
        // regular menu in that case. Only show the comment-only menu when
        // the right-click is on a comment WITHOUT a fresh selection.
        const sel = capturedSelection.current;
        const hasSelection = !!sel && sel.from !== sel.to;
        if (!hasSelection) {
          const comment = getCommentsData().find((c) => c.id === commentId);
          if (comment) {
            setCommentOnlyMenu({ id: comment.id, text: comment.text, note: comment.note });
            setBacklinksMenu(null);
            return;
          }
        }
      }
      setCommentOnlyMenu(null);

      if (linkedNodeId) {
        const entries = getBacklinksForNode(linkedNodeId);
        setBacklinksMenu(entries.length > 0 ? { nodeId: linkedNodeId, entries } : null);
      } else {
        setBacklinksMenu(null);
      }

      // Parse outbound doc-link target. data-doc is the post-`doc:` substring:
      //   DOCID                — whole doc
      //   DOCID#NODEID         — paragraph anchor
      //   DOCID#NODEID?quote=… — paragraph anchor + quote (quote ignored for nav)
      // Falls back to null if data-doc can't be parsed.
      if (docLinkData) {
        const queryIdx = docLinkData.indexOf('?');
        const head = queryIdx >= 0 ? docLinkData.slice(0, queryIdx) : docLinkData;
        const [docIdRaw, nodeIdRaw] = head.split('#');
        const docId = docIdRaw && /^[a-f0-9]{8}$/.test(docIdRaw) ? docIdRaw : null;
        const nodeId = nodeIdRaw && /^[a-f0-9]{8}$/.test(nodeIdRaw) ? nodeIdRaw : null;
        if (docId) {
          // Resolve title from the existing doc list if present; otherwise fetch.
          const cached = docList.find((d) => d.docId === docId);
          setDocLinkTarget({ docId, nodeId, title: cached?.title || null });
          if (!cached) {
            fetch('/api/documents')
              .then((r) => r.json())
              .then((docs) => {
                if (Array.isArray(docs)) {
                  const list = docs.map((d: any) => ({ filename: d.filename, title: d.title, docId: d.docId }));
                  setDocList(list);
                  const found = list.find((d) => d.docId === docId);
                  if (found) setDocLinkTarget((cur) => cur && cur.docId === docId ? { ...cur, title: found.title } : cur);
                }
              })
              .catch(() => {});
          }
        } else {
          setDocLinkTarget(null);
        }
      } else {
        setDocLinkTarget(null);
      }
    };

    // mousedown fires BEFORE ProseMirror's selection update
    document.addEventListener('mousedown', captureSelectionOnMouseDown, true);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('mousedown', captureSelectionOnMouseDown, true);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [findEditorForTarget]);

  const callPluginAction = useCallback(async (action: string, instruction?: string) => {
    const editor = activeEditorRef.current || editorRef.current;
    if (!editor) return;

    // Use captured selection from right-click time (before ProseMirror changed cursor)
    const captured = capturedSelection.current;
    if (!captured || captured.nodes.length === 0) {
      console.warn('[ContextMenu] No captured selection for action:', action);
      return;
    }

    let { nodes, nodeIds } = captured;
    const { from, to } = captured;

    setLoading(true);
    setVisible(false);
    setShowCustom(false);

    const loadingId = `ctx-${Date.now()}`;
    // Strip namespace prefix early (needed for action-type detection)
    const backendAction = action.includes(':') ? action.split(':').slice(1).join(':') : action;
    const isInsertAction = ['insert', 'fill', 'fill-sentence'].includes(backendAction);

    if (isInsertAction) {
      // Bouncing-dots spinner at cursor position (works for empty + inline)
      editor.commands.showInsertionLoading(loadingId, from);
    } else {
      // Sub-paragraph selection (sentence/word): blur just the selected range
      const $from = editor.state.doc.resolve(from);
      const $to = editor.state.doc.resolve(to);
      const sameBlock = $from.sameParent($to) && from !== to;
      editor.commands.applyLoadingEffect(loadingId, from, to, sameBlock ? 'selection' : 'paragraph');
    }

    try {
      const nodesBefore: string[] = [];
      const nodesAfter: string[] = [];
      const targetIdSet = new Set(nodeIds);
      let pastTarget = false;

      // Iterate top-level doc children only — collect plain text
      const doc = editor.state.doc;
      for (let i = 0; i < doc.childCount; i++) {
        const child = doc.child(i);
        const childId = child.attrs?.id;
        if (childId && targetIdSet.has(childId)) {
          pastTarget = true;
        } else if (!pastTarget) {
          const text = child.textContent.trim();
          if (text) nodesBefore.push(text);
        } else {
          const text = child.textContent.trim();
          if (text) nodesAfter.push(text);
        }
      }

      // Sub-paragraph selection: inject [[START_SELECTION]]/[[END_SELECTION]] markers
      // so the backend AI only modifies the selected text
      let markedNodes = nodes;
      let isSubParagraph = false;
      let subParaStartOffset = 0;
      let subParaEndOffset = 0;
      const $from = from !== to ? editor.state.doc.resolve(from) : null;
      const $to = from !== to ? editor.state.doc.resolve(to) : null;
      const sameBlock = $from && $to ? $from.sameParent($to) : false;
      if (sameBlock && $from && nodes.length === 1) {
        const contentStart = $from.start($from.depth);
        subParaStartOffset = from - contentStart;
        subParaEndOffset = to - contentStart;
        const nodeTextLength = nodes[0]?.content
          ?.reduce((len: number, c: any) => len + (c.text?.length || (c.type === 'hardBreak' ? 1 : 0)), 0) ?? 0;
        // Only inject markers for partial selections (not full paragraph)
        if (subParaStartOffset > 0 || subParaEndOffset < nodeTextLength) {
          markedNodes = injectSelectionMarkers(nodes, subParaStartOffset, subParaEndOffset);
          isSubParagraph = true;
        }
      }

      // Full document text for broad context awareness
      const fullDocText = editor.state.doc.textContent;

      const body: any = {
        nodes: markedNodes,
        action: backendAction,
        nodeIds,
        contextBefore: nodesBefore.slice(-3),
        contextAfter: nodesAfter.slice(0, 3),
        fullDocument: fullDocText,
        documentId,
        debug: true,
      };
      if (isSubParagraph) body.hasSelectionMarkers = true;
      if (instruction) body.instruction = instruction;

      // ── Selection-size guard (toast + cancel before the request) ──
      const selectionText = (nodes || [])
        .map((n: any) => (Array.isArray(n?.content) ? n.content.map((p: any) => p?.text || '').join(' ') : ''))
        .join(' ');
      const selectionWords = (selectionText.match(/\S+/g) || []).length;
      if (selectionWords > MAX_SELECTION_WORDS) {
        showToast(`Selection too large: ${selectionWords.toLocaleString()} words (max ${MAX_SELECTION_WORDS.toLocaleString()}). Select a smaller section.`, 'error');
        if (isInsertAction) editor.commands.removeInsertionLoading(loadingId);
        else editor.commands.removeLoadingEffect(loadingId);
        return;
      }

      const res = await fetch(`${window.location.origin}/api/voice/apply-editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('[ContextMenu] API error:', res.status, errData);
        // Surface the failure instead of dropping silently after the blur. The API owns the
        // user-facing copy (single-source control): billing/rate-limit errors carry `message`
        // (insufficient_balance, rate_limited, free_limit_reached); validation/size errors carry
        // `error`. Prefer message → error → a status fallback.
        const msg = (typeof errData?.message === 'string' && errData.message)
          || (typeof errData?.error === 'string' && errData.error)
          || `Enhance failed (${res.status}). Please try again.`;
        // Insufficient balance (HTTP 402, `error: 'insufficient_balance'`) is recoverable: give
        // the user a one-click "Top up" affordance that opens Stripe checkout (default $5) via
        // the proxied billing route, instead of a dead-end error. Other errors stay plain toasts.
        if (res.status === 402 && errData?.error === 'insufficient_balance') {
          showToast(msg, 'error', 9000, { label: 'Top up', onClick: () => openTopupCheckout(5) });
        } else {
          showToast(msg, 'error');
        }
        return;
      }

      const data = await res.json();
      if (data.success && data.nodes) {
        // Flatten nested arrays (backend sometimes wraps in extra array)
        let responseNodes = data.nodes;
        if (responseNodes.length === 1 && Array.isArray(responseNodes[0])) {
          responseNodes = responseNodes[0];
        }
        // Strip selection markers from response before applying
        stripSelectionMarkers(responseNodes);

        if (isSubParagraph && responseNodes.length === 1 && nodeIds.length === 1) {
          // Sub-paragraph: highlight the span that actually changed.
          //
          // The selection offsets (subParaStartOffset/EndOffset) only describe
          // what the user *picked*. The model rewrites holistically — it can
          // alter text outside the selection and change the selected text's
          // length — so trusting those offsets paints the wrong characters
          // (mid-word cutoffs, or coloring an unchanged prefix). Instead, diff
          // the original node text against the rewritten node text: the changed
          // region is everything between the longest common prefix and the
          // longest common suffix. This survives a holistic rewrite because it
          // measures real divergence, and it naturally falls back to the whole
          // node when prefix/suffix don't survive.
          //
          // Offsets count text chars + hardBreak (→'\n', 1 char) to match
          // mapTextOffsetToPos in decorations/plugin.ts.
          const linearText = (content: any[]) =>
            (content ?? []).reduce((s: string, c: any) =>
              s + (typeof c.text === 'string' ? c.text : (c.type === 'hardBreak' ? '\n' : '')), '');
          const originalStr = linearText(nodes[0]?.content);
          const newStr = linearText(responseNodes[0]?.content);

          const maxLen = Math.min(originalStr.length, newStr.length);
          let prefix = 0;
          while (prefix < maxLen && originalStr[prefix] === newStr[prefix]) prefix++;
          let suffix = 0;
          const maxSuffix = maxLen - prefix; // keep prefix/suffix from overlapping
          while (
            suffix < maxSuffix &&
            originalStr[originalStr.length - 1 - suffix] === newStr[newStr.length - 1 - suffix]
          ) suffix++;

          const selectionRange: SelectionRange = {
            selectionFrom: prefix,
            selectionTo: newStr.length - suffix,
            originalFrom: prefix,
            originalTo: originalStr.length - suffix,
          };
          applyRewrite(editor, nodeIds[0], responseNodes[0], selectionRange);
        } else {
          // Full node / multi-node: full-node decoration (no inline diffs)
          applyNodeChangesFromBridge(editor, responseNodes, nodeIds, backendAction);
        }
        // Signal the right rail to switch to Review — pending changes landed in the
        // editor directly (client-side), so the server's pending-docs-changed event
        // hasn't fired yet and the RailIconStrip 0→>0 guard won't catch this.
        window.dispatchEvent(new CustomEvent('ow-pending-write-applied'));

        // Prompt debug inspector: persist the realized AV prompt as a timestamped
        // sidebar doc for hand review. The server no-ops unless OW_PROMPT_DEBUG is on,
        // so this POST is harmless when the switch is off. See docs/prompt-debug.md.
        if (data.debug) {
          fetch('/api/prompt-debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: backendAction, debug: data.debug, metadata: data.metadata }),
          }).catch(() => {});
        }
      } else {
        console.warn('[ContextMenu] Unexpected response:', data);
      }
    } catch (err) {
      console.error('[ContextMenu] Plugin action failed:', err);
    } finally {
      if (isInsertAction) {
        editor.commands.removeInsertionLoading(loadingId);
      } else {
        editor.commands.removeLoadingEffect(loadingId);
      }
      setLoading(false);
    }
  }, [editorRef]);

  const handleImageGenAction = useCallback(async (instruction: string) => {
    const editor = activeEditorRef.current || editorRef.current;
    if (!editor) return;

    const { $from } = editor.state.selection;
    const from = $from.before($from.depth);
    const to = $from.after($from.depth);
    const isEmptyNode = $from.parent.content.size === 0;

    setLoading(true);
    setVisible(false);
    setShowCustom(false);

    // Insert imageLoading placeholder
    const insertPos = isEmptyNode ? from : to;
    if (isEmptyNode) {
      editor.chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, { type: 'imageLoading' })
        .run();
    } else {
      editor.chain()
        .focus()
        .insertContentAt(to, { type: 'imageLoading' })
        .run();
    }

    // Find the imageLoading node we just inserted
    let loadingPos = -1;
    let loadingNodeSize = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'imageLoading' && loadingPos === -1) {
        loadingPos = pos;
        loadingNodeSize = node.nodeSize;
        return false;
      }
    });

    try {
      const res = await fetch('/api/image-gen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: instruction }),
      });

      const data = await res.json().catch(() => ({ success: false, error: `Generation failed (${res.status})` }));
      if (data.success && data.src) {
        // Find the imageLoading node again (positions may have shifted)
        let currentPos = -1;
        let currentSize = 0;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'imageLoading' && currentPos === -1) {
            currentPos = pos;
            currentSize = node.nodeSize;
            return false;
          }
        });
        if (currentPos >= 0) {
          const { tr } = editor.state;
          tr.replaceWith(currentPos, currentPos + currentSize,
            editor.schema.nodes.image.create({ src: data.src, alt: instruction }));
          editor.view.dispatch(tr);
        }
      } else {
        console.error('[ContextMenu] Image generation failed:', data.error);
        // Remove the placeholder on failure
        let currentPos = -1;
        let currentSize = 0;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'imageLoading' && currentPos === -1) {
            currentPos = pos;
            currentSize = node.nodeSize;
            return false;
          }
        });
        if (currentPos >= 0) {
          const { tr } = editor.state;
          tr.delete(currentPos, currentPos + currentSize);
          editor.view.dispatch(tr);
        }
      }
    } catch (err) {
      console.error('[ContextMenu] Image generation failed:', err);
      // Remove the placeholder on error
      let currentPos = -1;
      let currentSize = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'imageLoading' && currentPos === -1) {
          currentPos = pos;
          currentSize = node.nodeSize;
          return false;
        }
      });
      if (currentPos >= 0) {
        const { tr } = editor.state;
        tr.delete(currentPos, currentPos + currentSize);
        editor.view.dispatch(tr);
      }
    } finally {
      setLoading(false);
    }
  }, [editorRef]);

  const handleAction = useCallback((item: MenuItem) => {
    const { action, isPlugin, promptForInput } = item;

    if (isPlugin && promptForInput) {
      setCustomAction(action);
      setShowCustom(true);
      return;
    }
    if (isPlugin) {
      if (action.startsWith('img:')) {
        // Image gen actions with no prompt — shouldn't happen (all have promptForInput)
        return;
      }
      callPluginAction(action);
      return;
    }
    if (action === 'comment') {
      setShowCommentInput(true);
      return;
    }
    if (action === 'delete') {
      const editor = activeEditorRef.current || editorRef.current;
      const captured = capturedSelection.current;
      if (editor && captured && captured.nodeIds.length > 0) {
        const { tr } = editor.state;
        const idsToDelete = new Set(captured.nodeIds);
        const ranges: { from: number; to: number }[] = [];

        editor.state.doc.descendants((node, pos) => {
          if (node.attrs?.id && idsToDelete.has(node.attrs.id)) {
            ranges.push({ from: pos, to: pos + node.nodeSize });
            return false;
          }
        });

        // Delete in reverse order to maintain valid positions
        for (const range of ranges.reverse()) {
          tr.delete(range.from, range.to);
        }
        if (ranges.length > 0) editor.view.dispatch(tr);
      }
      setVisible(false);
      return;
    }
    if (action === 'link') {
      const editor = activeEditorRef.current || editorRef.current;
      if (editor) {
        const ids: string[] = [];
        editor.state.doc.descendants((node) => {
          node.marks?.forEach((mark: any) => {
            if (mark.type.name === 'link' && mark.attrs?.href?.startsWith('doc:')) {
              const id = linkHrefIdentifier(mark.attrs.href);
              if (id && !ids.includes(id)) ids.push(id);
            }
          });
        });
        setLinkedDocs(ids);
      }
      fetch('/api/documents')
        .then((r) => r.json())
        .then((docs) => {
          if (Array.isArray(docs)) {
            setDocList(docs.map((d: any) => ({ filename: d.filename, title: d.title, docId: d.docId })));
          }
          setShowNewLinkInput(false);
          setNewLinkTitle('');
          setShowLinkPicker(true);
        })
        .catch(() => {});
      return;
    }
    if (action === 'unlink') {
      const editor = activeEditorRef.current || editorRef.current;
      if (editor) {
        editor.chain().focus().unsetLink().run();
      }
      setVisible(false);
      return;
    }
    if (action === 'see-connections') {
      // Preload doc list so we can resolve from_doc → title for the panel.
      fetch('/api/documents')
        .then((r) => r.json())
        .then((docs) => {
          if (Array.isArray(docs)) {
            setDocList(docs.map((d: any) => ({ filename: d.filename, title: d.title, docId: d.docId })));
          }
        })
        .catch(() => {});
      setShowBacklinksPanel(true);
      return;
    }
    if (action === 'bookmark' && bookmarkTarget) {
      const existing = getBookmarks().find((b) => b.nodeId === bookmarkTarget);
      setBookmarkEditor({ nodeId: bookmarkTarget, id: existing?.id });
      setBookmarkNote(existing?.note || '');
      return;
    }
    if (action === 'remove-bookmark') {
      const existing = getBookmarks().find((b) => b.nodeId === bookmarkTarget);
      if (existing) removeBookmark(existing.id);
      setVisible(false);
      return;
    }
    if (action === 'go-to-target') {
      if (docLinkTarget) {
        window.dispatchEvent(new CustomEvent('ow-navigate-to-link', {
          detail: { docId: docLinkTarget.docId, nodeId: docLinkTarget.nodeId, filename: null, quote: null },
        }));
      }
      setVisible(false);
      setDocLinkTarget(null);
      return;
    }
  }, [callPluginAction, editorRef, docLinkTarget, bookmarkTarget]);

  // Clicking a margin bookmark icon opens its note editor at the icon.
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, x, y } = (e as CustomEvent).detail || {};
      const bookmark = getBookmarks().find((b) => b.id === id);
      if (!bookmark) return;
      setCommentOnlyMenu(null);
      setShowCommentInput(false);
      setShowCustom(false);
      setShowLinkPicker(false);
      setShowBacklinksPanel(false);
      setParagraphPicker(null);
      setBookmarkTarget(bookmark.nodeId);
      setBookmarkEditor({ nodeId: bookmark.nodeId, id: bookmark.id });
      setBookmarkNote(bookmark.note);
      setPosition({ x, y });
      setVisible(true);
    };
    window.addEventListener('ow-bookmark-open', handler);
    return () => window.removeEventListener('ow-bookmark-open', handler);
  }, []);

  const closeBookmarkEditor = useCallback(() => {
    setVisible(false);
    setBookmarkEditor(null);
    setBookmarkNote('');
  }, []);

  const handleBookmarkSave = useCallback(() => {
    if (!bookmarkEditor) return;
    if (bookmarkEditor.id) editBookmark(bookmarkEditor.id, bookmarkNote.trim());
    else addBookmark(bookmarkEditor.nodeId, bookmarkNote.trim());
    closeBookmarkEditor();
  }, [bookmarkEditor, bookmarkNote, closeBookmarkEditor]);

  const handleBookmarkRemove = useCallback(() => {
    if (bookmarkEditor?.id) removeBookmark(bookmarkEditor.id);
    closeBookmarkEditor();
  }, [bookmarkEditor, closeBookmarkEditor]);

  const handleCustomSubmit = useCallback(() => {
    if (customInput.trim()) {
      if (customAction.startsWith('img:')) {
        handleImageGenAction(customInput.trim());
      } else {
        callPluginAction(customAction, customInput.trim());
      }
      setCustomInput('');
      setCustomAction('');
    }
  }, [callPluginAction, handleImageGenAction, customAction, customInput]);

  const handleCommentSubmit = useCallback(() => {
    if (!documentId) return;

    // Edit mode: PATCH existing mark
    if (editingComment) {
      fetch('/api/comments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: documentId,
          id: editingComment.id,
          note: commentNote.trim(),
        }),
      })
        .then(() => {
          setVisible(false);
          setShowCommentInput(false);
          setCommentNote('');
          setEditingComment(null);
        })
        .catch((err) => {
          console.error('[ContextMenu] Comment edit failed:', err);
        });
      return;
    }

    // Create mode: POST new mark from captured selection
    const editor = activeEditorRef.current || editorRef.current;
    const captured = capturedSelection.current;
    if (!editor || !captured) return;

    const { text: selectedText, nodeIds } = captured;
    if (nodeIds.length === 0 || !selectedText.trim()) return;

    fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: documentId,
        text: selectedText,
        note: commentNote.trim(),
        nodeId: nodeIds[nodeIds.length - 1],
        nodeIds: nodeIds,
      }),
    })
      .then(() => {
        setVisible(false);
        setShowCommentInput(false);
        setCommentNote('');
      })
      .catch((err) => {
        console.error('[ContextMenu] Comment create failed:', err);
      });
  }, [editorRef, documentId, commentNote, editingComment]);

  const handleCommentEdit = useCallback(() => {
    if (!commentOnlyMenu) return;
    setEditingComment({ id: commentOnlyMenu.id, text: commentOnlyMenu.text });
    setCommentNote(commentOnlyMenu.note);
    setShowCommentInput(true);
    setCommentOnlyMenu(null);
  }, [commentOnlyMenu]);

  // Resolve = "agent addressed this, archive it" (state change, kept in history)
  const handleCommentResolve = useCallback(() => {
    if (!commentOnlyMenu) return;
    fetch('/api/comments/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [commentOnlyMenu.id] }),
    })
      .then(() => {
        setVisible(false);
        setCommentOnlyMenu(null);
      })
      .catch((err) => {
        console.error('[ContextMenu] Comment resolve failed:', err);
      });
  }, [commentOnlyMenu]);

  // Delete = "remove this record permanently" (destructive, different intent from Resolve)
  const handleCommentDelete = useCallback(() => {
    if (!commentOnlyMenu) return;
    fetch('/api/comments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [commentOnlyMenu.id] }),
    })
      .then(() => {
        setVisible(false);
        setCommentOnlyMenu(null);
      })
      .catch((err) => {
        console.error('[ContextMenu] Comment delete failed:', err);
      });
  }, [commentOnlyMenu]);

  const handleLinkSelect = useCallback((
    doc: { filename: string; docId?: string },
    extras?: { nodeId?: string; quote?: string },
  ) => {
    const editor = activeEditorRef.current || editorRef.current;
    if (editor) {
      // Prefer stable docId; fall back to filename for docs that haven't been
      // touched since the docId/caret-anchor migration landed.
      const href = doc.docId
        ? formatLinkHref({ docId: doc.docId, nodeId: extras?.nodeId, quote: extras?.quote })
        : formatLinkHref({ filename: doc.filename });
      editor.chain().focus().setLink({ href }).run();
    }
    fetch('/api/auto-tag-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetFile: doc.filename }),
    }).catch(() => {});
    setVisible(false);
    setShowLinkPicker(false);
    setParagraphPicker(null);
  }, [editorRef]);

  // Drill into a doc's paragraphs for paragraph-level link targeting.
  // Whole-doc click (single-row click) keeps the existing handleLinkSelect path;
  // this is the ▸ button affordance per row.
  const openParagraphPicker = useCallback((doc: { filename: string; docId?: string; title: string }) => {
    if (!doc.docId) {
      // Legacy doc without docId — can't paragraph-target. Fall back to whole-doc.
      handleLinkSelect(doc);
      return;
    }
    setParagraphPicker({ docId: doc.docId, filename: doc.filename, title: doc.title, paragraphs: [], loading: true });
    fetch(`/api/documents/by-doc-id/${doc.docId}/paragraphs`)
      .then((r) => r.json())
      .then((data) => {
        setParagraphPicker((cur) => cur && cur.docId === doc.docId
          ? { ...cur, paragraphs: Array.isArray(data.paragraphs) ? data.paragraphs : [], loading: false }
          : cur);
      })
      .catch(() => {
        setParagraphPicker((cur) => cur && cur.docId === doc.docId
          ? { ...cur, paragraphs: [], loading: false }
          : cur);
      });
  }, [handleLinkSelect]);

  const handleNewLinkDoc = useCallback(() => {
    const title = newLinkTitle.trim();
    if (!title) return;
    const editor = activeEditorRef.current || editorRef.current;
    if (!editor) return;

    fetch('/api/create-link-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.filename) {
          // New doc may not have a docId yet (assigned on first proper load).
          // Use docId if present; otherwise legacy filename — resolver handles both.
          const href = formatLinkHref(data.docId ? { docId: data.docId } : { filename: data.filename });
          editor.chain().focus().setLink({ href }).run();
        }
      })
      .catch(() => {});

    setVisible(false);
    setShowLinkPicker(false);
    setShowNewLinkInput(false);
    setNewLinkTitle('');
  }, [editorRef, newLinkTitle]);

  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {loading ? (
        <div className="context-menu-loading">Applying...</div>
      ) : bookmarkEditor ? (
        <div className="context-menu-comment-editor">
          <textarea
            autoFocus
            className="context-menu-comment-textarea"
            value={bookmarkNote}
            onChange={(e) => setBookmarkNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleBookmarkSave();
              }
              if (e.key === 'Escape') closeBookmarkEditor();
            }}
            placeholder="Note to self (optional)..."
            rows={3}
          />
          <div className="context-menu-comment-actions">
            <span className="context-menu-comment-hint">↵ to save · Esc to cancel</span>
            {bookmarkEditor.id && <button className="context-menu-bookmark-remove" onClick={handleBookmarkRemove}>Remove</button>}
            <button onClick={handleBookmarkSave}>{bookmarkEditor.id ? 'Save' : 'Add bookmark'}</button>
          </div>
        </div>
      ) : showCommentInput ? (
        <div className="context-menu-comment-editor">
          {(() => {
            const quoted = editingComment?.text
              ?? capturedSelection.current?.text ?? '';
            return quoted ? <div className="context-menu-comment-quote">{quoted}</div> : null;
          })()}
          <textarea
            autoFocus
            className="context-menu-comment-textarea"
            value={commentNote}
            onChange={(e) => setCommentNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCommentSubmit();
              }
              if (e.key === 'Escape') {
                setVisible(false);
                setShowCommentInput(false);
                setCommentNote('');
                setEditingComment(null);
              }
            }}
            placeholder="Note for agent (optional)..."
            rows={4}
          />
          <div className="context-menu-comment-actions">
            <span className="context-menu-comment-hint">⌘↵ to save · Esc to cancel</span>
            <button onClick={handleCommentSubmit}>{editingComment ? 'Save' : 'Comment'}</button>
          </div>
        </div>
      ) : commentOnlyMenu ? (
        <>
          <button className="context-menu-item" onClick={handleCommentEdit}>
            <span>Edit comment</span>
          </button>
          <button className="context-menu-item" onClick={handleCommentResolve}>
            <span>Resolve comment</span>
          </button>
          <button className="context-menu-item" onClick={handleCommentDelete}>
            <span>Delete comment</span>
          </button>
        </>
      ) : showCustom ? (
        <div className="context-menu-custom">
          <input
            autoFocus
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomSubmit();
              if (e.key === 'Escape') setVisible(false);
            }}
            placeholder="Custom instruction..."
          />
          <button onClick={handleCustomSubmit}>Apply</button>
        </div>
      ) : paragraphPicker ? (
        <div className="context-menu-link-picker">
          <div className="context-menu-link-header">
            <button
              className="context-menu-link-back"
              onClick={() => setParagraphPicker(null)}
              title="Back to doc list"
            >
              ←
            </button>
            <span>Pick paragraph in "{paragraphPicker.title}"</span>
          </div>
          <button
            className="context-menu-item context-menu-new-link"
            onClick={() => handleLinkSelect({ filename: paragraphPicker.filename, docId: paragraphPicker.docId })}
          >
            <span>Link whole doc</span>
          </button>
          <div className="context-menu-link-list">
            {paragraphPicker.loading ? (
              <div className="context-menu-loading">Loading…</div>
            ) : paragraphPicker.paragraphs.length === 0 ? (
              <div className="context-menu-loading">No paragraphs</div>
            ) : (
              paragraphPicker.paragraphs.map((p) => {
                const quote = p.preview.replace(/…$/, '').slice(0, 50);
                const indent = p.type === 'heading' ? Math.max(0, (p.level || 1) - 1) * 12 : 12;
                return (
                  <button
                    key={p.nodeId}
                    className={`context-menu-item context-menu-paragraph-row context-menu-paragraph-row--${p.type}`}
                    style={{ paddingLeft: 8 + indent }}
                    onClick={() => handleLinkSelect(
                      { filename: paragraphPicker.filename, docId: paragraphPicker.docId },
                      { nodeId: p.nodeId, quote },
                    )}
                  >
                    <span>{p.preview}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : showBacklinksPanel && backlinksMenu ? (
        <div className="context-menu-link-picker">
          <div className="context-menu-link-header">
            Linked from {backlinksMenu.entries.length} {backlinksMenu.entries.length === 1 ? 'place' : 'places'}
          </div>
          <div className="context-menu-link-list">
            {backlinksMenu.entries.map((entry, idx) => {
              const sourceDoc = docList.find((d) => d.docId === entry.from_doc);
              const sourceTitle = sourceDoc?.title || entry.from_doc;
              return (
                <button
                  key={`${entry.from_doc}-${entry.from_node}-${idx}`}
                  className="context-menu-item"
                  onClick={() => {
                    // Navigate to source: dispatch event for App.tsx to route via handleLinkClick
                    window.dispatchEvent(new CustomEvent('ow-navigate-to-link', {
                      detail: { docId: entry.from_doc, nodeId: entry.from_node, filename: null, quote: null },
                    }));
                    setVisible(false);
                    setShowBacklinksPanel(false);
                  }}
                >
                  <span>{sourceTitle}</span>
                  <span className="context-menu-shortcut">"{entry.text}"</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : showLinkPicker ? (
        <div className="context-menu-link-picker">
          <div className="context-menu-link-header">Link to document</div>
          {showNewLinkInput ? (
            <div className="context-menu-custom">
              <input
                autoFocus
                value={newLinkTitle}
                onChange={(e) => setNewLinkTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewLinkDoc();
                  if (e.key === 'Escape') setShowNewLinkInput(false);
                }}
                placeholder="New document title..."
              />
              <button onClick={handleNewLinkDoc}>Create</button>
            </div>
          ) : (
            <button
              className="context-menu-item context-menu-new-link"
              onClick={() => setShowNewLinkInput(true)}
            >
              <span>+ New link doc</span>
            </button>
          )}
          <div className="context-menu-link-list">
            {linkedDocs.length > 0 && (
              <>
                <div className="context-menu-section-header">Linked in this doc</div>
                {docList
                  .filter((d) => isDocLinked(d, linkedDocs))
                  .map((d) => (
                    <div key={`linked-${d.filename}`} className="context-menu-link-row">
                      <button
                        className="context-menu-item context-menu-link-row__main"
                        onClick={() => handleLinkSelect(d)}
                      >
                        <span>{d.title}</span>
                      </button>
                      {d.docId && (
                        <button
                          className="context-menu-link-row__drill"
                          title="Pick a paragraph in this doc"
                          onClick={() => openParagraphPicker(d)}
                        >
                          ▸
                        </button>
                      )}
                    </div>
                  ))}
              </>
            )}
            <div className="context-menu-section-header">All documents</div>
            {docList
              .filter((d) => !isDocLinked(d, linkedDocs))
              .map((d) => (
                <div key={d.filename} className="context-menu-link-row">
                  <button
                    className="context-menu-item context-menu-link-row__main"
                    onClick={() => handleLinkSelect(d)}
                  >
                    <span>{d.title}</span>
                  </button>
                  {d.docId && (
                    <button
                      className="context-menu-link-row__drill"
                      title="Pick a paragraph in this doc"
                      onClick={() => openParagraphPicker(d)}
                    >
                      ▸
                    </button>
                  )}
                </div>
              ))}
            {docList.length === 0 && (
              <div className="context-menu-loading">No documents</div>
            )}
          </div>
        </div>
      ) : (
        (() => {
          const actions = getActions();
          let lastPluginName: string | undefined;
          return actions.map((item, idx) => {
            const showHeader = item.isPlugin && item.pluginDisplayName && item.pluginDisplayName !== lastPluginName;
            const prevWasPlugin = lastPluginName !== undefined;
            if (item.isPlugin) lastPluginName = item.pluginDisplayName;
            else lastPluginName = undefined;
            const showDivider = !item.isPlugin && prevWasPlugin;
            return (
              <span key={item.action}>
                {showHeader && <div className="context-menu-section-header">{item.pluginDisplayName}</div>}
                {showDivider && <div className="context-menu-divider" />}
                <button
                  className="context-menu-item"
                  onClick={() => handleAction(item)}
                >
                  <span>{item.label}</span>
                  {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
                </button>
              </span>
            );
          });
        })()
      )}
    </div>
  );
}
