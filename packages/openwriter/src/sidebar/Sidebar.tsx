import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import type { PendingDocsPayload } from '../ws/client';
import { useSidebarData } from './sidebar-data';
import { useSidebarActions } from './sidebar-actions';
import { getSidebarMode } from '../themes/appearance-store';
import type { SearchResult, DocumentInfo } from './sidebar-types';
import SidebarDefault from './SidebarDefault';
import SidebarTimeline from './SidebarTimeline';
import SidebarBoard from './SidebarBoard';
import SidebarShelf from './SidebarShelf';
import SidebarFiles from './SidebarFiles';
import SidebarSchedule from './SidebarSchedule';
import SidebarTasks from './SidebarTasks';
import ProfileSwitcher from './ProfileSwitcher';
import './Sidebar.css';
import './sidebar-keyboard.css';
import { useDocumentSearch } from './use-document-search';
import { moveSidebarFocus, searchInputKeyDown } from './sidebar-keyboard';
import { usePanelVisibility } from '../hooks/usePanelVisibility';

interface SidebarProps {
  documentNavigation?: ReactNode;
  open: boolean;
  onSwitchDocument: (filename: string) => void;
  onCreateDocument: () => void;
  /** Bumped only when the doc set actually changes (create/delete/rename,
   *  auto-title applied, etc.) via documents-changed broadcast. NOT bumped
   *  on doc switch — active-doc highlight is handled by optimisticSwitchDocument
   *  below, and a refetch here costs ~400ms (gray-matter parse of every doc
   *  for the tags field that rides on /api/documents). */
  refreshKey: number;
  /** Separate cadence from refreshKey: kept around for finer-grained tag
   *  invalidation if/when tag mutations stop riding on documents-changed. */
  docTagsRefreshKey: number;
  workspacesRefreshKey: number;
  pendingDocs: PendingDocsPayload;
  writingTitle?: string | null;
  writingTarget?: { wsFilename: string; containerId: string | null } | null;
  pendingWriteFilenames?: Set<string>;
  /** The current active doc per App's authoritative state. Drives the sidebar's
   *  isActive highlight for ALL switches — including agent (switch_document)
   *  ones, which (unlike user clicks) don't go through optimisticSwitchDocument. */
  activeFilename?: string;
  onClose?: () => void;
  /** Width (px) — owned by App so the responsive-overlay formula can read it
   *  live. Sidebar reports drags back via onWidthChange. */
  width: number;
  onWidthChange: (w: number) => void;
  /** Overlay mode: the sidebar floats over the doc (positioned by CSS) instead
   *  of pushing it. Drag-to-resize is suppressed while floating. */
  floating?: boolean;
}

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 260;

export default function Sidebar({ open, onSwitchDocument, onCreateDocument, refreshKey, docTagsRefreshKey, workspacesRefreshKey, pendingDocs, writingTitle, writingTarget, pendingWriteFilenames, activeFilename, onClose, width, onWidthChange, floating, documentNavigation }: SidebarProps) {
  const [showFiles, setShowFiles] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  usePanelVisibility(panelRef, open, '[title="Open sidebar"]');
  useEffect(() => { setShowFiles(false); }, [activeFilename]);
  const { docs, setDocs, workspaces, assignedFiles, fetchDocs, fetchWorkspaces, scrollRef } = useSidebarData(refreshKey, workspacesRefreshKey);
  const actions = useSidebarActions(fetchDocs, fetchWorkspaces, docs);
  const mode = getSidebarMode();

  // Sidebar width is owned by App (controlled via `width`/`onWidthChange`) so
  // the responsive-overlay formula can react to drags live. Persistence to
  // localStorage happens here on drag-end; App reads it back on next load.
  const resizingRef = useRef(false);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let latest = width;
    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      latest = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, ev.clientX));
      onWidthChange(latest);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { localStorage.setItem('ow-sidebar-width', String(latest)); } catch {}
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [width, onWidthChange]);

  // Optimistic active-doc highlight: update isActive locally before the server round-trip
  const optimisticSwitchDocument = useCallback((filename: string) => {
    setDocs(prev => prev.map(d => ({ ...d, isActive: d.filename === filename })));
    onSwitchDocument(filename);
  }, [setDocs, onSwitchDocument]);

  // Reconcile isActive with App's authoritative activeFilename. Covers agent
  // (switch_document) switches and back/forward nav, which don't run the
  // optimistic click path above. No-ops (returns prev) when already correct,
  // so it won't churn after a click already set the flag.
  useEffect(() => {
    if (!activeFilename) return;
    setDocs(prev => {
      if (prev.some(d => d.filename === activeFilename ? !d.isActive : d.isActive)) {
        return prev.map(d => ({ ...d, isActive: d.filename === activeFilename }));
      }
      return prev;
    });
  }, [activeFilename, setDocs, refreshKey]);
  const [scheduleView, setScheduleView] = useState(false);
  const [tasksView, setTasksView] = useState(false);

  // Profile state
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState('Default');

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles);
        setActiveProfile(data.active);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  const handleSwitchProfile = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/profiles/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setActiveProfile(name);
        fetchProfiles();
      }
    } catch { /* ignore */ }
  }, [fetchProfiles]);

  const handleCreateProfile = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) fetchProfiles();
    } catch { /* ignore */ }
  }, [fetchProfiles]);

  // Trashed profiles
  const [trashedProfiles, setTrashedProfiles] = useState<string[]>([]);

  const fetchTrashedProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles/trash');
      if (res.ok) {
        const data = await res.json();
        setTrashedProfiles(data.profiles);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchTrashedProfiles(); }, [fetchTrashedProfiles]);

  const handleDeleteProfile = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (res.ok) {
        fetchProfiles();
        fetchTrashedProfiles();
      }
    } catch { /* ignore */ }
  }, [fetchProfiles, fetchTrashedProfiles]);

  const handleRestoreProfile = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/profiles/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        fetchProfiles();
        fetchTrashedProfiles();
      }
    } catch { /* ignore */ }
  }, [fetchProfiles, fetchTrashedProfiles]);

  const { query: searchQuery, results: searchResults, loading: searchLoading, error: searchError, search: onSearchChange } = useDocumentSearch(refreshKey);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const modeProps = {
    docs, archivedDocs: [] as DocumentInfo[], workspaces, assignedFiles, pendingDocs, writingTitle, writingTarget,
    pendingWriteFilenames,
    onSwitchDocument: optimisticSwitchDocument, onCreateDocument, actions, scrollRef,
    searchQuery, searchResults, searchLoading, searchError, onSearchChange,
  };

  const renderMode = () => {
    switch (mode) {
      case 'files': return <SidebarFiles {...modeProps} />;
      case 'timeline': return <SidebarTimeline {...modeProps} />;
      case 'board': return <SidebarBoard {...modeProps} />;
      case 'shelf': return <SidebarShelf {...modeProps} />;
      default: return <SidebarDefault {...modeProps} />;
    }
  };

  const searchBar = (
    <div className="sidebar-search">
      <svg className="sidebar-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10.5" cy="10.5" r="7" />
        <path d="m20 20-4.5-4.5" />
      </svg>
      <input
        ref={searchInputRef}
        className="sidebar-search-input"
        type="text"
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={e => searchInputKeyDown(e, () => onSearchChange(''))}
        aria-label="Search documents"
      />
      {searchQuery && (
        <button className="sidebar-search-clear" onClick={() => onSearchChange('')} title="Clear search">
          &times;
        </button>
      )}
    </div>
  );

  const sidebarStyle = open ? { width: `${width}px`, minWidth: `${width}px` } : undefined;
  // Drag-to-resize is docked-only; in overlay the floating drawer uses its saved width.
  const resizeHandle = open && !floating ? (
    <div
      className="sidebar-resize-handle"
      onPointerDown={startResize}
      onDoubleClick={() => { onWidthChange(SIDEBAR_DEFAULT_WIDTH); try { localStorage.setItem('ow-sidebar-width', String(SIDEBAR_DEFAULT_WIDTH)); } catch {} }}
      title="Drag to resize · double-click to reset"
    />
  ) : null;

  // Board mode uses horizontal layout — rendered differently in App
  if (mode === 'board' && !documentNavigation) {
    return (
      <div ref={panelRef} aria-hidden={!open} onKeyDown={moveSidebarFocus} className={`sidebar sidebar-board-mode ${open ? 'open' : ''}`} style={sidebarStyle}>
        {renderMode()}
        {resizeHandle}
      </div>
    );
  }

  return (
    <div ref={panelRef} aria-hidden={!open} onKeyDown={e => {
      if (!e.defaultPrevented && e.key === 'Escape' && searchQuery) {
        e.preventDefault(); onSearchChange(''); searchInputRef.current?.focus();
      } else moveSidebarFocus(e);
    }} className={`sidebar ${open ? 'open' : ''}`} style={sidebarStyle}>
      <div className="sidebar-topbar">
        <div className="sidebar-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M15 5l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="sidebar-logo-text">OpenWriter</span>
        </div>
        <div className="sidebar-topbar-actions">
          <ProfileSwitcher profiles={profiles} activeProfile={activeProfile} trashedProfiles={trashedProfiles} onSwitch={handleSwitchProfile} onCreate={handleCreateProfile} onDelete={handleDeleteProfile} onRestore={handleRestoreProfile} />
          <button
            className={`sidebar-collapse-btn${scheduleView ? ' sidebar-collapse-btn--active' : ''}`}
            onClick={() => { setScheduleView(!scheduleView); setTasksView(false); }}
            title="Schedule"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <line x1="16" x2="16" y1="1" y2="5" />
              <line x1="8" x2="8" y1="1" y2="5" />
              <line x1="3" x2="21" y1="9" y2="9" />
            </svg>
          </button>
          <button
            className={`sidebar-collapse-btn${tasksView ? ' sidebar-collapse-btn--active' : ''}`}
            onClick={() => { setTasksView(!tasksView); setScheduleView(false); }}
            title="Tasks"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </button>
          {onClose && (
            <button className="sidebar-collapse-btn" onClick={onClose} title="Close sidebar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M9 3v18" stroke="currentColor" strokeWidth="2" />
                <path d="M15 10l-2 2 2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {documentNavigation && (
        <div className="sidebar-document-tabs" aria-label="Sidebar navigation">
          <button type="button" aria-pressed={!showFiles && !tasksView && !scheduleView} onClick={() => { setShowFiles(false); setTasksView(false); setScheduleView(false); }}>Chapters</button>
          <button type="button" aria-pressed={showFiles && !tasksView && !scheduleView} onClick={() => { setShowFiles(true); setTasksView(false); setScheduleView(false); }}>Files</button>
        </div>
      )}
      {tasksView ? (
        <SidebarTasks onBack={() => setTasksView(false)} />
      ) : scheduleView ? (
        <SidebarSchedule onBack={() => setScheduleView(false)} />
      ) : documentNavigation && !showFiles ? documentNavigation : (
        <>
          {searchBar}
          {renderMode()}
        </>
      )}
      {resizeHandle}
    </div>
  );
}
