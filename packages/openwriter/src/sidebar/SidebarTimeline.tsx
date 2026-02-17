import { useState } from 'react';
import type { SidebarModeProps, DocumentInfo } from './sidebar-types';
import { formatDate, dateGroup, isExternal, parentDir } from './sidebar-utils';
import './SidebarTimeline.css';

export default function SidebarTimeline({ docs, workspaces, assignedFiles, pendingDocs, onSwitchDocument, onCreateDocument, actions, scrollRef }: SidebarModeProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Sort all docs by lastModified, most recent first
  const sorted = [...docs].sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // Group by date
  const groups: { label: string; docs: DocumentInfo[] }[] = [];
  let currentGroup = '';
  for (const doc of sorted) {
    const group = dateGroup(doc.lastModified);
    if (group !== currentGroup) {
      groups.push({ label: group, docs: [] });
      currentGroup = group;
    }
    groups[groups.length - 1].docs.push(doc);
  }

  // Find which workspace a doc belongs to
  const getWorkspaceLabel = (filename: string): string | null => {
    for (const ws of workspaces) {
      if (!ws.workspace) continue;
      const check = (nodes: any[]): boolean => {
        for (const n of nodes) {
          if (n.type === 'doc' && n.file === filename) return true;
          if (n.type === 'container' && check(n.items)) return true;
        }
        return false;
      };
      if (check(ws.workspace.root)) return ws.title;
    }
    return null;
  };

  return (
    <div className="sidebar-scroll tl-scroll" ref={scrollRef}>
      <div className="tl-header">
        <span className="tl-title">Timeline</span>
        <button className="sidebar-new-btn" onClick={onCreateDocument} title="New document">+</button>
      </div>

      {groups.map((group) => (
        <div key={group.label} className="tl-group">
          <div className="tl-date">{group.label}</div>
          {group.docs.map((doc) => {
            const wsLabel = getWorkspaceLabel(doc.filename);
            return (
              <div
                key={doc.filename}
                className={`tl-item ${doc.isActive ? 'active' : ''}`}
                onClick={() => !doc.isActive && onSwitchDocument(doc.filename)}
              >
                <div className="tl-dot" />
                <div className="tl-content">
                  <div className="tl-item-title">
                    <span>{doc.title}</span>
                    {pendingDocs.filenames.includes(doc.filename) && <span className="sidebar-pending-dot" />}
                  </div>
                  {isExternal(doc.filename) && <div className="tl-item-context">{parentDir(doc.filename)}</div>}
                  <div className="tl-item-meta">
                    {doc.wordCount.toLocaleString()} words &middot; {formatDate(doc.lastModified)}
                  </div>
                  {wsLabel && <div className="tl-badge">{wsLabel}</div>}
                </div>
                {confirmDelete === doc.filename ? (
                  <div className="sidebar-confirm-delete" onClick={(e) => e.stopPropagation()}>
                    <span>Delete?</span>
                    <button onClick={() => { actions.handleDelete(doc.filename); setConfirmDelete(null); }}>Yes</button>
                    <button onClick={() => setConfirmDelete(null)}>No</button>
                  </div>
                ) : (
                  <button className="sidebar-delete-btn" onClick={(e) => { e.stopPropagation(); setConfirmDelete(doc.filename); }} title="Delete">&times;</button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {docs.length === 0 && <div className="sidebar-empty">No documents yet</div>}
    </div>
  );
}
