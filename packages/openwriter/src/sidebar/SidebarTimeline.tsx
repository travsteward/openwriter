import { useState } from 'react';
import type { SidebarModeProps, DocumentInfo } from './sidebar-types';
import { formatDate, dateGroup, isExternal } from './sidebar-utils';
import { useRevealActiveDoc } from './use-reveal-active-doc';
import SearchResults from './SearchResults';
import DocContextMenu, { docMenuTarget, useSidebarPlugins, type DocMenuTarget } from './DocContextMenu';
import './SidebarTimeline.css';
import { sidebarRowProps } from './sidebar-keyboard';

export default function SidebarTimeline({ docs, docsLoaded, workspaces, assignedFiles, pendingDocs, onSwitchDocument, onCreateDocument, actions, scrollRef, searchQuery, searchResults, searchLoading, searchError }: SidebarModeProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Right-click offers the same doc menu as the file tree.
  const [menu, setMenu] = useState<DocMenuTarget | null>(null);
  const [renaming, setRenaming] = useState<{ filename: string; value: string } | null>(null);
  const { pluginItems, hasPublishPlugin } = useSidebarPlugins();
  const commitRename = () => {
    if (renaming) actions.handleRename(renaming.filename, '', renaming.value);
    setRenaming(null);
  };
  // Flat mode — no folders to expand; just center + pulse the active row.
  useRevealActiveDoc(scrollRef, docs, workspaces.length);

  // Search mode
  if (searchResults !== null) {
    return <SearchResults results={searchResults} query={searchQuery} onSwitchDocument={onSwitchDocument} actions={actions} loading={searchLoading} error={searchError} />;
  }

  // Sort by latest activity (saves or pending agent changes), most recent first
  const activity = (d: DocumentInfo) => d.lastActivity ?? d.lastModified;
  const sorted = [...docs].sort((a, b) => new Date(activity(b)).getTime() - new Date(activity(a)).getTime());

  // Group by date
  const groups: { label: string; docs: DocumentInfo[] }[] = [];
  let currentGroup = '';
  for (const doc of sorted) {
    const group = dateGroup(activity(doc));
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
                {...sidebarRowProps()}
                aria-current={doc.isActive ? 'page' : undefined}
                className={`tl-item ${doc.isActive ? 'active' : ''}`}
                onClick={() => !doc.isActive && onSwitchDocument(doc.filename)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu(docMenuTarget(e, doc)); }}
              >
                <div className="tl-dot" />
                <div className="tl-content" title={wsLabel || undefined}>
                  <div className="tl-item-title">
                    {renaming?.filename === doc.filename ? (
                      <input
                        className="sidebar-rename-input"
                        value={renaming.value}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenaming({ filename: doc.filename, value: e.target.value })}
                        onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                      />
                    ) : <span>{doc.title}</span>}
                    {pendingDocs.filenames.includes(doc.filename) && <span className="sidebar-pending-dot" />}
                  </div>
                  <div className="tl-item-meta">{formatDate(activity(doc))}</div>
                </div>
                {confirmDelete === doc.filename ? (
                  <div className="sidebar-confirm-delete" onClick={(e) => e.stopPropagation()}>
                    <span>{isExternal(doc.filename) ? 'Remove?' : 'Delete?'}</span>
                    <button onClick={() => { actions.handleDelete(doc.filename); setConfirmDelete(null); }}>Yes</button>
                    <button onClick={() => setConfirmDelete(null)}>No</button>
                  </div>
                ) : (
                  <button className="sidebar-delete-btn" onClick={(e) => { e.stopPropagation(); setConfirmDelete(doc.filename); }} title={isExternal(doc.filename) ? 'Remove' : 'Delete'}>&times;</button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {docs.length === 0 && <div className="sidebar-empty">{docsLoaded ? 'No documents yet' : 'Loading…'}</div>}

      <DocContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        docs={docs}
        workspaces={workspaces}
        actions={actions}
        onSwitchDocument={onSwitchDocument}
        pluginItems={pluginItems}
        hasPublishPlugin={hasPublishPlugin}
        onRename={(filename, title) => setRenaming({ filename, value: title })}
      />
    </div>
  );
}
