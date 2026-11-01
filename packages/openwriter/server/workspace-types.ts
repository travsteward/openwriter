/**
 * Workspace v2 type definitions and migration logic.
 * Unified container model: ordered/unordered containers hold docs, tags are cross-cutting.
 */

import { randomUUID } from 'crypto';

// ============================================================================
// V2 TYPES (current)
// ============================================================================

export interface DocItem {
  type: 'doc';
  file: string;
  title: string;
  children?: ContainerItem[];
}

export interface ContainerItem {
  type: 'container';
  id: string;
  name: string;
  items: WorkspaceNode[];
  /** When true, all docs inside this container (and any nested containers)
   *  have auto-accept active. Inherits down. */
  autoAccept?: boolean;
  /** Optional user-authored hint that tells the agent what kind of doc
   *  belongs here ("character beats", "research notes"). When absent, the
   *  agent infers theme from existing contents via crawl. */
  purpose?: string;
  // ---- Enrichment fields (agent-written, surfaced by crawl tools) ----
  // adr: see brief 2026-05-18-frontmatter-enrichment-system
  /** One-sentence "what this container holds" — the crawl signal. */
  logline?: string;
  /** Container role within the workspace: spine / chapters / vignettes / reference / scratch. Free-form for now. */
  role?: string;
}

export type WorkspaceNode = DocItem | ContainerItem;

export interface WorkspaceContext {
  characters?: Record<string, string>;
  settings?: Record<string, string>;
  rules?: string[];
}

/** guided: the agent runs the OpenWriter book method. custom: it follows the writer's own process. */
export type BookWorkflow = 'guided' | 'custom';

export interface Workspace {
  version: 2;
  title: string;
  /** Explicit user-selected behavior, separate from agent-written schema enrichment. */
  workspaceType?: 'general' | 'book';
  /** workflow: the writer's choice of how the agent works on the book; absent means guided. */
  book?: { outlineDocId?: string; manuscriptDocId?: string; briefDocId?: string; workflow?: BookWorkflow };
  voiceProfileId?: string | null;
  root: WorkspaceNode[];
  context?: WorkspaceContext;
  /** When true, every doc in this workspace has auto-accept active. */
  autoAccept?: boolean;
  /** Optional user-authored hint that tells the agent what kind of docs
   *  belong in this workspace. Mirrors container.purpose. */
  purpose?: string;
  // ---- Enrichment fields (agent-written, surfaced by crawl tools) ----
  // adr: see brief 2026-05-18-frontmatter-enrichment-system
  /** One-sentence "what this workspace is for". */
  logline?: string;
  /** Subject area (e.g. "Marine biology"). Single string. */
  domain?: string;
  /** Workspace kind: book / concept-library / inbox / social / reference. Free-form. */
  schema?: string;
  /** Declared vocabulary — valid domain names Haiku can classify docs INTO. */
  vocab?: string[];
  /** Pointers to sibling workspace filenames. */
  relatedWorkspaces?: string[];
  /** Volume-ratio threshold override (default 1.5). */
  enrichmentVolumeThreshold?: number;
  /** Jaccard-drift threshold override (default 0.3). */
  enrichmentDriftThreshold?: number;
  /** Opt out of enrichment for this workspace. When true, openwriter's
   *  staleness surfacing skips its docs, the minion ignores them, and
   *  crawl/list_dirty_docs filter them out. Default = false = enrichment on. */
  enrichmentDisabled?: boolean;
  /** Opt out of auto-sort for this workspace. When true, docs in this
   *  workspace marked for sort are excluded from list_pending_sorts, so the
   *  sort minion never auto-files them — the user handles them manually via
   *  the sidebar accept/reject flow instead. Default = false = auto-sort on. */
  autoSortDisabled?: boolean;
}

export interface WorkspaceInfo {
  filename: string;
  title: string;
  docCount: number;
}

// ============================================================================
// V1 TYPES (legacy)
// ============================================================================

interface LegacyWorkspaceItem {
  file: string;
  tag: string;
}

interface LegacyWorkspace {
  title: string;
  type?: string;
  voiceProfileId?: string | null;
  defaultTags?: string[];
  items: LegacyWorkspaceItem[];
  context?: WorkspaceContext;
}

// ============================================================================
// MIGRATION
// ============================================================================

export function isV1(data: any): boolean {
  return !data.version || data.version < 2;
}

export function migrateV1toV2(legacy: LegacyWorkspace): Workspace {
  const root: WorkspaceNode[] = [];

  for (const item of legacy.items || []) {
    root.push({ type: 'doc', file: item.file, title: item.file.replace(/\.md$/, '') });
  }

  return {
    version: 2,
    title: legacy.title,
    voiceProfileId: legacy.voiceProfileId ?? null,
    root,
    context: legacy.context,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

export function generateContainerId(): string {
  return randomUUID().slice(0, 8);
}
