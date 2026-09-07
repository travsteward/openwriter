import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { SidebarModeProps, DocumentInfo, WorkspaceNode, ContainerItem, ContentType } from './sidebar-types';
import { collectFiles, isAutoAcceptInheritedForDoc } from './sidebar-utils';
import { useSidebarDrag } from './sidebar-drag';
import { useRevealActiveDoc } from './use-reveal-active-doc';
import SidebarContextMenu from './SidebarContextMenu';
import type { SidebarMenuItem } from './SidebarContextMenu';
import { transformExceedsSizeCap } from './transform-guard';
import FocusInstructionsModal from './FocusInstructionsModal';
import SchedulePostModal from './SchedulePostModal';
import PostToBlogModal from './PostToBlogModal';
import CreateDocDropdown from './CreateDocDropdown';
import NewsletterAnalyticsModal from '../newsletter/NewsletterAnalyticsModal';
import SearchResults from './SearchResults';
import './SidebarFiles.css';
import { sidebarRowProps } from './sidebar-keyboard';

// ─── Icons (monochrome, inherit currentColor) ───

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2z" />
    <line x1="9" y1="14" x2="15" y2="14" opacity="0.5" />
  </svg>
);

const DocIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const ReplyIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" opacity="0.5" />
    <path d="M7 15l-4-3.5L7 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const QuoteIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" opacity="0.5" />
    <path d="M3 8V6.5C3 5.67 3.67 5 4.5 5h2C7.33 5 8 5.67 8 6.5V8c0 2-1.5 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ArticleIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" opacity="0.5" />
    <rect x="2" y="16" width="8" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <line x1="4" y1="18.5" x2="8" y2="18.5" stroke="currentColor" strokeWidth="1" opacity="0.7" />
    <line x1="4" y1="20.5" x2="7" y2="20.5" stroke="currentColor" strokeWidth="1" opacity="0.7" />
  </svg>
);

const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

const NewsletterIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

const BlogIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function ContentIcon({ type }: { type?: ContentType }) {
  switch (type) {
    case 'tweet': return <XIcon />;
    case 'reply': return <ReplyIcon />;
    case 'quote': return <QuoteIcon />;
    case 'article': return <ArticleIcon />;
    case 'linkedin': return <LinkedInIcon />;
    case 'newsletter': return <NewsletterIcon />;
    case 'blog': return <BlogIcon />;
    default: return <DocIcon />;
  }
}

// ─── Helpers ───

function countDocs(nodes: WorkspaceNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === 'doc') n++;
    else if (node.type === 'container') n += countDocs(node.items);
  }
  return n;
}

function findDocPath(nodes: WorkspaceNode[], filename: string): string[] | null {
  for (const n of nodes) {
    if (n.type === 'doc' && n.file === filename) return [];
    if (n.type === 'container') {
      const sub = findDocPath(n.items, filename);
      if (sub) return [n.id, ...sub];
    }
  }
  return null;
}

function getFilenamesInNodes(nodes: WorkspaceNode[]): string[] {
  const files = new Set<string>();
  collectFiles(nodes, files);
  return [...files];
}

/** Find nesting depth of a container by ID (0 = root level child). Returns -1 if not found. */
function findContainerDepth(nodes: WorkspaceNode[], containerId: string, depth = 0): number {
  for (const n of nodes) {
    if (n.type === 'container') {
      if (n.id === containerId) return depth;
      const sub = findContainerDepth(n.items, containerId, depth + 1);
      if (sub >= 0) return sub;
    }
  }
  return -1;
}

/** Compute the left indent (px) for a drop target at a given containerId within a workspace. */
function dropIndentForContainer(workspaces: { workspace?: { root: WorkspaceNode[] } }[], containerId: string | null): number {
  if (!containerId) return 12; // Root level
  for (const ws of workspaces) {
    if (!ws.workspace) continue;
    const depth = findContainerDepth(ws.workspace.root, containerId);
    if (depth >= 0) return 12 + (depth + 1) * 16; // +1 because items inside the container are one level deeper
  }
  return 12;
}

// ─── Component ───

export default function SidebarFiles({
  docs, workspaces, assignedFiles, pendingDocs,
  onSwitchDocument, onCreateDocument, actions, scrollRef,
  writingTitle, writingTarget, pendingWriteFilenames,
  searchQuery, searchResults, searchLoading, searchError, onSearchChange,
}: SidebarModeProps) {
  const isPending = (filename: string) => !!pendingWriteFilenames && pendingWriteFilenames.has(filename);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('ow-files-collapsed');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // Live mirrors so the drag hook (declared before the `selection` state below)
  // can read the current multi-selection and clear it after a cohort move.
  const selectionRef = useRef<Set<string>>(new Set());
  const clearSelectionRef = useRef<() => void>(() => {});

  // Drag and drop
  const { draggedItem, dropIndicator, handlePointerDown, dropClass, isDragging, isContainerDropTarget } = useSidebarDrag({
    docs, workspaces, assignedFiles, scrollRef, setCollapsedSections: setCollapsed,
    selectionRef, onBulkMoved: () => clearSelectionRef.current(),
  });

  // Compute drop indent style for a row — shows the line at the correct nesting level
  const dropIndentStyle = (itemId: string): React.CSSProperties | undefined => {
    if (!dropIndicator || dropIndicator.itemId !== itemId) return undefined;
    if (dropIndicator.position === 'inside') return undefined;
    const indent = dropIndentForContainer(workspaces, dropIndicator.containerId);
    return { '--drop-indent': `${indent}px` } as React.CSSProperties;
  };

  // Variant relationships: group variants under their master doc
  const { variantsByMaster, variantFilenames } = useMemo(() => {
    const map = new Map<string, DocumentInfo[]>();
    const filenames = new Set<string>();
    for (const doc of docs) {
      if (doc.masterDocId) {
        const existing = map.get(doc.masterDocId) || [];
        existing.push(doc);
        map.set(doc.masterDocId, existing);
        filenames.add(doc.filename);
      }
    }
    return { variantsByMaster: map, variantFilenames: filenames };
  }, [docs]);

  // Rename state
  const [renaming, setRenaming] = useState<{ type: 'doc' | 'workspace' | 'container'; key: string; value: string; wsFilename?: string } | null>(null);

  // Doc context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; filename: string; title: string; docId?: string; lastSent?: string; postedUrl?: string; isNewsletter?: boolean; contentType?: string; bulkCount?: number; sortRequest?: DocumentInfo['sortRequest'] } | null>(null);

  // Multi-selection state (for bulk operations; orthogonal to active doc)
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  // Keep the drag hook's mirrors current (see refs declared above useSidebarDrag).
  selectionRef.current = selection;
  clearSelectionRef.current = () => { setSelection(new Set()); setAnchor(null); };
  const [sidebarPluginItems, setSidebarPluginItems] = useState<SidebarMenuItem[]>([]);
  // Schedule Post is wired to /api/scheduler/* (platform publish plugin). Hide
  // the menu item entirely when @openwriter/plugin-publish is disabled — the
  // endpoints will 4xx and the user has no way to know why otherwise.
  const [hasPublishPlugin, setHasPublishPlugin] = useState(false);
  const [focusModal, setFocusModal] = useState<{ action: string; label: string; filename: string; title: string } | null>(null);
  const [scheduleModal, setScheduleModal] = useState<{ filename: string; title: string } | null>(null);
  const [postBlogModal, setPostBlogModal] = useState<{ filename: string; title: string; isActive: boolean } | null>(null);
  const [analyticsModal, setAnalyticsModal] = useState<{ docId: string; title: string } | null>(null);
  const [createDropdown, setCreateDropdown] = useState<{ anchor: DOMRect; wsFilename?: string; containerId?: string | null } | null>(null);

  // Folder context menu state
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; type: 'workspace' | 'container'; wsFilename: string; containerId?: string; title: string; nodes: WorkspaceNode[]; autoAccept?: boolean } | null>(null);

  // Optimistic pending clear — remove dots instantly before server round-trip
  const [clearedPending, setClearedPending] = useState<Set<string>>(new Set());
  // Reset optimistic state when real pendingDocs updates from server
  useEffect(() => { setClearedPending(new Set()); }, [pendingDocs]);

  // Fetch plugin sidebar items
  const fetchSidebarItems = useCallback(() => {
    fetch('/api/plugins')
      .then(r => r.json())
      .then(data => {
        const items: SidebarMenuItem[] = [];
        let publishOn = false;
        for (const plugin of data.plugins || []) {
          const displayName = plugin.displayName || undefined;
          for (const item of plugin.sidebarMenuItems || []) {
            items.push({ ...item, pluginDisplayName: displayName });
          }
          if (plugin.name === '@openwriter/plugin-publish' && plugin.enabled) publishOn = true;
        }
        setSidebarPluginItems(items);
        setHasPublishPlugin(publishOn);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchSidebarItems(); }, [fetchSidebarItems]);
  useEffect(() => {
    const handler = () => fetchSidebarItems();
    window.addEventListener('ow-plugins-changed', handler);
    return () => window.removeEventListener('ow-plugins-changed', handler);
  }, [fetchSidebarItems]);

  const handleDocContextMenu = useCallback((e: React.MouseEvent, doc: DocumentInfo) => {
    e.preventDefault();
    e.stopPropagation();
    // Bulk menu: right-click on a selected doc while multiple are selected
    if (selection.has(doc.filename) && selection.size > 1) {
      setCtxMenu({ x: e.clientX, y: e.clientY, filename: doc.filename, title: doc.title, bulkCount: selection.size });
      return;
    }
    // Right-click on an unselected doc clears any existing selection before showing single-doc menu
    if (selection.size > 0 && !selection.has(doc.filename)) setSelection(new Set());
    setCtxMenu({ x: e.clientX, y: e.clientY, filename: doc.filename, title: doc.title, docId: doc.docId, lastSent: doc.lastSent, postedUrl: doc.postedUrl, isNewsletter: doc.isNewsletter, contentType: doc.contentType, sortRequest: doc.sortRequest });
  }, [selection]);

  const handleDuplicate = useCallback((filename: string) => {
    fetch('/api/documents/duplicate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) }).catch(() => {});
  }, []);

  const handlePluginAction = useCallback((action: string, item: SidebarMenuItem, filename: string, title: string, instructions?: string) => {
    // Block oversized docs before any model/publish call (mirrors the AV guard).
    if (transformExceedsSizeCap(item, docs.find((d) => d.filename === filename))) return;
    if (item.promptForFocus && instructions === undefined) {
      setFocusModal({ action, label: item.label, filename, title });
      return;
    }
    fetch('/api/plugins/sidebar-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, filename, title, instructions: instructions || '', label: item.label }) }).catch(() => {});
  }, [docs]);

  // Folder-capable plugin action (e.g. "Add to Author's Voice" on a workspace/container):
  // apply the same per-doc dispatch to every doc in the folder. Each call is independent and
  // idempotent on the plugin side, so a partial failure just drops that doc.
  const handleFolderPluginAction = useCallback((action: string, item: SidebarMenuItem, nodes: WorkspaceNode[]) => {
    for (const filename of getFilenamesInNodes(nodes)) {
      const doc = docs.find(d => d.filename === filename);
      fetch('/api/plugins/sidebar-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, filename, title: doc?.title || filename, instructions: '', label: item.label }) }).catch(() => {});
    }
  }, [docs]);

  const handleBatchResolve = useCallback((filenames: string[], action: 'accept' | 'reject') => {
    // Optimistically clear pending dots immediately
    setClearedPending(prev => { const next = new Set(prev); for (const f of filenames) next.add(f); return next; });
    fetch('/api/documents/batch-resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames, action }),
    }).catch(() => {});
  }, []);

  const toggle = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem('ow-files-collapsed', JSON.stringify([...next]));
      return next;
    });
  };

  const startRename = (type: 'doc' | 'workspace' | 'container', key: string, value: string, wsFilename?: string) => {
    setRenaming({ type, key, value, wsFilename });
  };

  const commitRename = () => {
    if (!renaming) return;
    const { type, key, value, wsFilename } = renaming;
    if (type === 'doc') actions.handleRename(key, '', value);
    else if (type === 'workspace') actions.handleRenameWorkspace(key, value);
    else if (type === 'container' && wsFilename) actions.handleRenameContainer(wsFilename, key, value);
    setRenaming(null);
  };

  const activeDoc = docs.find(d => d.isActive);
  // Collapsed-ancestor trail for the active doc: which workspace, containers,
  // and variant master hide it when collapsed. Drives the `.active-within`
  // tint so the open doc's chain stays visible with the tree folded up.
  const activeTrail = useMemo(() => {
    const active = docs.find(d => d.isActive);
    if (!active) return null;
    // A variant renders under its master — the master's row is its tree position
    const master = active.masterDocId ? docs.find(d => d.docId === active.masterDocId) : undefined;
    const treeFile = master?.filename ?? active.filename;
    for (const ws of workspaces) {
      const path = findDocPath(ws.workspace?.root || [], treeFile);
      if (path) return { wsFilename: ws.filename as string | null, containerKeys: new Set(path.map(id => `container-${id}`)), masterDocId: master?.docId ?? null };
    }
    return { wsFilename: null as string | null, containerKeys: new Set<string>(), masterDocId: master?.docId ?? null };
  }, [docs, workspaces]);
  // Reveal-in-tree: expand the active doc's ancestors and center/pulse on a
  // directed open. Shared hook owns scroll/pulse; this supplies the expand for
  // files mode's own collapse store (`ow-files-collapsed`).
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const expandAncestors = useCallback((filename: string) => {
    for (const ws of workspacesRef.current) {
      const path = findDocPath(ws.workspace?.root || [], filename);
      if (path) {
        setCollapsed(prev => {
          const keysToExpand = [ws.filename, ...path.map(id => `container-${id}`)];
          if (keysToExpand.every(k => !prev.has(k))) return prev;
          const next = new Set(prev);
          for (const k of keysToExpand) next.delete(k);
          localStorage.setItem('ow-files-collapsed', JSON.stringify([...next]));
          return next;
        });
        break;
      }
    }
  }, []);
  useRevealActiveDoc(scrollRef, docs, workspaces.length, expandAncestors);

  const unassignedDocs = useMemo(
    () => docs.filter(d => !assignedFiles.has(d.filename) && !variantFilenames.has(d.filename) && !isPending(d.filename)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs, assignedFiles, variantFilenames, pendingWriteFilenames],
  );

  // Flat, ordered list of visible doc filenames — used for shift-click range selection.
  // Mirrors the render tree: walks only expanded sections/containers.
  const orderedFilenames = useMemo(() => {
    const result: string[] = [];
    const addDocWithVariants = (doc: DocumentInfo) => {
      result.push(doc.filename);
      const variants = doc.docId ? variantsByMaster.get(doc.docId) : undefined;
      const variantsExpanded = doc.docId && !collapsed.has(`variants-${doc.docId}`);
      if (variants && variantsExpanded) {
        for (const v of variants) result.push(v.filename);
      }
    };
    const walk = (nodes: WorkspaceNode[]) => {
      for (const n of nodes) {
        if (n.type === 'doc') {
          const doc = docs.find(d => d.filename === n.file);
          if (doc && !variantFilenames.has(doc.filename)) addDocWithVariants(doc);
        } else if (!collapsed.has(`container-${n.id}`)) {
          walk(n.items);
        }
      }
    };
    if (!collapsed.has('docs')) unassignedDocs.forEach(addDocWithVariants);
    for (const ws of workspaces) {
      if (!collapsed.has(ws.filename)) walk(ws.workspace?.root || []);
    }
    return result;
  }, [docs, workspaces, unassignedDocs, variantFilenames, variantsByMaster, collapsed]);

  const clearSelection = useCallback(() => {
    setSelection(new Set());
  }, []);

  const handleDocClick = useCallback((e: React.MouseEvent, filename: string) => {
    if (draggedItem) return;
    const isShift = e.shiftKey;
    const isMod = e.ctrlKey || e.metaKey;

    if (isShift) {
      const anchorFile = anchor || activeDoc?.filename || filename;
      const ia = orderedFilenames.indexOf(anchorFile);
      const ib = orderedFilenames.indexOf(filename);
      if (ia < 0 || ib < 0) {
        setSelection(new Set([filename]));
        setAnchor(filename);
        return;
      }
      const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
      setSelection(new Set(orderedFilenames.slice(lo, hi + 1)));
      // anchor unchanged — standard shift-click behavior
      return;
    }

    if (isMod) {
      setSelection(prev => {
        const next = new Set(prev);
        if (next.has(filename)) next.delete(filename); else next.add(filename);
        return next;
      });
      setAnchor(filename);
      return;
    }

    // Unmodified click: clear selection, switch active doc
    setSelection(new Set());
    setAnchor(filename);
    const doc = docs.find(d => d.filename === filename);
    if (doc && !doc.isActive) onSwitchDocument(filename);
  }, [draggedItem, anchor, activeDoc?.filename, orderedFilenames, onSwitchDocument, docs]);

  // Escape clears selection
  useEffect(() => {
    if (selection.size === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selection.size, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    for (const fn of selection) actions.handleDelete(fn);
    setSelection(new Set());
    setAnchor(null);
  }, [selection, actions]);

  const requestSortFor = useCallback((filenames: string[]) => {
    if (filenames.length === 0) return;
    fetch('/api/documents/sort-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames }),
    }).then(() => actions.fetchDocs()).catch(() => {});
  }, [actions]);

  const cancelSortFor = useCallback((filename: string) => {
    fetch('/api/documents/sort-reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    }).then(() => actions.fetchDocs()).catch(() => {});
  }, [actions]);

  const acceptSortProposalFor = useCallback((filename: string) => {
    fetch('/api/documents/sort-accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    }).then(() => actions.fetchDocs()).catch(() => {});
  }, [actions]);

  if (searchResults !== null) {
    return <SearchResults results={searchResults} query={searchQuery} onSwitchDocument={onSwitchDocument} actions={actions} loading={searchLoading} error={searchError} />;
  }

  const renderRenameInput = (onCommit: () => void) => (
    <input
      className="sidebar-rename-input"
      value={renaming!.value}
      onChange={e => setRenaming(prev => prev ? { ...prev, value: e.target.value } : null)}
      onBlur={onCommit}
      onKeyDown={e => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') setRenaming(null); }}
      autoFocus
      onClick={e => e.stopPropagation()}
    />
  );

  const renderDoc = (doc: DocumentInfo, indent: number, wsFilename?: string, containerId?: string | null, hasVariants?: boolean, inheritedAutoAccept: boolean = false) => (
    <div
      key={doc.filename}
      {...sidebarRowProps()}
      aria-current={doc.isActive ? 'page' : undefined}
      className={`files-row${doc.isActive ? ' active' : ''}${doc.docId && activeTrail?.masterDocId === doc.docId && collapsed.has(`variants-${doc.docId}`) ? ' active-within' : ''}${selection.has(doc.filename) ? ' selected' : ''} ${isDragging(doc.filename) ? 'dragging' : ''} ${dropClass(doc.filename)}${doc.masterDocId ? ' is-variant' : ''}`}
      style={{ paddingLeft: indent, ...dropIndentStyle(doc.filename) }}
      data-drag-id={doc.filename}
      data-drag-type="doc"
      data-drag-ws={wsFilename || '__docs__'}
      data-drag-container={containerId || ''}
      onPointerDown={e => handlePointerDown(e, { type: 'doc', file: doc.filename, sourceWs: wsFilename || null }, selection.has(doc.filename) && selection.size > 1 ? `${selection.size} docs` : doc.title)}
      onClick={e => handleDocClick(e, doc.filename)}
      onDoubleClick={() => startRename('doc', doc.filename, doc.title)}
      onContextMenu={e => handleDocContextMenu(e, doc)}
    >
      <span className="files-row-icon"><ContentIcon type={doc.contentType} /></span>
      {renaming?.type === 'doc' && renaming.key === doc.filename ? (
        renderRenameInput(commitRename)
      ) : (
        <>
          <span className="files-row-label">{doc.title}</span>
          {doc.variantType && <span className="files-badge-variant">{doc.variantType}</span>}
          {(doc.autoAccept === true || (doc.autoAccept !== false && inheritedAutoAccept)) && <span className="sidebar-auto-accept-dot" title={doc.autoAccept === true ? "Auto-accept on" : "Auto-accept inherited"} />}
          {pendingDocs.filenames.includes(doc.filename) && !clearedPending.has(doc.filename) && <span className="files-badge-pending" />}
          {doc.sortRequest && (
            doc.sortRequest.proposal
              ? <span className="files-badge-sort-proposal" title="Sort proposal ready — right-click to review" />
              : <span className="files-badge-sort-pending" title="Sort requested" />
          )}
          {actions.getDocTags(doc.filename).includes('✓') && <span className="files-badge-approved"><CheckIcon /></span>}
          {doc.lastSent && <span className="files-badge-sent"><CheckIcon /></span>}
          {hasVariants && (
            <span
              className={`files-row-chevron${collapsed.has(`variants-${doc.docId}`) ? ' collapsed' : ''}`}
              onClick={e => { e.stopPropagation(); toggle(`variants-${doc.docId}`); }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </span>
          )}
        </>
      )}
    </div>
  );

  const renderDocWithVariants = (doc: DocumentInfo, indent: number, wsFilename?: string, containerId?: string | null, inheritedAutoAccept: boolean = false) => {
    const variants = doc.docId ? variantsByMaster.get(doc.docId) : undefined;
    const hasVariants = !!(variants && variants.length > 0);
    const isSpinnerTarget = writingTitle && writingTarget?.parentDocId && writingTarget.parentDocId === doc.docId;
    const showGroup = hasVariants || isSpinnerTarget;
    const isExpanded = !collapsed.has(`variants-${doc.docId}`);

    if (!showGroup) return renderDoc(doc, indent, wsFilename, containerId, false, inheritedAutoAccept);

    return (
      <div key={`vg-${doc.filename}`} className="files-variant-group">
        {renderDoc(doc, indent, wsFilename, containerId, hasVariants, inheritedAutoAccept)}
        {isExpanded && variants?.map(v => renderDoc(v, indent + 16, wsFilename, containerId, false, inheritedAutoAccept))}
        {isSpinnerTarget && (
          <div className="sidebar-item sidebar-writing-placeholder" style={{ paddingLeft: indent + 16 }}>
            <div className="sidebar-item-title">
              <span className="sidebar-writing-spinner" />
              <span className="sidebar-item-title-text">{writingTitle}</span>
            </div>
            <div className="sidebar-item-meta">Writing...</div>
          </div>
        )}
      </div>
    );
  };

  const renderNode = (node: WorkspaceNode, depth: number, wsFilename: string, parentContainerId: string | null, inheritedAutoAccept: boolean = false): JSX.Element | null => {
    const indent = 12 + depth * 16;

    if (node.type === 'doc') {
      const doc = docs.find(d => d.filename === node.file);
      if (!doc) return null;
      // Skip variant docs in workspace tree — they appear nested under their master
      if (variantFilenames.has(doc.filename)) return null;
      return renderDocWithVariants(doc, indent, wsFilename, parentContainerId, inheritedAutoAccept);
    }

    const container = node as ContainerItem;
    const key = `container-${container.id}`;
    const isCollapsed = collapsed.has(key);
    const count = countDocs(container.items);
    const ownAutoAccept = (container as any).autoAccept === true;
    const effectiveAutoAccept = ownAutoAccept || inheritedAutoAccept;

    return (
      <div key={container.id} className={`${dropClass(container.id)} ${isContainerDropTarget(container.id) ? 'files-drop-inside' : ''}`}>
        <div
          className={`files-row is-container${isCollapsed && activeTrail?.containerKeys.has(key) ? ' active-within' : ''} ${isDragging(container.id) ? 'dragging' : ''} ${dropClass(container.id)}`}
          style={{ paddingLeft: indent, ...dropIndentStyle(container.id) }}
          {...sidebarRowProps(!isCollapsed)}
          data-drag-id={container.id}
          data-drag-type="container-header"
          data-drag-ws={wsFilename}
          data-drag-parent={parentContainerId || ''}
          data-section-key={key}
          onPointerDown={e => handlePointerDown(e, { type: 'container', id: container.id, sourceWs: wsFilename }, container.name)}
          onClick={() => !draggedItem && toggle(key)}
          onDoubleClick={e => { e.stopPropagation(); startRename('container', container.id, container.name, wsFilename); }}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            setFolderMenu({ x: e.clientX, y: e.clientY, type: 'container', wsFilename, containerId: container.id, title: container.name, nodes: container.items, autoAccept: ownAutoAccept });
          }}
        >
          <span className="files-row-icon"><FolderIcon /></span>
          {renaming?.type === 'container' && renaming.key === container.id ? (
            renderRenameInput(commitRename)
          ) : (
            <>
              <span className="files-row-label">{container.name}</span>
              {effectiveAutoAccept && <span className="sidebar-auto-accept-dot" title={ownAutoAccept ? "Auto-accept on for this container" : "Auto-accept inherited from workspace"} />}
              <span className="files-row-count">{count}</span>
            </>
          )}
        </div>
        <div className={`files-children${isCollapsed ? ' collapsed' : ''}`} data-drop-ws={wsFilename} data-drop-container={container.id}>
          {writingTitle && !writingTarget?.parentDocId && writingTarget?.wsFilename === wsFilename && writingTarget.containerId === container.id && (
            // adr: adr/sidebar-spinner-placement.md — paddingLeft must mirror children indent (renderNode: 12 + depth * 16)
            <div className="sidebar-item sidebar-writing-placeholder" style={{ paddingLeft: 12 + (depth + 1) * 16 }}>
              <div className="sidebar-item-title">
                <span className="sidebar-writing-spinner" />
                <span className="sidebar-item-title-text">{writingTitle}</span>
              </div>
              <div className="sidebar-item-meta">Writing...</div>
            </div>
          )}
          {container.items.filter(child => child.type !== 'doc' || !isPending(child.file)).map(child => renderNode(child, depth + 1, wsFilename, container.id, effectiveAutoAccept))}
        </div>
      </div>
    );
  };

  return (
    <div className="files-scroll" ref={scrollRef}>
      {/* Unassigned documents section */}
      <div className="files-section">
        <div className={`files-row is-section${collapsed.has('docs') && activeTrail !== null && activeTrail.wsFilename === null ? ' active-within' : ''}`} data-section-key="docs" onClick={() => toggle('docs')}>
          <span className={`files-row-chevron leading${collapsed.has('docs') ? ' collapsed' : ''}`}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
          <span {...sidebarRowProps(!collapsed.has('docs'))} className="files-row-label">Documents</span>
          <button className="files-section-btn" onClick={(e) => { e.stopPropagation(); setCreateDropdown({ anchor: (e.target as HTMLElement).getBoundingClientRect() }); }} title="New document">+</button>
        </div>
        <div className={`files-section-list files-children${collapsed.has('docs') ? ' collapsed' : ''}`} data-drop-ws="__docs__">
          {writingTitle && !writingTarget?.parentDocId && (!writingTarget || !workspaces.some(w => w.filename === writingTarget?.wsFilename)) && (
            // adr: adr/sidebar-spinner-placement.md — match unassignedDocs indent (28)
            <div className="sidebar-item sidebar-writing-placeholder" style={{ paddingLeft: 28 }}>
              <div className="sidebar-item-title">
                <span className="sidebar-writing-spinner" />
                <span className="sidebar-item-title-text">{writingTitle}</span>
              </div>
              <div className="sidebar-item-meta">Writing...</div>
            </div>
          )}
          {unassignedDocs.map(doc => renderDocWithVariants(doc, 28))}
        </div>
      </div>

      {/* Workspace sections */}
      {workspaces.map(ws => {
        const wsRoot = ws.workspace?.root || [];
        const isCollapsedWs = collapsed.has(ws.filename);
        const count = countDocs(wsRoot);
        const wsAutoAccept = (ws as any).workspace?.autoAccept === true || (ws as any).autoAccept === true;

        return (
          <div key={ws.filename} className={`files-section ${isDragging(ws.filename) ? 'dragging' : ''} ${dropIndicator?.itemId === ws.filename ? (dropIndicator.position === 'before' ? 'files-ws-drop-before' : 'files-ws-drop-after') : ''}`}>
            <div
              className={`files-row is-section${isCollapsedWs && activeTrail?.wsFilename === ws.filename ? ' active-within' : ''}${dropIndicator?.itemId === '__section__' && dropIndicator.wsFilename === ws.filename && dropIndicator.position === 'inside' ? ' files-ws-drop-target' : ''}`}
              data-section-key={ws.filename}
              data-ws-drag={ws.filename}
              onPointerDown={e => handlePointerDown(e, { type: 'workspace', filename: ws.filename }, ws.title)}
              onClick={() => !draggedItem && toggle(ws.filename)}
              onDoubleClick={e => { e.stopPropagation(); startRename('workspace', ws.filename, ws.title); }}
              onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                setFolderMenu({ x: e.clientX, y: e.clientY, type: 'workspace', wsFilename: ws.filename, title: ws.title, nodes: wsRoot, autoAccept: (ws as any).workspace?.autoAccept === true || (ws as any).autoAccept === true });
              }}
            >
              {renaming?.type === 'workspace' && renaming.key === ws.filename ? (
                <>
                  <span className={`files-row-chevron leading${isCollapsedWs ? ' collapsed' : ''}`}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
                  {renderRenameInput(commitRename)}
                </>
              ) : (
                <>
                  <span className={`files-row-chevron leading${isCollapsedWs ? ' collapsed' : ''}`}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
                  <span {...sidebarRowProps(!isCollapsedWs)} className="files-row-label">{ws.title}</span>
                  {((ws as any).workspace?.autoAccept === true || (ws as any).autoAccept === true) && <span className="sidebar-auto-accept-dot" title="Auto-accept on for this workspace" />}
                  <span className="files-row-count">{count}</span>
                  <div className="files-section-actions">
                    <button className="files-section-btn" onClick={(e) => { e.stopPropagation(); setCreateDropdown({ anchor: (e.target as HTMLElement).getBoundingClientRect(), wsFilename: ws.filename, containerId: null }); }} title="New document">+</button>
                    <button className="files-section-btn" onClick={(e) => { e.stopPropagation(); actions.handleCreateContainer(ws.filename, null); }} title="New container">&#9744;</button>
                  </div>
                </>
              )}
            </div>
            <div className={`files-section-list files-children${isCollapsedWs ? ' collapsed' : ''}`} data-drop-ws={ws.filename}>
              {/* adr: adr/sidebar-spinner-placement.md — match workspace-root child indent (renderNode depth=1 → 28) */}
              {writingTitle && !writingTarget?.parentDocId && writingTarget?.wsFilename === ws.filename && writingTarget.containerId === null && (
                <div className="sidebar-item sidebar-writing-placeholder" style={{ paddingLeft: 28 }}>
                  <div className="sidebar-item-title">
                    <span className="sidebar-writing-spinner" />
                    <span className="sidebar-item-title-text">{writingTitle}</span>
                  </div>
                  <div className="sidebar-item-meta">Writing...</div>
                </div>
              )}
              {wsRoot.filter(n => n.type !== 'doc' || !isPending(n.file)).map(node => renderNode(node, 1, ws.filename, null, wsAutoAccept))}
            </div>
          </div>
        );
      })}

      <div className="files-new-ws">
        <button onClick={actions.handleCreateWorkspace}>+ New Workspace</button>
      </div>

      {/* Folder context menu (workspace/container) — reuses SidebarContextMenu in folderMode */}
      {folderMenu && (
        <SidebarContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          filename={folderMenu.wsFilename}
          title={folderMenu.title}
          onClose={() => setFolderMenu(null)}
          onDuplicate={() => {}}
          onRename={() => {
            if (folderMenu.type === 'workspace') startRename('workspace', folderMenu.wsFilename, folderMenu.title);
            else if (folderMenu.containerId) startRename('container', folderMenu.containerId, folderMenu.title, folderMenu.wsFilename);
            setFolderMenu(null);
          }}
          onArchive={() => {}}
          onDelete={() => {
            if (folderMenu.type === 'workspace') actions.handleDeleteWorkspace(folderMenu.wsFilename);
            else if (folderMenu.containerId) actions.handleDeleteContainer(folderMenu.wsFilename, folderMenu.containerId, false);
          }}
          folderDocCount={folderMenu.type === 'container' ? countDocs(folderMenu.nodes) : 0}
          onDeleteWithDocs={folderMenu.type === 'container' && folderMenu.containerId ? () => {
            actions.handleDeleteContainer(folderMenu.wsFilename, folderMenu.containerId!, true);
          } : undefined}
          onPluginAction={(action, item) => handleFolderPluginAction(action, item, folderMenu.nodes)}
          pluginItems={sidebarPluginItems.filter(i => i.folderCapable)}
          folderMode
          onNewDoc={(e) => {
            setCreateDropdown({
              anchor: (e.target as HTMLElement).getBoundingClientRect(),
              wsFilename: folderMenu.wsFilename,
              containerId: folderMenu.type === 'container' ? folderMenu.containerId : null,
            });
            setFolderMenu(null);
          }}
          onNewContainer={() => {
            actions.handleCreateContainer(folderMenu.wsFilename, folderMenu.type === 'container' ? folderMenu.containerId! : null);
            setFolderMenu(null);
          }}
          onAcceptAll={() => {
            const filenames = getFilenamesInNodes(folderMenu.nodes);
            if (filenames.length) handleBatchResolve(filenames, 'accept');
            setFolderMenu(null);
          }}
          onRejectAll={() => {
            const filenames = getFilenamesInNodes(folderMenu.nodes);
            if (filenames.length) handleBatchResolve(filenames, 'reject');
            setFolderMenu(null);
          }}
          folderAutoAccept={folderMenu.autoAccept}
          folderAutoAcceptLabel={folderMenu.type === 'workspace' ? 'for workspace' : 'for container'}
          onToggleFolderAutoAccept={() => {
            fetch('/api/auto-accept/inherit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                wsFile: folderMenu.wsFilename,
                ...(folderMenu.type === 'container' ? { containerId: folderMenu.containerId } : {}),
                enabled: !folderMenu.autoAccept,
              }),
            }).catch(() => {});
          }}
          onRequestSortAll={() => {
            const filenames = getFilenamesInNodes(folderMenu.nodes);
            if (filenames.length) requestSortFor(filenames);
          }}
        />
      )}

      {/* Doc context menu */}
      {ctxMenu && (
        <SidebarContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          filename={ctxMenu.filename}
          title={ctxMenu.title}
          bulkCount={ctxMenu.bulkCount}
          onBulkDelete={handleBulkDelete}
          onBulkRequestSort={ctxMenu.bulkCount ? () => requestSortFor([...selection]) : undefined}
          onClose={() => setCtxMenu(null)}
          onDuplicate={() => handleDuplicate(ctxMenu.filename)}
          onCreateVariant={ctxMenu.docId ? (vt) => {
            // Retyped derivative nested under the master. Server field-projects
            // the master onto the target type — NOT a content clone. adr: docs/variants.md
            fetch('/api/documents/variant', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: ctxMenu.filename, masterDocId: ctxMenu.docId, variantType: vt }),
            }).catch(() => {});
          } : undefined}
          onRename={() => {
            startRename('doc', ctxMenu.filename, ctxMenu.title);
            setCtxMenu(null);
          }}
          onArchive={() => actions.handleArchive(ctxMenu.filename)}
          onDelete={() => actions.handleDelete(ctxMenu.filename)}
          onPluginAction={(action, item) => handlePluginAction(action, item, ctxMenu.filename, ctxMenu.title)}
          pluginItems={sidebarPluginItems}
          onSchedulePost={hasPublishPlugin ? () => {
            setScheduleModal({ filename: ctxMenu.filename, title: ctxMenu.title });
            setCtxMenu(null);
          } : undefined}
          onPostNow={ctxMenu.contentType === 'blog' ? () => {
            const isActive = activeDoc?.filename === ctxMenu.filename;
            setPostBlogModal({ filename: ctxMenu.filename, title: ctxMenu.title, isActive });
            setCtxMenu(null);
          } : undefined}
          isAlreadyPublished={ctxMenu.contentType === 'blog' && !!ctxMenu.postedUrl}
          onViewAnalytics={ctxMenu.docId && ctxMenu.lastSent && (ctxMenu.postedUrl || ctxMenu.isNewsletter) ? () => {
            if (ctxMenu.isNewsletter) setAnalyticsModal({ docId: ctxMenu.docId!, title: ctxMenu.title });
            else if (ctxMenu.postedUrl) window.open(ctxMenu.postedUrl, '_blank');
            setCtxMenu(null);
          } : undefined}
          viewAnalyticsLabel={ctxMenu.isNewsletter ? 'View Analytics' : ctxMenu.contentType === 'blog' && ctxMenu.postedUrl ? 'View Post' : ctxMenu.postedUrl ? 'View on X' : 'View Analytics'}
          isApproved={actions.getDocTags(ctxMenu.filename).includes('✓')}
          onToggleApprove={() => {
            const tags = actions.getDocTags(ctxMenu.filename);
            if (tags.includes('✓')) actions.handleRemoveTag(ctxMenu.filename, '✓');
            else {
              actions.handleAddTag(ctxMenu.filename, '✓');
              setTimeout(() => window.dispatchEvent(new CustomEvent('ow-accept-all')), 50);
            }
          }}
          isAutoAccept={(() => {
            const own = docs.find(d => d.filename === ctxMenu.filename)?.autoAccept;
            if (own === true) return true;
            if (own === false) return false;
            return isAutoAcceptInheritedForDoc(workspaces, ctxMenu.filename);
          })()}
          onToggleAutoAccept={() => {
            const own = docs.find(d => d.filename === ctxMenu.filename)?.autoAccept;
            const effective = own === true
              ? true
              : own === false
                ? false
                : isAutoAcceptInheritedForDoc(workspaces, ctxMenu.filename);
            fetch('/api/auto-accept', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: ctxMenu.filename, enabled: !effective }),
            }).then(() => actions.fetchDocs()).catch(() => {});
          }}
          isAlreadySent={!!ctxMenu.lastSent}
          onMarkSent={() => {
            const fn = ctxMenu.filename;
            if (actions.getDocTags(fn).includes('✓')) actions.handleRemoveTag(fn, '✓');
            onSwitchDocument(fn);
            setTimeout(() => {
              fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manualPost: { postedAt: new Date().toISOString() } }) })
                .then(() => actions.fetchDocs()).catch(() => {});
            }, 100);
            setCtxMenu(null);
          }}
          sortState={
            ctxMenu.bulkCount
              ? undefined
              : ctxMenu.sortRequest?.proposal
                ? 'proposal'
                : ctxMenu.sortRequest
                  ? 'pending'
                  : 'none'
          }
          sortProposalLabel={(() => {
            const p = ctxMenu.sortRequest?.proposal;
            if (!p) return undefined;
            const ws = workspaces.find(w => w.filename === p.wsFilename);
            const wsLabel = ws?.title || p.wsFilename;
            if (!p.containerId) return wsLabel;
            // Walk ws tree for container name. Cheap — sidebar already has tree in hand.
            const findName = (nodes: any[]): string | null => {
              for (const n of nodes) {
                if (n.type === 'container' && n.id === p.containerId) return n.name;
                if (n.type === 'container') { const sub = findName(n.items); if (sub) return sub; }
              }
              return null;
            };
            const cName = ws?.workspace ? findName(ws.workspace.root) : null;
            return cName ? `${wsLabel} / ${cName}` : wsLabel;
          })()}
          sortProposalReasoning={ctxMenu.sortRequest?.proposal?.reasoning}
          onRequestSort={ctxMenu.bulkCount ? undefined : () => requestSortFor([ctxMenu.filename])}
          onCancelSort={() => cancelSortFor(ctxMenu.filename)}
          onAcceptSortProposal={() => acceptSortProposalFor(ctxMenu.filename)}
          onRejectSortProposal={() => cancelSortFor(ctxMenu.filename)}
        />
      )}
      {focusModal && (
        <FocusInstructionsModal
          actionLabel={focusModal.label}
          docTitle={focusModal.title}
          onClose={() => setFocusModal(null)}
          onConfirm={instructions => {
            const item = sidebarPluginItems.find(i => i.action === focusModal.action);
            if (item) handlePluginAction(focusModal.action, item, focusModal.filename, focusModal.title, instructions);
            setFocusModal(null);
          }}
        />
      )}
      {analyticsModal && (
        <NewsletterAnalyticsModal docId={analyticsModal.docId} title={analyticsModal.title} onClose={() => setAnalyticsModal(null)} />
      )}
      {scheduleModal && (
        <SchedulePostModal filename={scheduleModal.filename} title={scheduleModal.title} onClose={() => setScheduleModal(null)} />
      )}
      {postBlogModal && (
        <PostToBlogModal
          filename={postBlogModal.filename}
          title={postBlogModal.title}
          isActive={postBlogModal.isActive}
          onSwitchDocument={onSwitchDocument}
          onClose={() => setPostBlogModal(null)}
        />
      )}
      {createDropdown && (
        <CreateDocDropdown
          anchorRect={createDropdown.anchor}
          onClose={() => setCreateDropdown(null)}
          onSelect={metadata => {
            setCreateDropdown(null);
            if (createDropdown.wsFilename) {
              actions.handleCreateInWorkspace(createDropdown.wsFilename, createDropdown.containerId ?? null, metadata);
            } else if (metadata) {
              fetch('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata }) }).catch(() => {});
            } else {
              onCreateDocument();
            }
          }}
        />
      )}
    </div>
  );
}
