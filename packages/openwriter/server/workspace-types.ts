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
}

export type WorkspaceNode = DocItem | ContainerItem;

export interface WorkspaceContext {
  characters?: Record<string, string>;
  settings?: Record<string, string>;
  rules?: string[];
}

export interface Workspace {
  version: 2;
  title: string;
  voiceProfileId?: string | null;
  root: WorkspaceNode[];
  tags: Record<string, string[]>;
  context?: WorkspaceContext;
}

export interface WorkspaceInfo {
  filename: string;
  title: string;
  docCount: number;
}

// ============================================================================
// V1 TYPES (legacy)
// ============================================================================

export interface LegacyWorkspaceItem {
  file: string;
  tag: string;
}

export interface LegacyWorkspace {
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
  const tags: Record<string, string[]> = {};
  const root: WorkspaceNode[] = [];

  for (const item of legacy.items || []) {
    root.push({ type: 'doc', file: item.file, title: item.file.replace(/\.md$/, '') });
    if (item.tag) {
      if (!tags[item.tag]) tags[item.tag] = [];
      if (!tags[item.tag].includes(item.file)) tags[item.tag].push(item.file);
    }
  }

  return {
    version: 2,
    title: legacy.title,
    voiceProfileId: legacy.voiceProfileId ?? null,
    root,
    tags,
    context: legacy.context,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

export function generateContainerId(): string {
  return randomUUID().slice(0, 8);
}
