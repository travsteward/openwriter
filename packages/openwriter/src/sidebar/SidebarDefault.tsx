import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SidebarModeProps, DocumentInfo, WorkspaceNode, ContainerItem } from './sidebar-types';
import { useSidebarDrag } from './sidebar-drag';
import { useRevealActiveDoc } from './use-reveal-active-doc';
import { collectFiles, formatDate, isAutoAcceptInheritedForDoc, isExternal, parentDir } from './sidebar-utils';
import SidebarContextMenu from './SidebarContextMenu';
import type { SidebarMenuItem } from './SidebarContextMenu';
import { transformExceedsSizeCap } from './transform-guard';
import FocusInstructionsModal from './FocusInstructionsModal';
import SearchResults from './SearchResults';
import { sidebarRowProps } from './sidebar-keyboard';
import NewsletterAnalyticsModal from '../newsletter/NewsletterAnalyticsModal';
import SchedulePostModal from './SchedulePostModal';
import CreateDocDropdown from './CreateDocDropdown';
import { getSidebarDensity, setSidebarDensity } from '../themes/appearance-store';
import type { SidebarDensity } from '../themes/appearance-store';

const DENSITY_OPTIONS: { id: SidebarDensity; label: string }[] = [
  { id: 'full', label: 'Full' },
  { id: 'compact', label: 'Compact' },
  { id: 'minimal', label: 'Minimal' },
];

/** Find the container path (array of container IDs) to a doc in the workspace tree. */
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

export default function SidebarDefault({ docs, archivedDocs, workspaces, assignedFiles, pendingDocs, onSwitchDocument, onCreateDocument, actions, scrollRef, writingTitle, writingTarget, pendingWriteFilenames, searchQuery, searchResults, searchLoading, searchError, onSearchChange }: SidebarModeProps) {
  const isPending = (filename: string) => !!pendingWriteFilenames && pendingWriteFilenames.has(filename);
  const [editingFilename, setEditingFilename] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('ow-collapsed-sections');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState<string | null>(null);
  const [editingContainerId, setEditingContainerId] = useState<string | null>(null);
  const [containerEditValue, setContainerEditValue] = useState('');
  const [editingWorkspaceFilename, setEditingWorkspaceFilename] = useState<string | null>(null);
  const [workspaceEditValue, setWorkspaceEditValue] = useState('');
  const [tagInputFile, setTagInputFile] = useState<string | null>(null);
  const [tagInputValue, setTagInputValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; filename: string; title: string; docId?: string; lastSent?: string; postedUrl?: string; isNewsletter?: boolean } | null>(null);
  const [analyticsModal, setAnalyticsModal] = useState<{ docId: string; title: string } | null>(null);
  const [sidebarPluginItems, setSidebarPluginItems] = useState<SidebarMenuItem[]>([]);
  // Schedule Post is wired to /api/scheduler/* (platform publish plugin). Hide
  // the menu item entirely when @openwriter/plugin-publish is disabled.
  const [hasPublishPlugin, setHasPublishPlugin] = useState(false);
  const [focusModal, setFocusModal] = useState<{ action: string; label: string; filename: string; title: string } | null>(null);
  const [scheduleModal, setScheduleModal] = useState<{ filename: string; title: string } | null>(null);
  const [createDropdown, setCreateDropdown] = useState<{ anchor: DOMRect; wsFilename?: string; containerId?: string | null } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; type: 'workspace' | 'container'; wsFilename: string; containerId?: string; title: string; nodes: WorkspaceNode[]; autoAccept?: boolean } | null>(null);
  const [densityMenu, setDensityMenu] = useState<{ x: number; y: number } | null>(null);
  const [density, setDensity] = useState<SidebarDensity>(getSidebarDensity);
  const densityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!densityMenu) return;
    const handler = (e: MouseEvent) => {
      if (densityRef.current && !densityRef.current.contains(e.target as Node)) setDensityMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [densityMenu]);

  const handleDensitySelect = (id: SidebarDensity) => {
    setDensity(id);
    setSidebarDensity(id);
    setDensityMenu(null);
  };

  const handleSectionContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setDensityMenu({ x: e.clientX, y: e.clientY });
  };

  const handleBatchResolve = useCallback((filenames: string[], action: 'accept' | 'reject') => {
    fetch('/api/documents/batch-resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames, action }),
    }).catch(() => {});
  }, []);

  const { draggedItem, dropIndicator, handlePointerDown, dropClass, isDragging, isContainerDropTarget } = useSidebarDrag({
    docs, workspaces, assignedFiles, scrollRef, setCollapsedSections,
  });

  // Fetch sidebar plugin items
  const fetchSidebarItems = useCallback(() => {
    fetch('/api/plugins')
      .then((r) => r.json())
      .then((data) => {
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

  const handleDocContextMenu = useCallback((e: React.MouseEvent, doc: DocumentInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, filename: doc.filename, title: doc.title, docId: doc.docId, lastSent: doc.lastSent, postedUrl: doc.postedUrl, isNewsletter: doc.isNewsletter });
  }, []);

  const handleDuplicate = useCallback((filename: string) => {
    fetch('/api/documents/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    }).catch(() => {});
  }, []);

  // Create a variant: a retyped derivative nested under the master. The server
  // field-projects the master onto the target type (body always; title folds
  // into the body on a downcast; target type scaffolded) — NOT a verbatim clone.
  // adr: docs/variants.md
  const handleCreateVariant = useCallback((filename: string, masterDocId: string, variantType: string) => {
    fetch('/api/documents/variant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, masterDocId, variantType }),
    }).catch(() => {});
  }, []);

  const handlePluginAction = useCallback((action: string, item: SidebarMenuItem, filename: string, title: string, instructions?: string) => {
    // Block oversized docs before any model/publish call (mirrors the AV guard).
    if (transformExceedsSizeCap(item, docs.find((d) => d.filename === filename))) return;
    if (item.promptForFocus && instructions === undefined) {
      setFocusModal({ action, label: item.label, filename, title });
      return;
    }
    fetch('/api/plugins/sidebar-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, filename, title, instructions: instructions || '', label: item.label }),
    }).catch(() => {});
  }, [docs]);

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem('ow-collapsed-sections', JSON.stringify([...next]));
      return next;
    });
  };

  // Reveal-in-tree: expand the active doc's ancestors and center/pulse it on a
  // directed open. The shared hook owns the scroll/pulse timing; this mode only
  // supplies how to expand ancestors given its own collapse-state store.
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;

  const expandAncestors = useCallback((filename: string) => {
    for (const ws of workspacesRef.current) {
      const path = findDocPath(ws.workspace?.root || [], filename);
      if (path) {
        setCollapsedSections((prev) => {
          const keysToExpand = [ws.filename, ...path.map((id) => `container-${id}`)];
          if (keysToExpand.every((k) => !prev.has(k))) return prev; // already expanded
          const next = new Set(prev);
          for (const k of keysToExpand) next.delete(k);
          localStorage.setItem('ow-collapsed-sections', JSON.stringify([...next]));
          return next;
        });
        break;
      }
    }
  }, []);
  useRevealActiveDoc(scrollRef, docs, workspaces.length, expandAncestors);

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

  // Search mode: replace normal content with search results
  if (searchResults !== null) {
    return <SearchResults results={searchResults} query={searchQuery} onSwitchDocument={onSwitchDocument} actions={actions} loading={searchLoading} error={searchError} />;
  }

  const unassignedDocs = docs.filter((d) => !assignedFiles.has(d.filename) && !variantFilenames.has(d.filename));

  const renderDocItem = (
    doc: DocumentInfo, wsFilename: string | undefined,
    containerId: string | null, _siblings: WorkspaceNode[], _itemIndex: number,
    inheritedAutoAccept: boolean = false,
  ) => (
    <div
      key={doc.filename}
      {...sidebarRowProps()}
      aria-current={doc.isActive ? 'page' : undefined}
      className={`sidebar-item ${doc.isActive ? 'active' : ''} ${isDragging(doc.filename) ? 'dragging' : ''} ${dropClass(doc.filename)}`}
      data-drag-id={doc.filename}
      data-drag-type="doc"
      data-drag-ws={wsFilename || '__docs__'}
      data-drag-container={containerId || ''}
      onPointerDown={(e) => handlePointerDown(e, { type: 'doc', file: doc.filename, sourceWs: wsFilename || null }, doc.title)}
      onClick={() => !doc.isActive && !draggedItem && onSwitchDocument(doc.filename)}
      onDoubleClick={() => { setEditingFilename(doc.filename); setEditValue(doc.title); }}
      onContextMenu={(e) => handleDocContextMenu(e, doc)}
    >
      {editingFilename === doc.filename ? (
        <input
          className="sidebar-rename-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => { actions.handleRename(doc.filename, doc.title, editValue); setEditingFilename(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { actions.handleRename(doc.filename, doc.title, editValue); setEditingFilename(null); }
            if (e.key === 'Escape') setEditingFilename(null);
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <div className="sidebar-item-title">
            <span className="sidebar-item-title-text">{doc.title}</span>
            {doc.variantType && <span className="files-badge-variant">{doc.variantType}</span>}
            {actions.getDocTags(doc.filename).includes('✓') && (
              <svg className="sidebar-approved-icon" aria-label="Approved" role="img" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {doc.lastSent && (
              <svg className="sidebar-sent-icon" aria-label="Sent" role="img" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {(doc.autoAccept === true || (doc.autoAccept !== false && inheritedAutoAccept)) && <span className="sidebar-auto-accept-dot" title={doc.autoAccept === true ? "Auto-accept on" : "Auto-accept inherited"} />}
            {pendingDocs.filenames.includes(doc.filename) && <span className="sidebar-pending-dot" />}
          </div>
          {isExternal(doc.filename) && <div className="sidebar-item-context">{parentDir(doc.filename)}</div>}
          <div className="sidebar-item-meta">
            {doc.wordCount.toLocaleString()} words &middot; {formatDate(doc.lastModified)}
          </div>
          <div className="sidebar-tags">
            {actions.getDocTags(doc.filename).filter(tag => tag !== '✓').map(tag => (
              <span key={tag} className="sidebar-tag" onClick={(e) => e.stopPropagation()}>
                {tag}
                <span className="sidebar-tag-remove" onClick={(e) => { e.stopPropagation(); actions.handleRemoveTag(doc.filename, tag); }}>&times;</span>
              </span>
            ))}
            {tagInputFile === doc.filename ? (
              <input
                className="sidebar-tag-input"
                value={tagInputValue}
                onChange={(e) => setTagInputValue(e.target.value)}
                onBlur={() => { if (tagInputValue.trim()) actions.handleAddTag(doc.filename, tagInputValue); setTagInputFile(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { actions.handleAddTag(doc.filename, tagInputValue); setTagInputFile(null); setTagInputValue(''); }
                  if (e.key === 'Escape') { setTagInputFile(null); setTagInputValue(''); }
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                placeholder="tag..."
              />
            ) : (
              <button className="sidebar-tag-add" onClick={(e) => { e.stopPropagation(); setTagInputFile(doc.filename); setTagInputValue(''); }}>+</button>
            )}
          </div>
        </>
      )}
      {confirmDelete === doc.filename ? (
        <div className="sidebar-confirm-delete" onClick={(e) => e.stopPropagation()}>
          <span>{isExternal(doc.filename) ? 'Remove?' : 'Delete?'}</span>
          <button onClick={() => { actions.handleDelete(doc.filename); setConfirmDelete(null); }}>Yes</button>
          <button onClick={() => setConfirmDelete(null)}>No</button>
        </div>
      ) : (
        <button className="sidebar-delete-btn" onClick={(e) => { e.stopPropagation(); setConfirmDelete(doc.filename); }} title={isExternal(doc.filename) ? 'Remove document' : 'Delete document'}>&times;</button>
      )}
    </div>
  );

  const renderDocItemWithVariants = (
    doc: DocumentInfo, wsFilename: string | undefined,
    containerId: string | null, siblings: WorkspaceNode[], itemIndex: number,
    inheritedAutoAccept: boolean = false,
  ) => {
    const variants = doc.docId ? variantsByMaster.get(doc.docId) : undefined;
    const isSpinnerTarget = writingTitle && writingTarget?.parentDocId && writingTarget.parentDocId === doc.docId;
    const showGroup = (variants && variants.length > 0) || isSpinnerTarget;

    if (!showGroup) return renderDocItem(doc, wsFilename, containerId, siblings, itemIndex, inheritedAutoAccept);

    const variantKey = `variants-${doc.docId}`;
    const isExpanded = !collapsedSections.has(variantKey);

    return (
      <div key={`vg-${doc.filename}`} className="sidebar-variant-group">
        <div className={`sidebar-variant-master${!isExpanded && activeTrail?.masterDocId === doc.docId ? ' active-within' : ''}`} onClick={(e) => { if ((e.target as HTMLElement).closest('.sidebar-variant-chevron')) { e.stopPropagation(); toggleSection(variantKey); } }}>
          {renderDocItem(doc, wsFilename, containerId, siblings, itemIndex, inheritedAutoAccept)}
          <span className={`sidebar-variant-chevron${isExpanded ? '' : ' collapsed'}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </div>
        {isExpanded && (
          <div className="sidebar-variant-children">
            {variants?.map((v, i) => renderDocItem(v, wsFilename, containerId, siblings, i, inheritedAutoAccept))}
            {isSpinnerTarget && (
              <div className="sidebar-item sidebar-writing-placeholder">
                <div className="sidebar-item-title">
                  <span className="sidebar-writing-spinner" />
                  <span className="sidebar-item-title-text">{writingTitle}</span>
                </div>
                <div className="sidebar-item-meta">Writing...</div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderNode = (
    node: WorkspaceNode, depth: number, wsFilename: string,
    parentContainerId: string | null, siblings: WorkspaceNode[], itemIndex: number,
    inheritedAutoAccept: boolean = false,
  ): JSX.Element => {
    if (node.type === 'doc') {
      const doc = docs.find((d) => d.filename === node.file);
      if (!doc) {
        if (isExternal(node.file)) {
          return (
            <div key={node.file} className="sidebar-item sidebar-unavailable">
              <div className="sidebar-item-title">{node.title || node.file} (unavailable)</div>
            </div>
          );
        }
        return (
          <div key={node.file} className="sidebar-item sidebar-missing">
            <div className="sidebar-item-title">{node.title || node.file} (missing)</div>
            <button className="sidebar-delete-btn" onClick={() => actions.handleRemoveFromWorkspace(wsFilename, node.file)} title="Remove">&times;</button>
          </div>
        );
      }
      // Skip variant docs in workspace tree — they appear nested under their master
      if (variantFilenames.has(doc.filename)) return <></>;
      return renderDocItemWithVariants(doc, wsFilename, parentContainerId, siblings, itemIndex, inheritedAutoAccept);
    }

    const container = node as ContainerItem;
    const containerKey = `container-${container.id}`;
    const isCollapsed = collapsedSections.has(containerKey);
    const depthClass = depth <= 2 ? `depth-${depth}` : 'depth-2';
    const ownAutoAccept = (container as any).autoAccept === true;
    const effectiveAutoAccept = ownAutoAccept || inheritedAutoAccept;

    return (
      <div key={container.id} className={`sidebar-container ${depthClass} ${isCollapsed ? 'collapsed' : ''} ${dropClass(container.id)} ${isContainerDropTarget(container.id) ? 'drop-inside' : ''}`}>
        <div
          className={`sidebar-container-header${isCollapsed && activeTrail?.containerKeys.has(containerKey) ? ' active-within' : ''} ${dropIndicator?.itemId === container.id && dropIndicator.position === 'inside' ? 'drop-inside' : ''}`}
          {...sidebarRowProps(!isCollapsed)}
          data-drag-id={container.id}
          data-drag-type="container-header"
          data-drag-ws={wsFilename}
          data-drag-parent={parentContainerId || ''}
          data-section-key={containerKey}
          onPointerDown={(e) => handlePointerDown(e, { type: 'container', id: container.id, sourceWs: wsFilename }, container.name)}
          onClick={() => !draggedItem && toggleSection(containerKey)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFolderMenu({ x: e.clientX, y: e.clientY, type: 'container', wsFilename, containerId: container.id, title: container.name, nodes: container.items, autoAccept: ownAutoAccept });
          }}
        >
          <span className={`sidebar-chevron ${isCollapsed ? 'collapsed' : ''}`}>&#9662;</span>
          {editingContainerId === container.id ? (
            <input
              className="sidebar-rename-input"
              value={containerEditValue}
              onChange={(e) => setContainerEditValue(e.target.value)}
              onBlur={() => { actions.handleRenameContainer(wsFilename, container.id, containerEditValue); setEditingContainerId(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { actions.handleRenameContainer(wsFilename, container.id, containerEditValue); setEditingContainerId(null); }
                if (e.key === 'Escape') setEditingContainerId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="sidebar-container-name" onDoubleClick={(e) => { e.stopPropagation(); setEditingContainerId(container.id); setContainerEditValue(container.name); }}>
              {container.name}
            </span>
          )}
          {effectiveAutoAccept && <span className="sidebar-auto-accept-dot" title={ownAutoAccept ? "Auto-accept on for this container" : "Auto-accept inherited from workspace"} />}
          <div className="sidebar-container-actions">
            <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); setCreateDropdown({ anchor: (e.target as HTMLElement).getBoundingClientRect(), wsFilename, containerId: container.id }); }} title="New doc">+</button>
            {depth < 2 && <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); actions.handleCreateContainer(wsFilename, container.id); }} title="New sub-container">&#9744;</button>}
            <button className="sidebar-new-btn sidebar-container-delete" onClick={(e) => { e.stopPropagation(); actions.handleDeleteContainer(wsFilename, container.id); }} title="Delete container">&times;</button>
          </div>
        </div>
        {!isCollapsed && (
          <div className="sidebar-container-list" data-drop-ws={wsFilename} data-drop-container={container.id}>
            {writingTitle && !writingTarget?.parentDocId && writingTarget?.wsFilename === wsFilename && writingTarget.containerId === container.id && (
              <div className="sidebar-item sidebar-writing-placeholder">
                <div className="sidebar-item-title">
                  <span className="sidebar-writing-spinner" />
                  <span className="sidebar-item-title-text">{writingTitle}</span>
                </div>
                <div className="sidebar-item-meta">Writing...</div>
              </div>
            )}
            {container.items.filter(n => {
              if (n.type !== 'doc') return true;
              if (isPending(n.file)) return false;
              if (writingTitle && writingTarget?.wsFilename === wsFilename && writingTarget.containerId === container.id && n.title === writingTitle) return false;
              return true;
            }).map((child, i) => renderNode(child, depth + 1, wsFilename, container.id, container.items, i, effectiveAutoAccept))}
            {container.items.length === 0 && !writingTitle && <div className="sidebar-empty">{draggedItem ? 'Drop here' : 'Empty'}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar-scroll" ref={scrollRef}>
      <div className={`sidebar-section sidebar-docs-section ${collapsedSections.has('docs') ? 'docs-collapsed' : ''}`}>
        <div className={`sidebar-section-header${collapsedSections.has('docs') && activeTrail !== null && activeTrail.wsFilename === null ? ' active-within' : ''}`} data-section-key="docs" onClick={() => toggleSection('docs')} onContextMenu={handleSectionContextMenu}>
          <span className={`sidebar-chevron ${collapsedSections.has('docs') ? 'collapsed' : ''}`}>&#9662;</span>
          <span {...sidebarRowProps(!collapsedSections.has('docs'))} className="sidebar-label">Documents</span>
          <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); setCreateDropdown({ anchor: (e.target as HTMLElement).getBoundingClientRect() }); }} title="New document">+</button>
        </div>
        {!collapsedSections.has('docs') && (
          <div className="sidebar-section-list" data-drop-ws="__docs__">
            {writingTitle && !writingTarget?.parentDocId && (!writingTarget || !workspaces.some(w => w.filename === writingTarget?.wsFilename)) && (
              <div className="sidebar-item sidebar-writing-placeholder">
                <div className="sidebar-item-title">
                  <span className="sidebar-writing-spinner" />
                  <span className="sidebar-item-title-text">{writingTitle}</span>
                </div>
                <div className="sidebar-item-meta">Writing...</div>
              </div>
            )}
            {unassignedDocs.filter((d) => !isPending(d.filename) && (!writingTitle || d.title !== writingTitle)).map((doc, i) => {
              const siblings: WorkspaceNode[] = unassignedDocs.map((d) => ({ type: 'doc' as const, file: d.filename, title: d.title }));
              return renderDocItemWithVariants(doc, undefined, null, siblings, i);
            })}
            {unassignedDocs.length === 0 && <div className="sidebar-empty">{draggedItem ? 'Drop here to unassign' : 'No unassigned documents'}</div>}
          </div>
        )}
      </div>

      {workspaces.map((wsInfo) => {
        const wsRoot = wsInfo.workspace?.root || [];
        const isCollapsed = collapsedSections.has(wsInfo.filename);
        const wsAutoAccept = (wsInfo as any).workspace?.autoAccept === true || (wsInfo as any).autoAccept === true;
        return (
          <div key={wsInfo.filename} className={`sidebar-section sidebar-workspace-section ${isCollapsed ? 'ws-collapsed' : ''} ${isDragging(wsInfo.filename) ? 'dragging' : ''} ${dropIndicator?.itemId === wsInfo.filename ? (dropIndicator.position === 'before' ? 'drop-before' : 'drop-after') : ''}`}>
            <div
              className={`sidebar-section-header${isCollapsed && activeTrail?.wsFilename === wsInfo.filename ? ' active-within' : ''}`}
              data-section-key={wsInfo.filename}
              data-ws-drag={wsInfo.filename}
              onPointerDown={(e) => handlePointerDown(e, { type: 'workspace', filename: wsInfo.filename }, wsInfo.title)}
              onClick={() => !draggedItem && toggleSection(wsInfo.filename)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setFolderMenu({ x: e.clientX, y: e.clientY, type: 'workspace', wsFilename: wsInfo.filename, title: wsInfo.title, nodes: wsRoot, autoAccept: (wsInfo as any).workspace?.autoAccept === true || (wsInfo as any).autoAccept === true });
              }}
            >
              <span className={`sidebar-chevron ${isCollapsed ? 'collapsed' : ''}`}>&#9662;</span>
              {editingWorkspaceFilename === wsInfo.filename ? (
                <input
                  className="sidebar-rename-input"
                  value={workspaceEditValue}
                  onChange={(e) => setWorkspaceEditValue(e.target.value)}
                  onBlur={() => { actions.handleRenameWorkspace(wsInfo.filename, workspaceEditValue); setEditingWorkspaceFilename(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { actions.handleRenameWorkspace(wsInfo.filename, workspaceEditValue); setEditingWorkspaceFilename(null); }
                    if (e.key === 'Escape') setEditingWorkspaceFilename(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span {...sidebarRowProps(!isCollapsed)} className="sidebar-label sidebar-workspace-label" onDoubleClick={(e) => { e.stopPropagation(); setEditingWorkspaceFilename(wsInfo.filename); setWorkspaceEditValue(wsInfo.title); }}>
                  {wsInfo.title}
                </span>
              )}
              {((wsInfo as any).workspace?.autoAccept === true || (wsInfo as any).autoAccept === true) && <span className="sidebar-auto-accept-dot" title="Auto-accept on for this workspace" />}
              <div className="sidebar-workspace-actions">
                <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); setCreateDropdown({ anchor: (e.target as HTMLElement).getBoundingClientRect(), wsFilename: wsInfo.filename, containerId: null }); }} title="New document">+</button>
                <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); actions.handleCreateContainer(wsInfo.filename, null); }} title="New container">&#9744;</button>
                {confirmDeleteWorkspace === wsInfo.filename ? (
                  <span className="sidebar-inline-confirm" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { actions.handleDeleteWorkspace(wsInfo.filename); setConfirmDeleteWorkspace(null); }}>Yes</button>
                    <button onClick={() => setConfirmDeleteWorkspace(null)}>No</button>
                  </span>
                ) : (
                  <button className="sidebar-new-btn sidebar-workspace-delete" onClick={(e) => { e.stopPropagation(); setConfirmDeleteWorkspace(wsInfo.filename); }} title="Delete workspace">&times;</button>
                )}
              </div>
            </div>
            {!isCollapsed && (
              <div className="sidebar-section-list" data-drop-ws={wsInfo.filename}>
                {/* adr: adr/sidebar-spinner-placement.md */}
                {writingTitle && !writingTarget?.parentDocId && writingTarget?.wsFilename === wsInfo.filename && writingTarget.containerId === null && (
                  <div className="sidebar-item sidebar-writing-placeholder">
                    <div className="sidebar-item-title">
                      <span className="sidebar-writing-spinner" />
                      <span className="sidebar-item-title-text">{writingTitle}</span>
                    </div>
                    <div className="sidebar-item-meta">Writing...</div>
                  </div>
                )}
                {wsRoot.filter(n => {
                  if (n.type !== 'doc') return true;
                  if (isPending(n.file)) return false;
                  if (writingTitle && writingTarget?.wsFilename === wsInfo.filename && writingTarget.containerId === null && n.title === writingTitle) return false;
                  return true;
                }).map((node, i) => renderNode(node, 0, wsInfo.filename, null, wsRoot, i, wsAutoAccept))}
                {wsRoot.length === 0 && !writingTitle && <div className="sidebar-empty">{draggedItem ? 'Drop here to add' : 'Empty workspace'}</div>}
              </div>
            )}
          </div>
        );
      })}

      <div className="sidebar-new-workspace">
        <button onClick={actions.handleCreateWorkspace}>+ New Workspace</button>
      </div>

      {folderMenu && (
        <SidebarContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          filename={folderMenu.wsFilename}
          title={folderMenu.title}
          onClose={() => setFolderMenu(null)}
          onDuplicate={() => {}}
          onRename={() => {
            if (folderMenu.type === 'workspace') { setEditingWorkspaceFilename(folderMenu.wsFilename); setWorkspaceEditValue(folderMenu.title); }
            else if (folderMenu.containerId) { setEditingContainerId(folderMenu.containerId); setContainerEditValue(folderMenu.title); }
            setFolderMenu(null);
          }}
          onArchive={() => {}}
          onDelete={() => {
            if (folderMenu.type === 'workspace') actions.handleDeleteWorkspace(folderMenu.wsFilename);
            else if (folderMenu.containerId) actions.handleDeleteContainer(folderMenu.wsFilename, folderMenu.containerId);
          }}
          onPluginAction={() => {}}
          pluginItems={[]}
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
            const files = new Set<string>();
            collectFiles(folderMenu.nodes, files);
            if (files.size) handleBatchResolve([...files], 'accept');
            setFolderMenu(null);
          }}
          onRejectAll={() => {
            const files = new Set<string>();
            collectFiles(folderMenu.nodes, files);
            if (files.size) handleBatchResolve([...files], 'reject');
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
        />
      )}
      {ctxMenu && (
        <SidebarContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          filename={ctxMenu.filename}
          title={ctxMenu.title}
          onClose={() => setCtxMenu(null)}
          onDuplicate={() => handleDuplicate(ctxMenu.filename)}
          onCreateVariant={ctxMenu.docId ? (vt) => handleCreateVariant(ctxMenu.filename, ctxMenu.docId!, vt) : undefined}
          onRename={() => { setEditingFilename(ctxMenu.filename); setEditValue(ctxMenu.title); }}
          onArchive={() => actions.handleArchive(ctxMenu.filename)}
          onDelete={() => actions.handleDelete(ctxMenu.filename)}
          onPluginAction={(action, item) => handlePluginAction(action, item, ctxMenu.filename, ctxMenu.title)}
          pluginItems={sidebarPluginItems}
          onSchedulePost={hasPublishPlugin ? () => {
            setScheduleModal({ filename: ctxMenu.filename, title: ctxMenu.title });
            setCtxMenu(null);
          } : undefined}
          onViewAnalytics={ctxMenu.docId && ctxMenu.lastSent && (ctxMenu.postedUrl || ctxMenu.isNewsletter) ? () => {
            if (ctxMenu.isNewsletter) {
              setAnalyticsModal({ docId: ctxMenu.docId!, title: ctxMenu.title });
            } else if (ctxMenu.postedUrl) {
              window.open(ctxMenu.postedUrl, '_blank');
            }
            setCtxMenu(null);
          } : undefined}
          viewAnalyticsLabel={ctxMenu.isNewsletter ? 'View Analytics' : ctxMenu.postedUrl ? 'View on X' : 'View Analytics'}
          isApproved={actions.getDocTags(ctxMenu.filename).includes('✓')}
          onToggleApprove={() => {
            const tags = actions.getDocTags(ctxMenu.filename);
            if (tags.includes('✓')) {
              actions.handleRemoveTag(ctxMenu.filename, '✓');
            } else {
              actions.handleAddTag(ctxMenu.filename, '✓');
              // Brief delay so React processes tag update before accept-all fires
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
            // Clear approval on send — blue checkmark is a pre-send state
            if (actions.getDocTags(fn).includes('✓')) {
              actions.handleRemoveTag(fn, '✓');
            }
            // Switch to the doc first so /api/metadata targets it, then set manualPost
            onSwitchDocument(fn);
            setTimeout(() => {
              fetch('/api/metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manualPost: { postedAt: new Date().toISOString() } }),
              }).then(() => actions.fetchDocs()).catch(() => {});
            }, 100);
            setCtxMenu(null);
          }}
        />
      )}
      {focusModal && (
        <FocusInstructionsModal
          actionLabel={focusModal.label}
          docTitle={focusModal.title}
          onClose={() => setFocusModal(null)}
          onConfirm={(instructions) => {
            const item = sidebarPluginItems.find(i => i.action === focusModal.action);
            if (item) handlePluginAction(focusModal.action, item, focusModal.filename, focusModal.title, instructions);
            setFocusModal(null);
          }}
        />
      )}
      {analyticsModal && (
        <NewsletterAnalyticsModal
          docId={analyticsModal.docId}
          title={analyticsModal.title}
          onClose={() => setAnalyticsModal(null)}
        />
      )}
      {scheduleModal && (
        <SchedulePostModal
          filename={scheduleModal.filename}
          title={scheduleModal.title}
          onClose={() => setScheduleModal(null)}
        />
      )}
      {createDropdown && (
        <CreateDocDropdown
          anchorRect={createDropdown.anchor}
          onClose={() => setCreateDropdown(null)}
          onSelect={(metadata) => {
            setCreateDropdown(null);
            if (createDropdown.wsFilename) {
              actions.handleCreateInWorkspace(createDropdown.wsFilename, createDropdown.containerId ?? null, metadata);
            } else if (metadata) {
              // Unassigned doc with metadata — create via HTTP so metadata is set
              fetch('/api/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metadata }),
              }).catch(() => {});
            } else {
              onCreateDocument();
            }
          }}
        />
      )}
      {densityMenu && (
        <div
          ref={densityRef}
          className="sidebar-density-dropdown"
          style={{ position: 'fixed', left: densityMenu.x, top: densityMenu.y, zIndex: 200 }}
        >
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`sidebar-density-option ${density === opt.id ? 'active' : ''}`}
              onClick={() => handleDensitySelect(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
