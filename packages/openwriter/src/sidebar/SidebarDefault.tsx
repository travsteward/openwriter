import { useState } from 'react';
import type { SidebarModeProps, DocumentInfo, WorkspaceNode, ContainerItem } from './sidebar-types';
import { useSidebarDrag } from './sidebar-drag';
import { formatDate, isExternal, parentDir } from './sidebar-utils';

export default function SidebarDefault({ docs, workspaces, assignedFiles, pendingDocs, onSwitchDocument, onCreateDocument, actions, scrollRef }: SidebarModeProps) {
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
  const [tagInputFile, setTagInputFile] = useState<string | null>(null);
  const [tagInputValue, setTagInputValue] = useState('');

  const { draggedItem, dropIndicator, handlePointerDown, dropClass, isDragging, isContainerDropTarget } = useSidebarDrag({
    docs, workspaces, assignedFiles, scrollRef, setCollapsedSections,
  });

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem('ow-collapsed-sections', JSON.stringify([...next]));
      return next;
    });
  };

  const unassignedDocs = docs.filter((d) => !assignedFiles.has(d.filename));

  const renderDocItem = (
    doc: DocumentInfo, wsFilename: string | undefined,
    containerId: string | null, _siblings: WorkspaceNode[], _itemIndex: number,
  ) => (
    <div
      key={doc.filename}
      className={`sidebar-item ${doc.isActive ? 'active' : ''} ${isDragging(doc.filename) ? 'dragging' : ''} ${dropClass(doc.filename)}`}
      data-drag-id={doc.filename}
      data-drag-type="doc"
      data-drag-ws={wsFilename || '__docs__'}
      data-drag-container={containerId || ''}
      onPointerDown={(e) => handlePointerDown(e, { type: 'doc', file: doc.filename, sourceWs: wsFilename || null }, doc.title)}
      onClick={() => !doc.isActive && !draggedItem && onSwitchDocument(doc.filename)}
      onDoubleClick={() => { setEditingFilename(doc.filename); setEditValue(doc.title); }}
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
            {pendingDocs.filenames.includes(doc.filename) && <span className="sidebar-pending-dot" />}
          </div>
          {isExternal(doc.filename) && <div className="sidebar-item-context">{parentDir(doc.filename)}</div>}
          <div className="sidebar-item-meta">
            {doc.wordCount.toLocaleString()} words &middot; {formatDate(doc.lastModified)}
          </div>
          {wsFilename && (
            <div className="sidebar-tags">
              {actions.getDocTags(wsFilename, doc.filename).map(tag => (
                <span key={tag} className="sidebar-tag" onClick={(e) => e.stopPropagation()}>
                  {tag}
                  <span className="sidebar-tag-remove" onClick={(e) => { e.stopPropagation(); actions.handleRemoveTag(wsFilename, doc.filename, tag); }}>&times;</span>
                </span>
              ))}
              {tagInputFile === doc.filename ? (
                <input
                  className="sidebar-tag-input"
                  value={tagInputValue}
                  onChange={(e) => setTagInputValue(e.target.value)}
                  onBlur={() => { if (tagInputValue.trim()) actions.handleAddTag(wsFilename, doc.filename, tagInputValue); setTagInputFile(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { actions.handleAddTag(wsFilename, doc.filename, tagInputValue); setTagInputFile(null); setTagInputValue(''); }
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
          )}
        </>
      )}
      {wsFilename ? (
        <button className="sidebar-delete-btn" onClick={(e) => { e.stopPropagation(); actions.handleRemoveFromWorkspace(wsFilename, doc.filename); }} title="Remove from workspace">&times;</button>
      ) : confirmDelete === doc.filename ? (
        <div className="sidebar-confirm-delete" onClick={(e) => e.stopPropagation()}>
          <span>Delete?</span>
          <button onClick={() => { actions.handleDelete(doc.filename); setConfirmDelete(null); }}>Yes</button>
          <button onClick={() => setConfirmDelete(null)}>No</button>
        </div>
      ) : (
        <button className="sidebar-delete-btn" onClick={(e) => { e.stopPropagation(); setConfirmDelete(doc.filename); }} title="Delete document">&times;</button>
      )}
    </div>
  );

  const renderNode = (
    node: WorkspaceNode, depth: number, wsFilename: string,
    parentContainerId: string | null, siblings: WorkspaceNode[], itemIndex: number,
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
      return renderDocItem(doc, wsFilename, parentContainerId, siblings, itemIndex);
    }

    const container = node as ContainerItem;
    const containerKey = `container-${container.id}`;
    const isCollapsed = collapsedSections.has(containerKey);
    const depthClass = depth <= 2 ? `depth-${depth}` : 'depth-2';

    return (
      <div key={container.id} className={`sidebar-container ${depthClass} ${isCollapsed ? 'collapsed' : ''} ${dropClass(container.id)} ${isContainerDropTarget(container.id) ? 'drop-inside' : ''}`}>
        <div
          className={`sidebar-container-header ${dropIndicator?.itemId === container.id && dropIndicator.position === 'inside' ? 'drop-inside' : ''}`}
          data-drag-id={container.id}
          data-drag-type="container-header"
          data-drag-ws={wsFilename}
          data-drag-parent={parentContainerId || ''}
          data-section-key={containerKey}
          onPointerDown={(e) => handlePointerDown(e, { type: 'container', id: container.id, sourceWs: wsFilename }, container.name)}
          onClick={() => !draggedItem && toggleSection(containerKey)}
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
          <div className="sidebar-container-actions">
            <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); actions.handleCreateInWorkspace(wsFilename, container.id); }} title="New doc">+</button>
            {depth < 2 && <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); actions.handleCreateContainer(wsFilename, container.id); }} title="New sub-container">&#9744;</button>}
            <button className="sidebar-new-btn sidebar-container-delete" onClick={(e) => { e.stopPropagation(); actions.handleDeleteContainer(wsFilename, container.id); }} title="Delete container">&times;</button>
          </div>
        </div>
        {!isCollapsed && (
          <div className="sidebar-container-list" data-drop-ws={wsFilename} data-drop-container={container.id}>
            {container.items.map((child, i) => renderNode(child, depth + 1, wsFilename, container.id, container.items, i))}
            {container.items.length === 0 && <div className="sidebar-empty">{draggedItem ? 'Drop here' : 'Empty'}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar-scroll" ref={scrollRef}>
      <div className={`sidebar-section sidebar-docs-section ${collapsedSections.has('docs') ? 'docs-collapsed' : ''}`}>
        <div className="sidebar-section-header" data-section-key="docs" onClick={() => toggleSection('docs')}>
          <span className={`sidebar-chevron ${collapsedSections.has('docs') ? 'collapsed' : ''}`}>&#9662;</span>
          <span className="sidebar-label">Documents</span>
          <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); onCreateDocument(); }} title="New document">+</button>
        </div>
        {!collapsedSections.has('docs') && (
          <div className="sidebar-section-list" data-drop-ws="__docs__">
            {unassignedDocs.map((doc, i) => {
              const siblings: WorkspaceNode[] = unassignedDocs.map((d) => ({ type: 'doc' as const, file: d.filename, title: d.title }));
              return renderDocItem(doc, undefined, null, siblings, i);
            })}
            {unassignedDocs.length === 0 && <div className="sidebar-empty">{draggedItem ? 'Drop here to unassign' : 'No unassigned documents'}</div>}
          </div>
        )}
      </div>

      {workspaces.map((wsInfo) => {
        const wsRoot = wsInfo.workspace?.root || [];
        const isCollapsed = collapsedSections.has(wsInfo.filename);
        return (
          <div key={wsInfo.filename} className={`sidebar-section sidebar-workspace-section ${isCollapsed ? 'ws-collapsed' : ''} ${isDragging(wsInfo.filename) ? 'dragging' : ''} ${dropIndicator?.itemId === wsInfo.filename ? (dropIndicator.position === 'before' ? 'drop-before' : 'drop-after') : ''}`}>
            <div
              className="sidebar-section-header"
              data-section-key={wsInfo.filename}
              data-ws-drag={wsInfo.filename}
              onPointerDown={(e) => handlePointerDown(e, { type: 'workspace', filename: wsInfo.filename }, wsInfo.title)}
              onClick={() => !draggedItem && toggleSection(wsInfo.filename)}
            >
              <span className={`sidebar-chevron ${isCollapsed ? 'collapsed' : ''}`}>&#9662;</span>
              <span className="sidebar-label sidebar-workspace-label">{wsInfo.title}</span>
              <div className="sidebar-workspace-actions">
                <button className="sidebar-new-btn" onClick={(e) => { e.stopPropagation(); actions.handleCreateInWorkspace(wsInfo.filename, null); }} title="New document">+</button>
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
                {wsRoot.map((node, i) => renderNode(node, 0, wsInfo.filename, null, wsRoot, i))}
                {wsRoot.length === 0 && <div className="sidebar-empty">{draggedItem ? 'Drop here to add' : 'Empty workspace'}</div>}
              </div>
            )}
          </div>
        );
      })}

      <div className="sidebar-new-workspace">
        <button onClick={actions.handleCreateWorkspace}>+ New Workspace</button>
      </div>
    </div>
  );
}
