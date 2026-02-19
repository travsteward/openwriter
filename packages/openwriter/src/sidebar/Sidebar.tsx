import type { PendingDocsPayload } from '../ws/client';
import { useSidebarData } from './sidebar-data';
import { useSidebarActions } from './sidebar-actions';
import { getSidebarMode } from '../themes/appearance-store';
import SidebarDefault from './SidebarDefault';
import SidebarTimeline from './SidebarTimeline';
import SidebarBoard from './SidebarBoard';
import SidebarShelf from './SidebarShelf';
import './Sidebar.css';

interface SidebarProps {
  open: boolean;
  onSwitchDocument: (filename: string) => void;
  onCreateDocument: () => void;
  refreshKey: number;
  workspacesRefreshKey: number;
  pendingDocs: PendingDocsPayload;
  writingTitle?: string | null;
  writingTarget?: { wsFilename: string; containerId: string | null } | null;
  onClose?: () => void;
}

export default function Sidebar({ open, onSwitchDocument, onCreateDocument, refreshKey, workspacesRefreshKey, pendingDocs, writingTitle, writingTarget, onClose }: SidebarProps) {
  const { docs, workspaces, assignedFiles, fetchDocs, scrollRef } = useSidebarData(refreshKey, workspacesRefreshKey);
  const actions = useSidebarActions(workspaces, fetchDocs, refreshKey);
  const mode = getSidebarMode();

  const modeProps = {
    docs, workspaces, assignedFiles, pendingDocs, writingTitle, writingTarget,
    onSwitchDocument, onCreateDocument, actions, scrollRef,
  };

  const renderMode = () => {
    switch (mode) {
      case 'timeline': return <SidebarTimeline {...modeProps} />;
      case 'board': return <SidebarBoard {...modeProps} />;
      case 'shelf': return <SidebarShelf {...modeProps} />;
      default: return <SidebarDefault {...modeProps} />;
    }
  };

  // Board mode uses horizontal layout — rendered differently in App
  if (mode === 'board') {
    return (
      <div className={`sidebar sidebar-board-mode ${open ? 'open' : ''}`}>
        {renderMode()}
      </div>
    );
  }

  return (
    <div className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-topbar">
        <div className="sidebar-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M15 5l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="sidebar-logo-text">OpenWriter</span>
        </div>
        {onClose && (
          <button className="sidebar-collapse-btn" onClick={onClose} title="Close sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M9 3v18" stroke="currentColor" strokeWidth="1.5" />
              <path d="M15 10l-2 2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {renderMode()}
    </div>
  );
}
