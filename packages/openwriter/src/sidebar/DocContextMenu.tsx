/**
 * The right-click menu for a document row, with the dialogs its items open
 * (plugin focus prompt, schedule, post to blog, analytics). Shared by every
 * sidebar view that lists documents, so a doc offers the same actions
 * wherever it is shown. Stays mounted while closed: the dialogs outlive the
 * menu that opened them.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DocumentInfo, SidebarActions, WorkspaceWithData } from './sidebar-types';
import { isAutoAcceptInheritedForDoc } from './sidebar-utils';
import SidebarContextMenu from './SidebarContextMenu';
import type { SidebarMenuItem } from './SidebarContextMenu';
import { transformExceedsSizeCap } from './transform-guard';
import FocusInstructionsModal from './FocusInstructionsModal';
import SchedulePostModal from './SchedulePostModal';
import PostToBlogModal from './PostToBlogModal';
import { TAB_HEADER } from '../ws/client';
import NewsletterAnalyticsModal from '../newsletter/NewsletterAnalyticsModal';

export interface DocMenuTarget {
  x: number;
  y: number;
  filename: string;
  title: string;
  docId?: string;
  lastSent?: string;
  postedUrl?: string;
  isNewsletter?: boolean;
  contentType?: string;
  bulkCount?: number;
  sortRequest?: DocumentInfo['sortRequest'];
}

/** The menu target for a right-click on one doc's row. */
export function docMenuTarget(e: React.MouseEvent, doc: DocumentInfo): DocMenuTarget {
  return { x: e.clientX, y: e.clientY, filename: doc.filename, title: doc.title, docId: doc.docId, lastSent: doc.lastSent, postedUrl: doc.postedUrl, isNewsletter: doc.isNewsletter, contentType: doc.contentType, sortRequest: doc.sortRequest };
}

function postSort(endpoint: string, body: object, actions: SidebarActions): void {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(() => actions.fetchDocs()).catch(() => {});
}

export function requestSort(filenames: string[], actions: SidebarActions): void {
  if (filenames.length === 0) return;
  postSort('/api/documents/sort-request', { filenames }, actions);
}

function cancelSort(filename: string, actions: SidebarActions): void {
  postSort('/api/documents/sort-reject', { filename }, actions);
}

function acceptSortProposal(filename: string, actions: SidebarActions): void {
  postSort('/api/documents/sort-accept', { filename }, actions);
}

/** Plugin items for sidebar menus, and whether the publish plugin is on. */
export function useSidebarPlugins(): { pluginItems: SidebarMenuItem[]; hasPublishPlugin: boolean } {
  const [pluginItems, setPluginItems] = useState<SidebarMenuItem[]>([]);
  // Schedule Post is wired to /api/scheduler/* (platform publish plugin). Hide
  // the menu item entirely when @openwriter/plugin-publish is disabled — the
  // endpoints will 4xx and the user has no way to know why otherwise.
  const [hasPublishPlugin, setHasPublishPlugin] = useState(false);
  useEffect(() => {
    const load = () => {
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
          setPluginItems(items);
          setHasPublishPlugin(publishOn);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener('ow-plugins-changed', load);
    return () => window.removeEventListener('ow-plugins-changed', load);
  }, []);
  return { pluginItems, hasPublishPlugin };
}

interface DocContextMenuProps {
  menu: DocMenuTarget | null;
  onClose: () => void;
  docs: DocumentInfo[];
  workspaces: WorkspaceWithData[];
  actions: SidebarActions;
  onSwitchDocument: (filename: string) => void;
  pluginItems: SidebarMenuItem[];
  hasPublishPlugin: boolean;
  onRename: (filename: string, title: string) => void;
  onBulkDelete?: () => void;
  onBulkRequestSort?: () => void;
}

export default function DocContextMenu({ menu, onClose, docs, workspaces, actions, onSwitchDocument, pluginItems, hasPublishPlugin, onRename, onBulkDelete, onBulkRequestSort }: DocContextMenuProps) {
  const [focusModal, setFocusModal] = useState<{ action: string; label: string; filename: string; title: string } | null>(null);
  const [scheduleModal, setScheduleModal] = useState<{ filename: string; title: string } | null>(null);
  const [postBlogModal, setPostBlogModal] = useState<{ filename: string; title: string; isActive: boolean } | null>(null);
  const [analyticsModal, setAnalyticsModal] = useState<{ docId: string; title: string } | null>(null);
  const activeDoc = docs.find(d => d.isActive);

  const handlePluginAction = useCallback((action: string, item: SidebarMenuItem, filename: string, title: string, instructions?: string) => {
    // Block oversized docs before any model/publish call (mirrors the AV guard).
    if (transformExceedsSizeCap(item, docs.find((d) => d.filename === filename))) return;
    if (item.promptForFocus && instructions === undefined) {
      setFocusModal({ action, label: item.label, filename, title });
      return;
    }
    fetch('/api/plugins/sidebar-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, filename, title, instructions: instructions || '', label: item.label }) }).catch(() => {});
  }, [docs]);

  return (
    <>
      {menu && (
        <SidebarContextMenu
          x={menu.x}
          y={menu.y}
          filename={menu.filename}
          title={menu.title}
          bulkCount={menu.bulkCount}
          onBulkDelete={onBulkDelete}
          onBulkRequestSort={menu.bulkCount ? onBulkRequestSort : undefined}
          onClose={onClose}
          onDuplicate={() => {
            fetch('/api/documents/duplicate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...TAB_HEADER }, body: JSON.stringify({ filename: menu.filename }) }).catch(() => {});
          }}
          onCreateVariant={menu.docId ? (vt) => {
            // Retyped derivative nested under the master. Server field-projects
            // the master onto the target type — NOT a content clone. adr: docs/variants.md
            fetch('/api/documents/variant', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...TAB_HEADER },
              body: JSON.stringify({ filename: menu.filename, masterDocId: menu.docId, variantType: vt }),
            }).catch(() => {});
          } : undefined}
          onRename={() => {
            onRename(menu.filename, menu.title);
            onClose();
          }}
          onArchive={() => actions.handleArchive(menu.filename)}
          onDelete={() => actions.handleDelete(menu.filename)}
          onPluginAction={(action, item) => handlePluginAction(action, item, menu.filename, menu.title)}
          pluginItems={pluginItems}
          onSchedulePost={hasPublishPlugin ? () => {
            setScheduleModal({ filename: menu.filename, title: menu.title });
            onClose();
          } : undefined}
          onPostNow={menu.contentType === 'blog' ? () => {
            const isActive = activeDoc?.filename === menu.filename;
            setPostBlogModal({ filename: menu.filename, title: menu.title, isActive });
            onClose();
          } : undefined}
          isAlreadyPublished={menu.contentType === 'blog' && !!menu.postedUrl}
          onViewAnalytics={menu.docId && menu.lastSent && (menu.postedUrl || menu.isNewsletter) ? () => {
            if (menu.isNewsletter) setAnalyticsModal({ docId: menu.docId!, title: menu.title });
            else if (menu.postedUrl) window.open(menu.postedUrl, '_blank');
            onClose();
          } : undefined}
          viewAnalyticsLabel={menu.isNewsletter ? 'View Analytics' : menu.contentType === 'blog' && menu.postedUrl ? 'View Post' : menu.postedUrl ? 'View on X' : 'View Analytics'}
          isApproved={actions.getDocTags(menu.filename).includes('✓')}
          onToggleApprove={() => {
            const tags = actions.getDocTags(menu.filename);
            if (tags.includes('✓')) actions.handleRemoveTag(menu.filename, '✓');
            else {
              actions.handleAddTag(menu.filename, '✓');
              setTimeout(() => window.dispatchEvent(new CustomEvent('ow-accept-all')), 50);
            }
          }}
          isAutoAccept={(() => {
            const own = docs.find(d => d.filename === menu.filename)?.autoAccept;
            if (own === true) return true;
            if (own === false) return false;
            return isAutoAcceptInheritedForDoc(workspaces, menu.filename);
          })()}
          onToggleAutoAccept={() => {
            const own = docs.find(d => d.filename === menu.filename)?.autoAccept;
            const effective = own === true
              ? true
              : own === false
                ? false
                : isAutoAcceptInheritedForDoc(workspaces, menu.filename);
            fetch('/api/auto-accept', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: menu.filename, enabled: !effective }),
            }).then(() => actions.fetchDocs()).catch(() => {});
          }}
          isAlreadySent={!!menu.lastSent}
          onMarkSent={() => {
            const fn = menu.filename;
            if (actions.getDocTags(fn).includes('✓')) actions.handleRemoveTag(fn, '✓');
            onSwitchDocument(fn);
            setTimeout(() => {
              fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manualPost: { postedAt: new Date().toISOString() } }) })
                .then(() => actions.fetchDocs()).catch(() => {});
            }, 100);
            onClose();
          }}
          sortState={
            menu.bulkCount
              ? undefined
              : menu.sortRequest?.proposal
                ? 'proposal'
                : menu.sortRequest
                  ? 'pending'
                  : 'none'
          }
          sortProposalLabel={(() => {
            const p = menu.sortRequest?.proposal;
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
          sortProposalReasoning={menu.sortRequest?.proposal?.reasoning}
          onRequestSort={menu.bulkCount ? undefined : () => requestSort([menu.filename], actions)}
          onCancelSort={() => cancelSort(menu.filename, actions)}
          onAcceptSortProposal={() => acceptSortProposal(menu.filename, actions)}
          onRejectSortProposal={() => cancelSort(menu.filename, actions)}
        />
      )}
      {focusModal && (
        <FocusInstructionsModal
          actionLabel={focusModal.label}
          docTitle={focusModal.title}
          onClose={() => setFocusModal(null)}
          onConfirm={instructions => {
            const item = pluginItems.find(i => i.action === focusModal.action);
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
    </>
  );
}
