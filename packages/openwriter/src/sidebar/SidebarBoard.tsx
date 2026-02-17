import { useState, useMemo, useRef, useEffect } from 'react';
import type { SidebarModeProps, DocumentInfo, WorkspaceNode, ContainerItem } from './sidebar-types';
import { formatDate, collectFiles } from './sidebar-utils';
import './SidebarBoard.css';

interface PathEntry {
  type: 'workspace' | 'container';
  key: string;
  title: string;
  wsFilename: string;
}

export default function SidebarBoard({ docs, workspaces, assignedFiles, pendingDocs, onSwitchDocument, actions, scrollRef }: SidebarModeProps) {
  const [path, setPath] = useState<PathEntry[]>([]);
  const [dropdownKey, setDropdownKey] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownKey) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownKey(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownKey]);

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

  const countDocs = (nodes: WorkspaceNode[]): number => {
    let count = 0;
    for (const n of nodes) {
      if (n.type === 'doc') count++;
      else if (n.type === 'container') count += countDocs(n.items);
    }
    return count;
  };

  // Collect all doc filenames recursively from nodes
  const collectDocFiles = (nodes: WorkspaceNode[]): string[] => {
    const files: string[] = [];
    for (const n of nodes) {
      if (n.type === 'doc') files.push(n.file);
      else if (n.type === 'container') files.push(...collectDocFiles(n.items));
    }
    return files;
  };

  // Get nodes at current drill level
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

  // Direct docs at current level
  const currentDocs = useMemo((): DocumentInfo[] => {
    const docFiles = currentNodes
      .filter(n => n.type === 'doc')
      .map(n => (n as { type: 'doc'; file: string }).file);
    return docs.filter(d => docFiles.includes(d.filename));
  }, [currentNodes, docs]);

  // Get docs for a container (recursive)
  const getContainerDocs = (container: ContainerItem): DocumentInfo[] => {
    const files = collectDocFiles(container.items);
    return docs.filter(d => files.includes(d.filename));
  };

  // Get docs for a workspace (all docs)
  const getWorkspaceDocs = (wsFilename: string): DocumentInfo[] => {
    const ws = workspaces.find(w => w.filename === wsFilename);
    if (!ws?.workspace) return [];
    const files = collectDocFiles(ws.workspace.root);
    return docs.filter(d => files.includes(d.filename));
  };

  const unassignedDocs = useMemo(() =>
    docs.filter(d => !assignedFiles.has(d.filename)),
    [docs, assignedFiles]
  );

  const drillIn = (entry: PathEntry) => {
    setPath(prev => [...prev, entry]);
    setDropdownKey(null);
  };

  const goBack = () => {
    setPath(prev => prev.slice(0, -1));
    setDropdownKey(null);
  };

  const toggleDropdown = (key: string, e: React.MouseEvent) => {
    if (dropdownKey === key) {
      setDropdownKey(null);
      return;
    }
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setDropdownKey(key);
  };

  const handleDocClick = (filename: string) => {
    onSwitchDocument(filename);
    setDropdownKey(null);
  };

  const parentLabel = path.length > 1 ? path[path.length - 2].title : 'All';

  // Resolve doc list for current dropdown
  const getDropdownDocs = (): DocumentInfo[] => {
    if (!dropdownKey) return [];
    if (dropdownKey === '__unassigned__') return unassignedDocs;
    if (dropdownKey === '__level-docs__') return currentDocs;
    // Check if it's a workspace
    const ws = workspaces.find(w => w.filename === dropdownKey);
    if (ws) return getWorkspaceDocs(ws.filename);
    // Must be a container
    for (const w of workspaces) {
      if (!w.workspace) continue;
      const container = findContainer(w.workspace.root, dropdownKey);
      if (container) return getContainerDocs(container);
    }
    return [];
  };

  return (
    <div className="board-scroll" ref={scrollRef}>
      {/* Anchor pill — always present to prevent layout shift */}
      {path.length === 0 ? (
        <button className="board-back board-back--static" tabIndex={-1}>All</button>
      ) : (
        <button className="board-back" onClick={goBack} title={`Back to ${parentLabel}`}>
          &larr; {parentLabel}
        </button>
      )}

      {/* Top level: workspace chips + unassigned */}
      {path.length === 0 && (
        <>
          {unassignedDocs.length > 0 && (
            <button
              className={`board-chip ${dropdownKey === '__unassigned__' ? 'open' : ''}`}
              onClick={(e) => toggleDropdown('__unassigned__', e)}
            >
              Documents <span className="board-chip-count">{unassignedDocs.length}</span>
            </button>
          )}
          {workspaces.map(ws => {
            const hasContainers = ws.workspace?.root.some(n => n.type === 'container');
            return (
              <button
                key={ws.filename}
                className={`board-chip ${dropdownKey === ws.filename ? 'open' : ''}`}
                onClick={(e) => hasContainers
                  ? drillIn({ type: 'workspace', key: ws.filename, title: ws.title, wsFilename: ws.filename })
                  : toggleDropdown(ws.filename, e)
                }
              >
                {ws.title} <span className="board-chip-count">{ws.docCount}</span>
                {hasContainers && <span className="board-chip-arrow">&rsaquo;</span>}
              </button>
            );
          })}
          <button className="board-chip board-chip-add" onClick={actions.handleCreateWorkspace} title="New workspace">+</button>
        </>
      )}

      {/* Drilled in: containers + direct docs dropdown */}
      {path.length > 0 && (
        <>
          {currentDocs.length > 0 && (
            <button
              className={`board-chip board-chip-docs ${dropdownKey === '__level-docs__' ? 'open' : ''}`}
              onClick={(e) => toggleDropdown('__level-docs__', e)}
            >
              Docs <span className="board-chip-count">{currentDocs.length}</span>
            </button>
          )}
          {currentContainers.map(c => {
            const hasSubContainers = c.items.some(n => n.type === 'container');
            return (
              <button
                key={c.id}
                className={`board-chip ${dropdownKey === c.id ? 'open' : ''}`}
                onClick={(e) => hasSubContainers
                  ? drillIn({ type: 'container', key: c.id, title: c.name, wsFilename: path[path.length - 1].wsFilename })
                  : toggleDropdown(c.id, e)
                }
              >
                {c.name} <span className="board-chip-count">{countDocs(c.items)}</span>
                {hasSubContainers && <span className="board-chip-arrow">&rsaquo;</span>}
              </button>
            );
          })}
        </>
      )}

      {/* Fixed-position dropdown — escapes overflow:hidden ancestors */}
      {dropdownKey && dropdownPos && (() => {
        const docList = getDropdownDocs();
        return (
          <div
            className="board-dropdown"
            ref={dropdownRef}
            style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
          >
            {docList.map(doc => (
              <div
                key={doc.filename}
                className={`board-dropdown-item ${doc.isActive ? 'active' : ''}`}
                onClick={() => handleDocClick(doc.filename)}
              >
                <span className="board-dropdown-title">
                  {doc.title}
                  {pendingDocs.filenames.includes(doc.filename) && <span className="board-pending-dot" />}
                </span>
                <span className="board-dropdown-meta">
                  {doc.wordCount.toLocaleString()} words &middot; {formatDate(doc.lastModified)}
                </span>
              </div>
            ))}
            {docList.length === 0 && <div className="board-dropdown-empty">No documents</div>}
          </div>
        );
      })()}
    </div>
  );
}
