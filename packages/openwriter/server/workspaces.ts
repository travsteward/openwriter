/**
 * Workspace manifest CRUD for OpenWriter v2.
 * Unified container model: containers (ordered/unordered) hold docs, tags are cross-cutting.
 * Manifests live in ~/.openwriter/_workspaces/*.json.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import matter from 'gray-matter';
import { DATA_DIR, WORKSPACES_DIR, ensureWorkspacesDir, sanitizeFilename, resolveDocPath } from './helpers.js';

const ORDER_FILE = join(WORKSPACES_DIR, '_order.json');
import type { Workspace, WorkspaceInfo, WorkspaceContext, WorkspaceNode } from './workspace-types.js';
import { isV1, migrateV1toV2 } from './workspace-types.js';
import { addDocToContainer, addContainer as addContainerToTree, removeNode, moveNode, reorderNode, findContainer, collectAllFiles, countDocs, findDocNode } from './workspace-tree.js';
import { addTag, removeTag, removeFileFromAllTags, listTagsForFile } from './workspace-tags.js';

// ============================================================================
// RE-EXPORTS for external consumers
// ============================================================================

export type { Workspace, WorkspaceInfo, WorkspaceContext, WorkspaceNode };

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function workspacePath(filename: string): string {
  return join(WORKSPACES_DIR, filename);
}

function readWorkspace(filename: string): Workspace {
  const raw = readFileSync(workspacePath(filename), 'utf-8');
  const parsed = JSON.parse(raw);

  if (isV1(parsed)) {
    const migrated = migrateV1toV2(parsed);
    writeWorkspace(filename, migrated);
    return migrated;
  }

  return parsed as Workspace;
}

function writeWorkspace(filename: string, workspace: Workspace): void {
  writeFileSync(workspacePath(filename), JSON.stringify(workspace, null, 2), 'utf-8');
}

function readOrder(): string[] {
  try {
    if (!existsSync(ORDER_FILE)) return [];
    return JSON.parse(readFileSync(ORDER_FILE, 'utf-8'));
  } catch { return []; }
}

function writeOrder(order: string[]): void {
  writeFileSync(ORDER_FILE, JSON.stringify(order, null, 2), 'utf-8');
}

function readDocFrontmatter(filename: string): Record<string, any> | null {
  try {
    const filePath = resolveDocPath(filename);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8');
    const { data } = matter(raw);
    return data;
  } catch {
    return null;
  }
}

// ============================================================================
// CRUD
// ============================================================================

export function listWorkspaces(): WorkspaceInfo[] {
  ensureWorkspacesDir();
  const files = readdirSync(WORKSPACES_DIR).filter((f) => f.endsWith('.json') && f !== '_order.json');
  const infos = files.map((f) => {
    try {
      const ws = readWorkspace(f);
      return { filename: f, title: ws.title, docCount: countDocs(ws.root) };
    } catch {
      return null;
    }
  }).filter((b): b is WorkspaceInfo => b !== null);

  // Sort by persisted order; unknown workspaces append at end
  const order = readOrder();
  if (order.length === 0) return infos;
  const orderIndex = new Map(order.map((f, i) => [f, i]));
  infos.sort((a, b) => {
    const ai = orderIndex.get(a.filename) ?? Infinity;
    const bi = orderIndex.get(b.filename) ?? Infinity;
    return ai - bi;
  });
  return infos;
}

export function getWorkspace(filename: string): Workspace {
  ensureWorkspacesDir();
  const p = workspacePath(filename);
  if (!existsSync(p)) throw new Error(`Workspace not found: ${filename}`);
  return readWorkspace(filename);
}

export function createWorkspace(options: { title: string; voiceProfileId?: string | null }): WorkspaceInfo {
  ensureWorkspacesDir();
  const { title, voiceProfileId = null } = options;
  const slug = sanitizeFilename(title).toLowerCase().replace(/\s+/g, '-');
  const filename = `${slug}-${randomUUID().slice(0, 8)}.json`;
  const workspace: Workspace = { version: 2, title, voiceProfileId, root: [], tags: {} };
  writeWorkspace(filename, workspace);
  // Append to order
  const order = readOrder();
  order.push(filename);
  writeOrder(order);
  return { filename, title, docCount: 0 };
}

export function deleteWorkspace(filename: string): void {
  ensureWorkspacesDir();
  const p = workspacePath(filename);
  if (!existsSync(p)) throw new Error(`Workspace not found: ${filename}`);
  unlinkSync(p);
  // Remove from order
  const order = readOrder();
  const idx = order.indexOf(filename);
  if (idx >= 0) { order.splice(idx, 1); writeOrder(order); }
}

export function reorderWorkspaces(orderedFilenames: string[]): void {
  ensureWorkspacesDir();
  writeOrder(orderedFilenames);
}

// ============================================================================
// DOC OPERATIONS
// ============================================================================

export function addDoc(wsFile: string, containerId: string | null, file: string, title: string, afterFile?: string | null): Workspace {
  const ws = getWorkspace(wsFile);
  addDocToContainer(ws.root, containerId, file, title, afterFile);
  writeWorkspace(wsFile, ws);
  return ws;
}

export function removeDoc(wsFile: string, file: string): Workspace {
  const ws = getWorkspace(wsFile);
  removeNode(ws.root, file);
  removeFileFromAllTags(ws.tags, file);
  writeWorkspace(wsFile, ws);
  return ws;
}

export function moveDoc(wsFile: string, file: string, targetContainerId: string | null, afterFile: string | null): Workspace {
  const ws = getWorkspace(wsFile);
  moveNode(ws.root, file, targetContainerId, afterFile);
  writeWorkspace(wsFile, ws);
  return ws;
}

export function reorderDoc(wsFile: string, file: string, afterFile: string | null): Workspace {
  const ws = getWorkspace(wsFile);
  reorderNode(ws.root, file, afterFile);
  writeWorkspace(wsFile, ws);
  return ws;
}

// ============================================================================
// CONTAINER OPERATIONS
// ============================================================================

export function addContainerToWorkspace(wsFile: string, parentContainerId: string | null, name: string): { workspace: Workspace; containerId: string } {
  const ws = getWorkspace(wsFile);
  const container = addContainerToTree(ws.root, parentContainerId, name);
  writeWorkspace(wsFile, ws);
  return { workspace: ws, containerId: container.id };
}

export function removeContainer(wsFile: string, containerId: string): Workspace {
  const ws = getWorkspace(wsFile);
  const found = findContainer(ws.root, containerId);
  if (!found) throw new Error(`Container "${containerId}" not found`);
  // Collect files in container to clean up tags
  const files = collectAllFiles((found.node as any).items || []);
  removeNode(ws.root, containerId);
  for (const file of files) removeFileFromAllTags(ws.tags, file);
  writeWorkspace(wsFile, ws);
  return ws;
}

export function renameContainer(wsFile: string, containerId: string, name: string): Workspace {
  const ws = getWorkspace(wsFile);
  const found = findContainer(ws.root, containerId);
  if (!found) throw new Error(`Container "${containerId}" not found`);
  (found.node as any).name = name;
  writeWorkspace(wsFile, ws);
  return ws;
}

export function reorderContainer(wsFile: string, containerId: string, afterIdentifier: string | null): Workspace {
  const ws = getWorkspace(wsFile);
  reorderNode(ws.root, containerId, afterIdentifier);
  writeWorkspace(wsFile, ws);
  return ws;
}

// ============================================================================
// TAG OPERATIONS
// ============================================================================

export function tagDoc(wsFile: string, file: string, tag: string): Workspace {
  const ws = getWorkspace(wsFile);
  if (!findDocNode(ws.root, file)) throw new Error(`Document "${file}" not in workspace`);
  addTag(ws.tags, tag, file);
  writeWorkspace(wsFile, ws);
  return ws;
}

export function untagDoc(wsFile: string, file: string, tag: string): Workspace {
  const ws = getWorkspace(wsFile);
  removeTag(ws.tags, tag, file);
  writeWorkspace(wsFile, ws);
  return ws;
}

export function getDocTags(wsFile: string, file: string): string[] {
  const ws = getWorkspace(wsFile);
  return listTagsForFile(ws.tags, file);
}

// ============================================================================
// CONTEXT
// ============================================================================

export function updateWorkspaceContext(wsFile: string, context: WorkspaceContext): Workspace {
  const ws = getWorkspace(wsFile);
  ws.context = { ...ws.context, ...context };
  writeWorkspace(wsFile, ws);
  return ws;
}

export function getItemContext(wsFile: string, docFile: string): object {
  const ws = getWorkspace(wsFile);
  const found = findDocNode(ws.root, docFile);
  if (!found) throw new Error(`Document "${docFile}" not found in workspace`);

  const tags = listTagsForFile(ws.tags, docFile);

  return {
    workspaceTitle: ws.title,
    workspaceContext: ws.context || {},
    tags,
  };
}

// ============================================================================
// CROSS-WORKSPACE QUERIES
// ============================================================================

export function getWorkspaceAssignedFiles(): Set<string> {
  const assigned = new Set<string>();
  const workspaces = listWorkspaces();
  for (const info of workspaces) {
    try {
      const ws = readWorkspace(info.filename);
      for (const file of collectAllFiles(ws.root)) assigned.add(file);
    } catch { /* skip corrupt manifests */ }
  }
  return assigned;
}

export function getWorkspaceStructure(filename: string): Workspace {
  return getWorkspace(filename);
}

/** Read the frontmatter title for a doc file. Falls back to filename without extension. */
export function getDocTitle(filename: string): string {
  const fm = readDocFrontmatter(filename);
  if (fm?.title && fm.title !== 'Untitled') return fm.title;
  return filename.replace(/\.md$/, '');
}
