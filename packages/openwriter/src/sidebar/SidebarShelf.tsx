import { useState, useMemo } from 'react';
import type { SidebarModeProps, DocumentInfo, WorkspaceNode, ContainerItem } from './sidebar-types';
import { formatDate } from './sidebar-utils';
import './SidebarShelf.css';

interface PathEntry {
  type: 'workspace' | 'container';
  key: string;
  title: string;
  wsFilename: string;
}

export default function SidebarShelf({ docs, workspaces, assignedFiles, pendingDocs, onSwitchDocument, actions, scrollRef }: SidebarModeProps) {
  const [path, setPath] = useState<PathEntry[]>([]);

  // Find a container in a workspace tree by id
  const findContainer = (nodes: WorkspaceNode[], id: string): ContainerItem | null => {
    for (const n of nodes) {
      if (n.type === 'container') {
        if (n.id === id) return n;
        const found = findContainer(n.items, id);
        if (found) return found;
      }
    }
    return null;
  };

  // Count docs recursively
  const countDocs = (nodes: WorkspaceNode[]): number => {
    let count = 0;
    for (const n of nodes) {
      if (n.type === 'doc') count++;
      else if (n.type === 'container') count += countDocs(n.items);
    }
    return count;
  };

  // Get the nodes at current drill level
  const currentNodes = useMemo((): WorkspaceNode[] => {
    if (path.length === 0) return [];
    const top = path[path.length - 1];
    const ws = workspaces.find(w => w.filename === top.wsFilename);
    if (!ws?.workspace) return [];
    if (top.type === 'workspace') return ws.workspace.root;
    const container = findContainer(ws.workspace.root, top.key);
    return container ? container.items : [];
  }, [path, workspaces]);

  const currentContainers = currentNodes.filter((n): n is ContainerItem => n.type === 'container');

  // Docs at current level (direct children only)
  const currentDocs = useMemo((): DocumentInfo[] => {
    if (path.length === 0) {
      // Top level: show unassigned docs
      return docs.filter(d => !assignedFiles.has(d.filename));
    }
    const docFiles = currentNodes
      .filter((n): n is { type: 'doc'; file: string; title: string } => n.type === 'doc')
      .map(n => n.file);
    return docs.filter(d => docFiles.includes(d.filename));
  }, [path, currentNodes, docs, assignedFiles]);

  const drillIn = (entry: PathEntry) => setPath(prev => [...prev, entry]);
  const goBack = () => setPath(prev => prev.slice(0, -1));

  const parentLabel = path.length > 1 ? path[path.length - 2].title : 'Shelf';
  const currentTitle = path.length > 0 ? path[path.length - 1].title : 'Documents';

  return (
    <div className="shelf-wrapper">
      <div className="shelf-spines" ref={scrollRef}>
        {/* Back button */}
        {path.length > 0 && (
          <button className="shelf-back" onClick={goBack} title={`Back to ${parentLabel}`}>
            <span className="shelf-back-arrow">&larr;</span>
            <span className="shelf-back-label">{parentLabel}</span>
          </button>
        )}

        {/* Top level: workspace headers */}
        {path.length === 0 && (
          <>
            {workspaces.map(ws => (
              <div
                key={ws.filename}
                className="shelf-section-spine"
                onClick={() => drillIn({ type: 'workspace', key: ws.filename, title: ws.title, wsFilename: ws.filename })}
                title={ws.title}
              >
                <span className="shelf-section-title">{ws.title}</span>
                <span className="shelf-section-count">{ws.docCount}</span>
              </div>
            ))}
            <button className="shelf-add" onClick={actions.handleCreateWorkspace} title="New workspace">+</button>
          </>
        )}

        {/* Drilled in: child containers */}
        {path.length > 0 && currentContainers.map(c => (
          <div
            key={c.id}
            className="shelf-section-spine shelf-section-container"
            onClick={() => drillIn({
              type: 'container',
              key: c.id,
              title: c.name,
              wsFilename: path[path.length - 1].wsFilename,
            })}
            title={c.name}
          >
            <span className="shelf-section-title">{c.name}</span>
            <span className="shelf-section-count">{countDocs(c.items)}</span>
          </div>
        ))}
      </div>

      {/* Doc list panel */}
      <div className="shelf-docs">
        <div className="shelf-docs-header">{currentTitle}</div>
        <div className="shelf-docs-list">
          {currentDocs.map(doc => (
            <div
              key={doc.filename}
              className={`shelf-doc-item ${doc.isActive ? 'active' : ''}`}
              onClick={() => onSwitchDocument(doc.filename)}
            >
              <div className="shelf-doc-title">
                <span>{doc.title}</span>
                {pendingDocs.filenames.includes(doc.filename) && <span className="shelf-pending-dot" />}
              </div>
              <div className="shelf-doc-meta">
                {doc.wordCount.toLocaleString()} words &middot; {formatDate(doc.lastModified)}
              </div>
            </div>
          ))}
          {currentDocs.length === 0 && (
            <div className="shelf-docs-empty">No documents</div>
          )}
        </div>
      </div>
    </div>
  );
}
