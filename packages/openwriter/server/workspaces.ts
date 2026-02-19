/**
 * Workspace manifest CRUD for OpenWriter v2.
 * Unified container model: containers hold docs in an ordered tree.
 * Manifests live in ~/.openwriter/_workspaces/*.json.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import matter from 'gray-matter';
import trash from 'trash';
import { DATA_DIR, WORKSPACES_DIR, ensureWorkspacesDir, sanitizeFilename, resolveDocPath, isExternalDoc } from './helpers.js';
import { markdownToTiptap, tiptapToMarkdown } from './markdown.js';

const ORDER_FILE = join(WORKSPACES_DIR, '_order.json');
import type { Workspace, WorkspaceInfo, WorkspaceContext, WorkspaceNode } from './workspace-types.js';
import { isV1, migrateV1toV2 } from './workspace-types.js';
import { addDocToContainer, addContainer as addContainerToTree, removeNode, moveNode, reorderNode, findContainer, collectAllFiles, countDocs, findDocNode } from './workspace-tree.js';

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

/**
 * Migrate workspace-level tags into document frontmatter.
 * Old format: workspace.tags = { "tag1": ["file1.md", "file2.md"], ... }
 * New format: each doc file has `tags: ["tag1", ...]` in its frontmatter.
 * Returns true if migration occurred and the workspace was modified.
 */
function migrateWorkspaceTags(ws: any): boolean {
  if (!ws.tags || typeof ws.tags !== 'object') return false;
  const tagMap: Record<string, string[]> = ws.tags;
  const entries = Object.entries(tagMap);
  if (entries.length === 0) { delete ws.tags; return true; }

  for (const [tagName, files] of entries) {
    for (const file of files) {
      try {
        const targetPath = resolveDocPath(file);
        if (!existsSync(targetPath)) continue;
        const raw = readFileSync(targetPath, 'utf-8');
        const parsed = markdownToTiptap(raw);
        const tags: string[] = Array.isArray(parsed.metadata.tags) ? [...parsed.metadata.tags] : [];
        if (!tags.includes(tagName)) {
          tags.push(tagName);
          parsed.metadata.tags = tags;
          const markdown = tiptapToMarkdown(parsed.document, parsed.title, parsed.metadata);
          writeFileSync(targetPath, markdown, 'utf-8');
        }
      } catch { /* best-effort */ }
    }
  }

  delete ws.tags;
  return true;
}

function readWorkspace(filename: string): Workspace {
  const raw = readFileSync(workspacePath(filename), 'utf-8');
  let parsed = JSON.parse(raw);

  if (isV1(parsed)) {
    parsed = migrateV1toV2(parsed);
    writeWorkspace(filename, parsed);
    return parsed;
  }

  // Migrate workspace-level tags to doc frontmatter
  if (migrateWorkspaceTags(parsed)) {
    writeWorkspace(filename, parsed);
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
  const workspace: Workspace = { version: 2, title, voiceProfileId, root: [] };
  writeWorkspace(filename, workspace);
  // Append to order
  const order = readOrder();
  order.push(filename);
  writeOrder(order);
  return { filename, title, docCount: 0 };
}

export async function deleteWorkspace(filename: string): Promise<{ deletedFiles: string[]; skippedExternal: string[] }> {
  ensureWorkspacesDir();
  const p = workspacePath(filename);
  if (!existsSync(p)) throw new Error(`Workspace not found: ${filename}`);

  const ws = readWorkspace(filename);
  const files = collectAllFiles(ws.root);
  const deletedFiles: string[] = [];
  const skippedExternal: string[] = [];

  for (const file of files) {
    if (isExternalDoc(file)) {
      skippedExternal.push(file);
      continue;
    }
    const filePath = resolveDocPath(file);
    if (existsSync(filePath)) {
      await trash(filePath);
      deletedFiles.push(file);
    }
  }

  await trash(p);
  // Remove from order
  const order = readOrder();
  const idx = order.indexOf(filename);
  if (idx >= 0) { order.splice(idx, 1); writeOrder(order); }

  return { deletedFiles, skippedExternal };
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
  removeNode(ws.root, containerId);
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

  // Read tags from document frontmatter (not workspace manifest)
  const fm = readDocFrontmatter(docFile);
  const tags = Array.isArray(fm?.tags) ? fm.tags : [];

  return {
    workspaceTitle: ws.title,
    workspaceContext: ws.context || {},
    tags,
  };
}

// ============================================================================
// FIND-OR-CREATE HELPERS
// ============================================================================

/** Find an existing workspace by title (case-insensitive). Returns null if not found. */
export function findWorkspaceByTitle(title: string): WorkspaceInfo | null {
  const all = listWorkspaces();
  const lower = title.toLowerCase();
  return all.find((w) => w.title.toLowerCase() === lower) || null;
}

/** Find a container by name in a workspace. Returns its ID, or null if not found. */
export function findContainerByName(wsFile: string, name: string): string | null {
  const ws = getWorkspace(wsFile);
  const lower = name.toLowerCase();
  function scan(nodes: WorkspaceNode[]): string | null {
    for (const n of nodes) {
      if (n.type === 'container') {
        if (n.name.toLowerCase() === lower) return n.id;
        const found = scan(n.items);
        if (found) return found;
      }
    }
    return null;
  }
  return scan(ws.root);
}

/** Find workspace by title or create it. Returns workspace filename. */
export function findOrCreateWorkspace(title: string): { filename: string; created: boolean } {
  const existing = findWorkspaceByTitle(title);
  if (existing) return { filename: existing.filename, created: false };
  const info = createWorkspace({ title });
  return { filename: info.filename, created: true };
}

/** Find container by name in workspace, or create it. Returns container ID. */
export function findOrCreateContainer(wsFile: string, name: string): { containerId: string; created: boolean } {
  const existing = findContainerByName(wsFile, name);
  if (existing) return { containerId: existing, created: false };
  const result = addContainerToWorkspace(wsFile, null, name);
  return { containerId: result.containerId, created: true };
}

// ============================================================================
// CROSS-WORKSPACE QUERIES
// ============================================================================

/** Remove a document from every workspace that references it. */
export function removeDocFromAllWorkspaces(file: string): void {
  const workspaces = listWorkspaces();
  for (const info of workspaces) {
    try {
      const ws = readWorkspace(info.filename);
      if (collectAllFiles(ws.root).includes(file)) {
        removeDoc(info.filename, file);
      }
    } catch { /* skip corrupt manifests */ }
  }
}

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
