/**
 * Tab registry types. One entry per right-rail tab.
 * adr: adr/right-rail.md
 */
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { PendingDocsPayload } from '../ws/client';

/** Tab id — narrow string union so the registry can be exhaustively typed. */
export type TabId =
  | 'review'
  | 'versions'
  | 'backlinks'
  | 'exports'
  | 'activity'
  | 'plugins'
  | 'connections'
  | 'appearance';

/**
 * Scope determines which app state a tab reads from. The rail container does
 * NOT remount tab bodies on doc switch — doc-scoped tabs receive the new
 * filename/docId via props and decide whether to refetch.
 */
export type TabScope = 'doc' | 'workspace' | 'settings';

/** Props the rail container passes to every tab body. Each tab uses what it needs. */
export interface RightRailTabProps {
  editors: Editor[];
  pendingDocs: PendingDocsPayload;
  currentFilename: string;
  docId: string | null;
  /** Agent-staged title rename for the active doc, or null if none staged.
   *  Owned by App so the value is consistent across surfaces (article title,
   *  Review panel). adr: adr/pending-overlay-model.md */
  pendingTitle?: { from: string; to: string } | null;
  onSwitchDocument: (filename: string) => void;
  sendMessage: (msg: Record<string, any>) => void;
  getDocument: () => any;
  docVersionRef: React.RefObject<number>;
  /** A manuscript's paragraph style for downloads ('spaced' | 'indented'), from manuscriptContext. */
  manuscriptStyle?: string;
}

export interface TabDefinition {
  id: TabId;
  label: string;
  scope: TabScope;
  /** 16x16 inline SVG rendered in the tab strip. Tooltip uses `label`. */
  icon: ReactNode;
  /** The tab body. Receives the full prop bag; uses what it needs. */
  Component: (props: RightRailTabProps) => JSX.Element | null;
}
