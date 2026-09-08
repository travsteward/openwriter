import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isExternal } from './sidebar-utils';

export interface SidebarMenuItem {
  label: string;
  action: string;
  promptForFocus?: boolean;
  pluginDisplayName?: string;
  /** Also offered on workspace/container right-click — applied to every doc in the folder. */
  folderCapable?: boolean;
}

/** Variant formats offered in the "Create variant" submenu. Mirrors the
 *  content types in CreateDocDropdown, minus reply/quote (those need a tweet URL
 *  and aren't meaningful as derivatives). See docs/variants.md. */
const VARIANT_TYPES: { key: string; label: string }[] = [
  { key: 'revision', label: 'Revision' },
  { key: 'document', label: 'Document' },
  { key: 'tweet', label: 'Tweet' },
  { key: 'article', label: 'Article' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'newsletter', label: 'Newsletter' },
  { key: 'blog', label: 'Blog' },
];

/** "Create variant ▸" flyout. Anchored to the trigger button's own on-screen
 *  rect (NOT offsetTop — once the flyout is position:fixed, offsetTop is measured
 *  against the viewport, so the old `offsetTop + parentRect.top` double-counted
 *  and the flyout drifted ~one-menu-height below its row). Flips left / clamps
 *  vertically to stay on-screen. Same approach as PluginSubmenu below. */
function VariantSubmenu({ onPick }: {
  onPick: (variantType: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const subRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !subRef.current || !triggerRef.current) return;
    const trigRect = triggerRef.current.getBoundingClientRect();
    const subRect = subRef.current.getBoundingClientRect();
    const pad = 8;
    let left = trigRect.right - 4;
    let top = trigRect.top - 4;
    if (left + subRect.width + pad > window.innerWidth) left = trigRect.left - subRect.width + 4;
    if (top + subRect.height + pad > window.innerHeight) top = window.innerHeight - subRect.height - pad;
    if (top < pad) top = pad;
    setStyle({ position: 'fixed', left, top });
  }, [open]);
  return (
    <span onMouseLeave={() => setOpen(false)}>
      <div className="context-menu-divider" />
      <button
        ref={triggerRef}
        className="context-menu-item context-menu-submenu-trigger"
        onMouseEnter={() => setOpen(true)}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Create variant</span>
        <span className="context-menu-submenu-arrow">&#9656;</span>
      </button>
      {open && (
        <div ref={subRef} className="context-menu context-menu-submenu" style={style}>
          {VARIANT_TYPES.map((t) => (
            <button key={t.key} className="context-menu-item" onClick={() => onPick(t.key)}>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

interface SidebarContextMenuProps {
  x: number;
  y: number;
  filename: string;
  title: string;
  onClose: () => void;
  onDuplicate: () => void;
  /** Create a "copy of master" variant of this doc, typed as variantType. Omitted when the doc has no docId to link to. */
  onCreateVariant?: (variantType: string) => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onPluginAction: (action: string, item: SidebarMenuItem) => void;
  pluginItems: SidebarMenuItem[];
  onSchedulePost?: () => void;
  onPostNow?: () => void;
  /** Blog already pushed once — flip the "Post to Blog Now" label to "Republish to Blog". */
  isAlreadyPublished?: boolean;
  onViewAnalytics?: () => void;
  viewAnalyticsLabel?: string;
  onMarkSent?: () => void;
  isAlreadySent?: boolean;
  isApproved?: boolean;
  onToggleApprove?: () => void;
  isAutoAccept?: boolean;
  onToggleAutoAccept?: () => void;
  // Sort-request actions on a single doc.
  // sortState describes what the doc looks like right now — "none" = no marker;
  // "pending" = marker set, no proposal yet; "proposal" = marker set + proposal
  // written. The menu renders different UI per state.
  sortState?: 'none' | 'pending' | 'proposal';
  sortProposalLabel?: string;
  sortProposalReasoning?: string;
  onRequestSort?: () => void;
  onCancelSort?: () => void;
  onAcceptSortProposal?: () => void;
  onRejectSortProposal?: () => void;
  // Folder mode (workspace/container) — shows folder-specific actions instead of doc actions
  folderMode?: boolean;
  onNewDoc?: (e: React.MouseEvent) => void;
  onNewContainer?: () => void;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  folderAutoAccept?: boolean;
  onToggleFolderAutoAccept?: () => void;
  folderAutoAcceptLabel?: string;
  // Folder-mode sort affordance — tag every doc in the folder for sorting.
  onRequestSortAll?: () => void;
  // Folder delete — when docCount > 0, user is offered "delete folder only" or "delete folder + docs"
  folderDocCount?: number;
  onDeleteWithDocs?: () => void;
  // Bulk mode (multi-selection) — shows bulk actions only
  bulkCount?: number;
  onBulkDelete?: () => void;
  onBulkRequestSort?: () => void;
}

/** Group plugin items: plugins with 3+ items get a submenu, others stay flat */
function PluginSubmenu({ items, onAction }: {
  items: SidebarMenuItem[];
  onAction: (item: SidebarMenuItem) => void;
}) {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  // Trigger buttons keyed by plugin name, so the flyout anchors to whichever
  // group is open. Same offsetTop→getBoundingClientRect fix as VariantSubmenu.
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Group items by plugin display name
  const groups = useMemo(() => {
    const map = new Map<string, SidebarMenuItem[]>();
    for (const item of items) {
      const key = item.pluginDisplayName || '_ungrouped';
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    }
    return map;
  }, [items]);

  // Position submenu to the right (or left if no room), aligned to its trigger row.
  const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    const trigger = openSubmenu ? triggerRefs.current[openSubmenu] : null;
    if (!openSubmenu || !submenuRef.current || !trigger) return;
    const trigRect = trigger.getBoundingClientRect();
    const subRect = submenuRef.current.getBoundingClientRect();
    const pad = 8;
    let left = trigRect.right - 4;
    let top = trigRect.top - 4;
    if (left + subRect.width + pad > window.innerWidth) left = trigRect.left - subRect.width + 4;
    if (top + subRect.height + pad > window.innerHeight) top = window.innerHeight - subRect.height - pad;
    if (top < pad) top = pad;
    setSubmenuStyle({ position: 'fixed', left, top });
  }, [openSubmenu]);

  const result: JSX.Element[] = [];
  for (const [pluginName, groupItems] of groups) {
    // 3+ items from same plugin → submenu
    if (pluginName !== '_ungrouped' && groupItems.length >= 3) {
      result.push(
        <span key={`sub-${pluginName}`}>
          <div className="context-menu-divider" />
          <button
            ref={(el) => { triggerRefs.current[pluginName] = el; }}
            className="context-menu-item context-menu-submenu-trigger"
            onMouseEnter={() => setOpenSubmenu(pluginName)}
            onClick={() => setOpenSubmenu(openSubmenu === pluginName ? null : pluginName)}
          >
            <span>Transform</span>
            <span className="context-menu-submenu-arrow">&#9656;</span>
          </button>
          {openSubmenu === pluginName && (
            <div
              ref={submenuRef}
              className="context-menu context-menu-submenu"
              style={submenuStyle}
              onMouseLeave={() => setOpenSubmenu(null)}
            >
              {groupItems.map((item) => (
                <button key={item.action} className="context-menu-item" onClick={() => onAction(item)}>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      );
    } else {
      // Few items or ungrouped → render flat
      let isFirst = true;
      for (const item of groupItems) {
        const showHeader = isFirst && pluginName !== '_ungrouped';
        isFirst = false;
        result.push(
          <span key={item.action}>
            {showHeader && <div className="context-menu-divider" />}
            {showHeader && <div className="context-menu-section-header">{pluginName}</div>}
            <button className="context-menu-item" onClick={() => onAction(item)}>
              <span>{item.label}</span>
            </button>
          </span>
        );
      }
    }
  }
  return <>{result}</>;
}

export default function SidebarContextMenu({ x, y, filename, title, onClose, onDuplicate, onCreateVariant, onRename, onArchive, onDelete, onPluginAction, pluginItems, onSchedulePost, onPostNow, isAlreadyPublished, onViewAnalytics, viewAnalyticsLabel, onMarkSent, isAlreadySent, isApproved, onToggleApprove, isAutoAccept, onToggleAutoAccept, sortState, sortProposalLabel, sortProposalReasoning, onRequestSort, onCancelSort, onAcceptSortProposal, onRejectSortProposal, folderMode, onNewDoc, onNewContainer, onAcceptAll, onRejectAll, folderAutoAccept, onToggleFolderAutoAccept, folderAutoAcceptLabel, onRequestSortAll, folderDocCount, onDeleteWithDocs, bulkCount, onBulkDelete, onBulkRequestSort }: SidebarContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [adjustedPos, setAdjustedPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Adjust position to keep menu within viewport
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (y + rect.height + pad > window.innerHeight) top = y - rect.height;
    if (x + rect.width + pad > window.innerWidth) left = x - rect.width;
    if (top < pad) top = pad;
    if (left < pad) left = pad;
    setAdjustedPos({ left, top });
  }, [x, y]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handlePluginAction = useCallback((item: SidebarMenuItem) => {
    onPluginAction(item.action, item);
    onClose();
  }, [onPluginAction, onClose]);

  if (bulkCount && bulkCount > 1 && onBulkDelete) {
    return (
      <div ref={menuRef} className="context-menu" style={{ left: adjustedPos.left, top: adjustedPos.top }}>
        <div className="context-menu-section-header">{bulkCount} selected</div>
        {onBulkRequestSort && (
          <button className="context-menu-item" onClick={() => { onBulkRequestSort(); onClose(); }}>
            <span>Request sort ({bulkCount})</span>
          </button>
        )}
        {confirmDelete ? (
          <div className="context-menu-item sidebar-ctx-confirm" onClick={(e) => e.stopPropagation()}>
            <span>Delete {bulkCount}?</span>
            <button onClick={() => { onBulkDelete(); onClose(); }}>Yes</button>
            <button onClick={() => setConfirmDelete(false)}>No</button>
          </div>
        ) : (
          <button className="context-menu-item sidebar-ctx-delete" onClick={() => setConfirmDelete(true)}>
            <span>Delete ({bulkCount})</span>
          </button>
        )}
      </div>
    );
  }

  if (folderMode) {
    return (
      <div ref={menuRef} className="context-menu" style={{ left: adjustedPos.left, top: adjustedPos.top }}>
        <button className="context-menu-item" onClick={() => { onRename(); onClose(); }}>
          <span>Rename</span>
        </button>
        {onNewDoc && (
          <button className="context-menu-item" onClick={(e) => { onNewDoc(e); onClose(); }}>
            <span>New Document</span>
          </button>
        )}
        {onNewContainer && (
          <button className="context-menu-item" onClick={() => { onNewContainer(); onClose(); }}>
            <span>New Container</span>
          </button>
        )}
        {(onAcceptAll || onRejectAll) && <div className="context-menu-divider" />}
        {onAcceptAll && (
          <button className="context-menu-item" onClick={() => { onAcceptAll(); onClose(); }}>
            <span>Accept All Changes</span>
          </button>
        )}
        {onRejectAll && (
          <button className="context-menu-item" onClick={() => { onRejectAll(); onClose(); }}>
            <span>Reject All Changes</span>
          </button>
        )}
        {onToggleFolderAutoAccept && (
          <>
            <div className="context-menu-divider" />
            <button className="context-menu-item" onClick={() => { onToggleFolderAutoAccept(); onClose(); }}>
              <span>{folderAutoAccept ? `Turn off auto-accept${folderAutoAcceptLabel ? ' ' + folderAutoAcceptLabel : ''}` : `Turn on auto-accept${folderAutoAcceptLabel ? ' ' + folderAutoAcceptLabel : ''}`}</span>
            </button>
          </>
        )}
        {onRequestSortAll && (
          <>
            <div className="context-menu-divider" />
            <button className="context-menu-item" onClick={() => { onRequestSortAll(); onClose(); }}>
              <span>Request sort all</span>
            </button>
          </>
        )}
        {pluginItems.length > 0 && <PluginSubmenu items={pluginItems} onAction={handlePluginAction} />}
        <div className="context-menu-divider" />
        {confirmDelete ? (
          folderDocCount && folderDocCount > 0 && onDeleteWithDocs ? (
            <div className="sidebar-ctx-folder-delete" onClick={(e) => e.stopPropagation()}>
              <div className="sidebar-ctx-folder-delete-prompt">Delete this folder?</div>
              <button className="context-menu-item sidebar-ctx-delete-option" onClick={() => { onDelete(); onClose(); }}>
                <span>Folder only</span>
                <span className="sidebar-ctx-delete-hint">{folderDocCount} doc{folderDocCount === 1 ? '' : 's'} → Documents</span>
              </button>
              <button className="context-menu-item sidebar-ctx-delete-option sidebar-ctx-delete" onClick={() => { onDeleteWithDocs(); onClose(); }}>
                <span>Folder + {folderDocCount} doc{folderDocCount === 1 ? '' : 's'}</span>
                <span className="sidebar-ctx-delete-hint">permanently deletes files</span>
              </button>
              <button className="context-menu-item sidebar-ctx-delete-cancel" onClick={() => setConfirmDelete(false)}>
                <span>Cancel</span>
              </button>
            </div>
          ) : (
            <div className="context-menu-item sidebar-ctx-confirm" onClick={(e) => e.stopPropagation()}>
              <span>Delete?</span>
              <button onClick={() => { onDelete(); onClose(); }}>Yes</button>
              <button onClick={() => setConfirmDelete(false)}>No</button>
            </div>
          )
        ) : (
          <button className="context-menu-item sidebar-ctx-delete" onClick={() => setConfirmDelete(true)}>
            <span>Delete</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: adjustedPos.left, top: adjustedPos.top }}
    >
      <button className="context-menu-item" onClick={() => { onDuplicate(); onClose(); }}>
        <span>Duplicate</span>
      </button>
      {onCreateVariant && (
        <VariantSubmenu onPick={(vt) => { onCreateVariant(vt); onClose(); }} />
      )}
      <button className="context-menu-item" onClick={() => { onRename(); onClose(); }}>
        <span>Rename</span>
      </button>
      {confirmArchive ? (
        <div className="context-menu-item sidebar-ctx-confirm" onClick={(e) => e.stopPropagation()}>
          <span>Archive?</span>
          <button onClick={() => { onArchive(); onClose(); }}>Yes</button>
          <button onClick={() => setConfirmArchive(false)}>No</button>
        </div>
      ) : (
        <button className="context-menu-item" onClick={() => { setConfirmDelete(false); setConfirmArchive(true); }}>
          <span>Archive</span>
        </button>
      )}
      {confirmDelete ? (
        <div className="context-menu-item sidebar-ctx-confirm" onClick={(e) => e.stopPropagation()}>
          <span>{isExternal(filename) ? 'Remove?' : 'Delete?'}</span>
          <button onClick={() => { onDelete(); onClose(); }}>Yes</button>
          <button onClick={() => setConfirmDelete(false)}>No</button>
        </div>
      ) : (
        <button className="context-menu-item sidebar-ctx-delete" onClick={() => { setConfirmArchive(false); setConfirmDelete(true); }}>
          <span>{isExternal(filename) ? 'Remove' : 'Delete'}</span>
        </button>
      )}
      {onToggleApprove && (
        <>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => { onToggleApprove(); onClose(); }}>
            <span>{isApproved ? 'Remove Approval' : 'Approve'}</span>
          </button>
        </>
      )}
      {onToggleAutoAccept && (
        <>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => { onToggleAutoAccept(); onClose(); }}>
            <span>{isAutoAccept ? 'Turn off auto-accept' : 'Turn on auto-accept'}</span>
          </button>
        </>
      )}
      {sortState === 'proposal' && onAcceptSortProposal && onRejectSortProposal && (
        <>
          <div className="context-menu-divider" />
          <div className="sidebar-ctx-sort-proposal" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-ctx-sort-proposal-label">Sort to {sortProposalLabel}</div>
            {sortProposalReasoning && <div className="sidebar-ctx-sort-proposal-reason">{sortProposalReasoning}</div>}
            <div className="sidebar-ctx-sort-proposal-actions">
              <button onClick={() => { onAcceptSortProposal(); onClose(); }}>Accept</button>
              <button onClick={() => { onRejectSortProposal(); onClose(); }}>Reject</button>
            </div>
          </div>
        </>
      )}
      {sortState === 'pending' && onCancelSort && (
        <>
          <div className="context-menu-divider" />
          <div className="sidebar-ctx-sort-pending" onClick={(e) => e.stopPropagation()}>
            <span className="sidebar-ctx-sort-pending-label">Sort requested</span>
            <button onClick={() => { onCancelSort(); onClose(); }}>Cancel</button>
          </div>
        </>
      )}
      {sortState === 'none' && onRequestSort && (
        <>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => { onRequestSort(); onClose(); }}>
            <span>Request sort</span>
          </button>
        </>
      )}
      {onSchedulePost && (
        <>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => { onSchedulePost(); onClose(); }}>
            <span>Schedule Post</span>
          </button>
        </>
      )}
      {onPostNow && (
        <button className="context-menu-item" onClick={() => { onPostNow(); onClose(); }}>
          <span>{isAlreadyPublished ? 'Republish to Blog' : 'Post to Blog Now'}</span>
        </button>
      )}
      {onMarkSent && !isAlreadySent && (
        <>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => { onMarkSent(); onClose(); }}>
            <span>Mark as Sent</span>
          </button>
        </>
      )}
      {onViewAnalytics && (
        <>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => { onViewAnalytics(); onClose(); }}>
            <span>{viewAnalyticsLabel || 'View Analytics'}</span>
          </button>
        </>
      )}
      {pluginItems.length > 0 && <PluginSubmenu items={pluginItems} onAction={handlePluginAction} />}
    </div>
  );
}
