/**
 * Workspace manifest CRUD for OpenWriter v2.
 * Unified container model: containers hold docs in an ordered tree.
 * Manifests live in ~/.openwriter/_workspaces/*.json.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join, resolve, isAbsolute, sep } from 'path';
import { randomUUID } from 'crypto';
import matter from 'gray-matter';
import trash from 'trash';
import { getDataDir, getWorkspacesDir, ensureWorkspacesDir, sanitizeFilename, resolveDocPath, isExternalDoc } from './helpers.js';
import { markdownToTiptap, tiptapToMarkdown } from './markdown.js';
import { resolveListingTitle } from './title-resolve.js';

function getOrderFile(): string { return join(getWorkspacesDir(), '_order.json'); }
import type { Workspace, WorkspaceInfo, WorkspaceContext, WorkspaceNode, DocItem, ContainerItem } from './workspace-types.js';
import { isV1, migrateV1toV2 } from './workspace-types.js';
import { addDocToContainer, addContainer as addContainerToTree, removeNode, moveNode, reorderNode, findContainer, collectAllFiles, countDocs, findDocNode } from './workspace-tree.js';

// ============================================================================
// RE-EXPORTS for external consumers
// ============================================================================

export type { Workspace, WorkspaceInfo, WorkspaceContext, WorkspaceNode };

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Resolve a workspace manifest filename to an absolute path that is GUARANTEED
 * to live inside the active profile's `_workspaces/` directory.
 *
 * The `filename` originates from MCP tool args (`wsFile`, `filename`), so it is
 * untrusted. Without this guard a value like `../../OtherProfile/_workspaces/x.json`
 * or an absolute path would escape the active profile and read/write/delete
 * another profile's manifests (and, via the doc files they reference, another
 * profile's documents). Profile scoping in OpenWriter is enforced by anchoring
 * every manifest path under `getWorkspacesDir()` (which encodes the active
 * profile) — so containment IS profile scoping. Escaping containment is the
 * only way to cross profiles, and this resolver makes that impossible.
 *
 * Rules: no separators, no `..`, not absolute, no null byte, must end in
 * `.json`, never the reserved `_order.json`. Then a `path.resolve` +
 * prefix-containment assert is the authoritative backstop.
 *
 * adr: (MCP-7 — workspace path traversal + profile scoping)
 */
function workspacePath(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid workspace identifier');
  }
  if (
    filename.includes('\0') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    isAbsolute(filename) ||
    !filename.endsWith('.json') ||
    filename === '_order.json'
  ) {
    throw new Error('Invalid workspace identifier');
  }
  const baseDir = resolve(getWorkspacesDir());
  const resolved = resolve(baseDir, filename);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) {
    throw new Error('Invalid workspace identifier');
  }
  return resolved;
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
    if (!existsSync(getOrderFile())) return [];
    return JSON.parse(readFileSync(getOrderFile(), 'utf-8'));
  } catch { return []; }
}

function writeOrder(order: string[]): void {
  writeFileSync(getOrderFile(), JSON.stringify(order, null, 2), 'utf-8');
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
  const files = readdirSync(getWorkspacesDir()).filter((f) => f.endsWith('.json') && f !== '_order.json');
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

export function addContainerToWorkspace(wsFile: string, parentContainerId: string | null, name: string, afterIdentifier?: string | null): { workspace: Workspace; containerId: string } {
  const ws = getWorkspace(wsFile);
  const container = addContainerToTree(ws.root, parentContainerId, name, afterIdentifier ?? null);
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

export function renameWorkspace(wsFile: string, newTitle: string): Workspace {
  const ws = getWorkspace(wsFile);
  ws.title = newTitle;
  writeWorkspace(wsFile, ws);
  return ws;
}

export function reorderContainer(wsFile: string, containerId: string, afterIdentifier: string | null): Workspace {
  const ws = getWorkspace(wsFile);
  reorderNode(ws.root, containerId, afterIdentifier);
  writeWorkspace(wsFile, ws);
  return ws;
}

export function moveContainer(wsFile: string, containerId: string, targetContainerId: string | null, afterIdentifier: string | null): Workspace {
  const ws = getWorkspace(wsFile);
  moveNode(ws.root, containerId, targetContainerId, afterIdentifier);
  writeWorkspace(wsFile, ws);
  return ws;
}

export function crossMoveContainer(
  sourceWsFile: string, targetWsFile: string, containerId: string,
  targetContainerId: string | null, afterIdentifier: string | null,
): Workspace {
  const sourceWs = getWorkspace(sourceWsFile);
  const removed = removeNode(sourceWs.root, containerId);
  if (removed.type !== 'container') throw new Error(`Node "${containerId}" is not a container`);
  writeWorkspace(sourceWsFile, sourceWs);

  const targetWs = getWorkspace(targetWsFile);
  // Insert into target — reuse moveNode-style logic
  const target = targetContainerId === null
    ? targetWs.root
    : (() => { const f = findContainer(targetWs.root, targetContainerId); if (!f) throw new Error('Target container not found'); return f.node.items; })();

  if (afterIdentifier === null) {
    target.unshift(removed);
  } else {
    const afterIdx = target.findIndex((n: WorkspaceNode) =>
      (n.type === 'doc' && n.file === afterIdentifier) || (n.type === 'container' && n.id === afterIdentifier),
    );
    if (afterIdx === -1) target.push(removed);
    else target.splice(afterIdx + 1, 0, removed);
  }
  writeWorkspace(targetWsFile, targetWs);
  return targetWs;
}

export function promoteContainerToWorkspace(
  sourceWsFile: string, containerId: string, afterWorkspaceFilename: string | null,
): WorkspaceInfo {
  const sourceWs = getWorkspace(sourceWsFile);
  const removed = removeNode(sourceWs.root, containerId);
  if (removed.type !== 'container') throw new Error(`Node "${containerId}" is not a container`);
  writeWorkspace(sourceWsFile, sourceWs);

  // Create new workspace with container's children as root
  const slug = sanitizeFilename(removed.name).toLowerCase().replace(/\s+/g, '-');
  const filename = `${slug}-${randomUUID().slice(0, 8)}.json`;
  const workspace: Workspace = { version: 2, title: removed.name, root: removed.items };
  writeWorkspace(filename, workspace);

  // Append to order then reposition
  const order = readOrder();
  order.push(filename);
  writeOrder(order);
  if (afterWorkspaceFilename !== null || order.length > 1) {
    reorderWorkspaceAfter(filename, afterWorkspaceFilename);
  }

  return { filename, title: removed.name, docCount: countDocs(removed.items) };
}

export function reorderWorkspaceAfter(filename: string, afterFilename: string | null): void {
  ensureWorkspacesDir();
  const order = readOrder();
  // Ensure all current workspace files are in the order array
  const files = readdirSync(getWorkspacesDir()).filter(f => f.endsWith('.json') && f !== '_order.json');
  for (const f of files) { if (!order.includes(f)) order.push(f); }
  // Remove target
  const idx = order.indexOf(filename);
  if (idx === -1) throw new Error(`Workspace "${filename}" not found in order`);
  order.splice(idx, 1);
  // Insert
  if (afterFilename === null) {
    order.unshift(filename);
  } else {
    const afterIdx = order.indexOf(afterFilename);
    if (afterIdx === -1) { order.push(filename); }
    else { order.splice(afterIdx + 1, 0, filename); }
  }
  writeOrder(order);
}

// ============================================================================
// CONTEXT
// ============================================================================

/**
 * Update a workspace's context fields. Accepts:
 *   - Writing context (characters, settings, rules) — merged into ws.context
 *   - Enrichment fields (logline, domain, schema, vocab, relatedWorkspaces,
 *     enrichmentVolumeThreshold, enrichmentDriftThreshold, enrichmentDisabled)
 *     — set on the workspace top-level. Pass `null` to clear a field.
 *
 * One tool, broader payload. Lets the agent configure enrichment + writing
 * context with a single call.
 *
 * See brief 2026-05-18-frontmatter-enrichment-system.
 */
export interface WorkspaceConfigUpdate extends WorkspaceContext {
  logline?: string | null;
  domain?: string | null;
  schema?: string | null;
  vocab?: string[] | null;
  relatedWorkspaces?: string[] | null;
  enrichmentVolumeThreshold?: number | null;
  enrichmentDriftThreshold?: number | null;
  enrichmentDisabled?: boolean | null;
  autoSortDisabled?: boolean | null;
}

const WRITING_CONTEXT_KEYS = new Set(['characters', 'settings', 'rules']);
// Workspace top-level config fields (enrichment + sort). Copied onto the
// workspace root by updateWorkspaceContext; `null` clears the field.
const WORKSPACE_CONFIG_FIELDS = new Set([
  'logline', 'domain', 'schema', 'vocab', 'relatedWorkspaces',
  'enrichmentVolumeThreshold', 'enrichmentDriftThreshold', 'enrichmentDisabled',
  'autoSortDisabled',
]);

export function updateWorkspaceContext(wsFile: string, update: WorkspaceConfigUpdate): Workspace {
  const ws = getWorkspace(wsFile);

  // Writing context (characters/settings/rules) merge into ws.context.
  const ctxUpdate: WorkspaceContext = {};
  for (const key of WRITING_CONTEXT_KEYS) {
    if (key in update) (ctxUpdate as any)[key] = (update as any)[key];
  }
  if (Object.keys(ctxUpdate).length > 0) {
    ws.context = { ...ws.context, ...ctxUpdate };
  }

  // Config fields (enrichment + sort) set on the workspace top-level. `null` clears.
  for (const key of WORKSPACE_CONFIG_FIELDS) {
    if (!(key in update)) continue;
    const value = (update as any)[key];
    if (value === null) {
      delete (ws as any)[key];
    } else {
      (ws as any)[key] = value;
    }
  }

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

/** Rename a document reference in every workspace that contains it. */
export function renameDocInAllWorkspaces(oldFile: string, newFile: string, newTitle: string): void {
  const workspaces = listWorkspaces();
  for (const info of workspaces) {
    try {
      const ws = readWorkspace(info.filename);
      const found = findDocNode(ws.root, oldFile);
      if (found) {
        (found.node as DocItem).file = newFile;
        (found.node as DocItem).title = newTitle;
        writeWorkspace(info.filename, ws);
      }
    } catch { /* skip corrupt manifests */ }
  }
}

/** Remove a document from every workspace that references it. */
export interface ArchivedPlacement {
  workspace: string;
  containerId: string | null;
  index: number;
  item: DocItem;
}

// Archive removes a doc from active trees but retains its recoverable position.
// adr: adr/archive-placement.md
export function captureArchivePlacements(file: string): ArchivedPlacement[] {
  return listWorkspaces().flatMap(info => {
    const ws = readWorkspace(info.filename);
    const found = findDocNode(ws.root, file);
    return found ? [{
      workspace: info.filename,
      containerId: Array.isArray(found.parent) ? null : found.parent.id,
      index: found.index,
      item: structuredClone(found.node),
    }] : [];
  });
}

export function restoreArchivePlacements(file: string, title: string, placements: ArchivedPlacement[]): boolean {
  const available = new Set(listWorkspaces().map(w => w.filename));
  let originalLocation = true;
  for (const placement of placements) {
    if (!available.has(placement.workspace)) { originalLocation = false; continue; }
    const ws = readWorkspace(placement.workspace);
    if (findDocNode(ws.root, file)) continue;
    const container = placement.containerId ? findContainer(ws.root, placement.containerId) : null;
    if (placement.containerId && !container) originalLocation = false;
    const items = container ? container.node.items : ws.root;
    items.splice(Math.max(0, Math.min(placement.index, items.length)), 0, { ...placement.item, file, title });
    writeWorkspace(placement.workspace, ws);
  }
  return originalLocation;
}

export function removeDocFromAllWorkspaces(file: string): void {
  const workspaces = listWorkspaces();
  for (const info of workspaces) {
    try {
      const ws = readWorkspace(info.filename);
      if (findDocNode(ws.root, file)) {
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

/** Return every workspace manifest filename that contains this doc. A doc may
 *  appear in multiple workspaces; callers that want one usually pick the first. */
export function findWorkspacesContainingDoc(file: string): WorkspaceInfo[] {
  const workspaces = listWorkspaces();
  const result: WorkspaceInfo[] = [];
  for (const info of workspaces) {
    try {
      const ws = readWorkspace(info.filename);
      if (collectAllFiles(ws.root).includes(file)) result.push(info);
    } catch { /* skip corrupt manifests */ }
  }
  return result;
}

/**
 * Walk every workspace and return true if `file` is inside one where auto-accept
 * is on at the workspace level or on any ancestor container. Returns false when
 * the doc isn't in any workspace or no ancestor has the flag set.
 *
 * A doc's own `autoAccept` frontmatter is NOT checked here — that's the caller's
 * job (combined with this lookup, OR-style).
 */
export function isAutoAcceptInheritedForDoc(file: string): boolean {
  const workspaces = listWorkspaces();
  for (const info of workspaces) {
    try {
      const ws = readWorkspace(info.filename);
      // Walk root to find the doc; collect ancestor containers along the way.
      function walk(nodes: WorkspaceNode[], ancestors: ContainerItem[]): boolean | null {
        for (const n of nodes) {
          if (n.type === 'doc' && n.file === file) {
            if (ws.autoAccept === true) return true;
            for (const c of ancestors) if (c.autoAccept === true) return true;
            return false; // doc lives here but no ancestor flag set
          }
          if (n.type === 'container') {
            const result = walk(n.items, [...ancestors, n]);
            if (result !== null) return result;
          }
        }
        return null;
      }
      const found = walk(ws.root, []);
      if (found === true) return true;
      // if found === false, doc IS in this workspace but no ancestor flag is on;
      // continue scanning other workspaces (a doc could be referenced in multiple)
    } catch { /* skip corrupt manifests */ }
  }
  return false;
}

/** Set or clear workspace-level autoAccept. */
export function setWorkspaceAutoAccept(wsFile: string, enabled: boolean): void {
  const ws = readWorkspace(wsFile);
  if (enabled) ws.autoAccept = true;
  else delete ws.autoAccept;
  writeWorkspace(wsFile, ws);
}

/** Set or clear container-level autoAccept. */
export function setContainerAutoAccept(wsFile: string, containerId: string, enabled: boolean): void {
  const ws = readWorkspace(wsFile);
  const found = findContainer(ws.root, containerId);
  if (!found) throw new Error(`Container ${containerId} not found in ${wsFile}`);
  if (enabled) found.node.autoAccept = true;
  else delete found.node.autoAccept;
  writeWorkspace(wsFile, ws);
}

/** Set or clear the user-authored `purpose:` hint on a workspace. Trim and
 *  treat empty string as clear, so a user can blank the field in the UI. */
export function setWorkspacePurpose(wsFile: string, purpose: string): void {
  const ws = readWorkspace(wsFile);
  const trimmed = purpose.trim();
  if (trimmed) ws.purpose = trimmed;
  else delete ws.purpose;
  writeWorkspace(wsFile, ws);
}

export function setContainerPurpose(wsFile: string, containerId: string, purpose: string): void {
  const ws = readWorkspace(wsFile);
  const found = findContainer(ws.root, containerId);
  if (!found) throw new Error(`Container ${containerId} not found in ${wsFile}`);
  const trimmed = purpose.trim();
  if (trimmed) found.node.purpose = trimmed;
  else delete found.node.purpose;
  writeWorkspace(wsFile, ws);
}

/** Collect every file inside a workspace or container subtree. Used for broadcast. */
export function collectFilesInWorkspace(wsFile: string): string[] {
  try {
    const ws = readWorkspace(wsFile);
    return collectAllFiles(ws.root);
  } catch { return []; }
}

export function collectFilesInContainer(wsFile: string, containerId: string): string[] {
  try {
    const ws = readWorkspace(wsFile);
    const found = findContainer(ws.root, containerId);
    if (!found) return [];
    return collectAllFiles(found.node.items);
  } catch { return []; }
}

export function getWorkspaceStructure(filename: string): Workspace {
  return getWorkspace(filename);
}

/** Read the title for a doc file: frontmatter → first h1 in body → filename stem. */
export function getDocTitle(filename: string): string {
  try {
    const filePath = resolveDocPath(filename);
    if (existsSync(filePath)) {
      const { data, content } = matter(readFileSync(filePath, 'utf-8'));
      return resolveListingTitle({ fmTitle: data.title, content, filename });
    }
  } catch { /* fall through to stem */ }
  return filename.replace(/\.md$/, '');
}
