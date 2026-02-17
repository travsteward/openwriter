import type { PendingDocsPayload } from '../ws/client';

export interface DocumentInfo {
  filename: string;
  title: string;
  lastModified: string;
  wordCount: number;
  isActive: boolean;
}

// V2 types matching server workspace-types.ts
export interface DocItem { type: 'doc'; file: string; title: string; children?: ContainerItem[] }
export interface ContainerItem { type: 'container'; id: string; name: string; items: WorkspaceNode[] }
export type WorkspaceNode = DocItem | ContainerItem;

export interface WorkspaceInfo { filename: string; title: string; docCount: number }
export interface WorkspaceFull {
  version: 2;
  title: string;
  root: WorkspaceNode[];
  tags: Record<string, string[]>;
  context?: any;
}

export type WorkspaceWithData = WorkspaceInfo & { workspace?: WorkspaceFull };

export type DraggedItem =
  | { type: 'doc'; file: string; sourceWs: string | null }
  | { type: 'container'; id: string; sourceWs: string }
  | { type: 'workspace'; filename: string }
  | null;

export interface DropIndicator {
  itemId: string;
  position: 'before' | 'after' | 'inside';
  wsFilename: string | null;
  containerId: string | null;
  afterId: string | null;
}

export interface SidebarModeProps {
  docs: DocumentInfo[];
  workspaces: WorkspaceWithData[];
  assignedFiles: Set<string>;
  pendingDocs: PendingDocsPayload;
  onSwitchDocument: (filename: string) => void;
  onCreateDocument: () => void;
  actions: SidebarActions;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export interface SidebarActions {
  fetchDocs: () => void;
  handleDelete: (filename: string) => void;
  handleRename: (filename: string, originalTitle: string, newTitle: string) => void;
  handleCreateWorkspace: () => void;
  handleDeleteWorkspace: (wsFilename: string) => void;
  handleCreateInWorkspace: (wsFilename: string, containerId: string | null) => void;
  handleRemoveFromWorkspace: (wsFilename: string, docFilename: string) => void;
  handleCreateContainer: (wsFilename: string, parentContainerId: string | null) => void;
  handleDeleteContainer: (wsFilename: string, containerId: string) => void;
  handleRenameContainer: (wsFilename: string, containerId: string, newName: string) => void;
  getDocTags: (wsFilename: string, docFile: string) => string[];
  handleAddTag: (wsFilename: string, docFile: string, tag: string) => void;
  handleRemoveTag: (wsFilename: string, docFile: string, tag: string) => void;
}
