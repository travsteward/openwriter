/**
 * File-backed document state for OpenWriter.
 * Each document is a .md file in ~/.openwriter/ with YAML frontmatter.
 * Title lives in frontmatter metadata. Filenames are stable identifiers.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, type Stats } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { tiptapToMarkdown, markdownToTiptap } from './markdown.js';
import { applyTextEditsToNode, type TextEdit } from './text-edit.js';
import { DATA_DIR, TEMP_PREFIX, ensureDataDir, filePathForTitle, tempFilePath, generateNodeId, LEAF_BLOCK_TYPES, resolveDocPath, isExternalDoc } from './helpers.js';
import { snapshotIfNeeded, ensureDocId } from './versions.js';

export interface NodeChange {
  operation: 'rewrite' | 'insert' | 'delete';
  nodeId?: string;
  afterNodeId?: string;
  content?: any;
}

export interface PadDocument {
  type: 'doc';
  content: any[];
}

export interface DocumentInfo {
  filename: string;
  title: string;
  path: string;
  lastModified: string;
  wordCount: number;
  isActive: boolean;
}

interface PadState {
  document: PadDocument;
  title: string;
  metadata: Record<string, any>;      // All frontmatter fields (including title)
  filePath: string;                   // Current file on disk
  isTemp: boolean;                    // True = untitled temp file, cleaned up if empty on close
  lastModified: Date;
  docId: string;                      // 8-char hex ID for version history
}

type ChangeListener = (changes: NodeChange[]) => void;

const DEFAULT_DOC: PadDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [] }],
};

let state: PadState = {
  document: DEFAULT_DOC,
  title: 'Untitled',
  metadata: { title: 'Untitled' },
  filePath: '',
  isTemp: true,
  lastModified: new Date(),
  docId: '',
};

const listeners: Set<ChangeListener> = new Set();

// ============================================================================
// EXTERNAL DOCUMENT REGISTRY
// ============================================================================

const EXTERNAL_DOCS_FILE = join(DATA_DIR, 'external-docs.json');
const externalDocs = new Set<string>();

function persistExternalDocs(): void {
  try {
    writeFileSync(EXTERNAL_DOCS_FILE, JSON.stringify([...externalDocs]), 'utf-8');
  } catch { /* best-effort */ }
}

function loadExternalDocs(): void {
  try {
    if (existsSync(EXTERNAL_DOCS_FILE)) {
      const paths: string[] = JSON.parse(readFileSync(EXTERNAL_DOCS_FILE, 'utf-8'));
      for (const p of paths) {
        if (existsSync(p)) externalDocs.add(p);
      }
    }
  } catch { /* corrupt file — start fresh */ }
}

export function registerExternalDoc(fullPath: string): void {
  externalDocs.add(fullPath);
  persistExternalDocs();
}

export function unregisterExternalDoc(fullPath: string): void {
  externalDocs.delete(fullPath);
  persistExternalDocs();
}

export function getExternalDocs(): string[] {
  return [...externalDocs];
}

function isDocEmpty(doc: PadDocument): boolean {
  if (!doc.content || doc.content.length === 0) return true;
  if (doc.content.length === 1) {
    const node = doc.content[0];
    if (!node.content || node.content.length === 0) return true;
    if (node.content.length === 1 && !node.content[0].text?.trim()) return true;
  }
  return false;
}

// ============================================================================
// GETTERS
// ============================================================================

export function getDocument(): PadDocument {
  return state.document;
}

export function getTitle(): string {
  return state.title;
}

export function getFilePath(): string {
  return state.filePath;
}

export function getDocId(): string {
  return state.docId;
}

export function getPlainText(): string {
  return extractText(state.document.content);
}

function extractText(nodes: any[]): string {
  if (!nodes) return '';
  return nodes
    .map((node) => {
      if (node.text) return node.text;
      if (node.content) return extractText(node.content);
      return '';
    })
    .join('\n');
}

export function getWordCount(): number {
  const text = getPlainText();
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function getPendingChangeCount(): number {
  let count = 0;
  function scan(nodes: any[]) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.attrs?.pendingStatus) count++;
      if (node.content) scan(node.content);
    }
  }
  scan(state.document.content);
  return count;
}

export function getNodesByIds(ids: string[]): any[] {
  const result: any[] = [];
  function scan(nodes: any[]) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.attrs?.id && ids.includes(node.attrs.id)) {
        result.push(node);
      }
      if (node.content) scan(node.content);
    }
  }
  scan(state.document.content);
  return result;
}

export function getMetadata(): Record<string, any> {
  return state.metadata;
}

export function setMetadata(updates: Record<string, any>): void {
  state.metadata = { ...state.metadata, ...updates };
  if (updates.title) state.title = updates.title;
}

export function getStatus() {
  return {
    title: state.title,
    wordCount: getWordCount(),
    pendingChanges: getPendingChangeCount(),
    lastModified: state.lastModified.toISOString(),
  };
}

// ============================================================================
// SETTERS
// ============================================================================

export function updateDocument(doc: PadDocument): void {
  // Preserve pending attrs that the browser doesn't track in its document model.
  // Browser manages pending state as decorations, so its doc-updates lack pendingStatus.
  // Without this, browser overwrites server state and pending info is lost on next save.
  if (hasPendingChanges()) {
    transferPendingAttrs(state.document, doc);
  }
  state.document = doc;
  state.lastModified = new Date();
}

/**
 * Transfer pending attrs from source doc to target doc by matching node IDs.
 * Copies pendingStatus, pendingOriginalContent, and pendingTextEdits.
 */
function transferPendingAttrs(source: PadDocument, target: PadDocument): void {
  // Build a map of nodeId → pending attrs from source
  const pendingMap = new Map<string, { status: string; original?: any; textEdits?: any }>();
  function collectPending(nodes: any[]) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.attrs?.pendingStatus && node.attrs?.id) {
        pendingMap.set(node.attrs.id, {
          status: node.attrs.pendingStatus,
          original: node.attrs.pendingOriginalContent,
          textEdits: node.attrs.pendingTextEdits,
        });
      }
      if (node.content) collectPending(node.content);
    }
  }
  collectPending(source.content);

  // Apply pending attrs to matching nodes in target
  function applyPending(nodes: any[]) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.attrs?.id && pendingMap.has(node.attrs.id)) {
        const p = pendingMap.get(node.attrs.id)!;
        node.attrs.pendingStatus = p.status;
        if (p.original) node.attrs.pendingOriginalContent = p.original;
        if (p.textEdits) node.attrs.pendingTextEdits = p.textEdits;
      }
      if (node.content) applyPending(node.content);
    }
  }
  applyPending(target.content);
}

// ============================================================================
// AGENT WRITE LOCK
// ============================================================================

const AGENT_LOCK_MS = 5000; // Block browser doc-updates for 5s after agent write
let lastAgentWriteTime = 0;

/** Set the agent write lock (called after agent changes). */
function setAgentLock(): void {
  lastAgentWriteTime = Date.now();
}

/** Check if the agent write lock is active. */
export function isAgentLocked(): boolean {
  return Date.now() - lastAgentWriteTime < AGENT_LOCK_MS;
}

// ---- Debounced save: coalesces rapid agent writes into a single disk write ----
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

function debouncedSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, SAVE_DEBOUNCE_MS);
}

/** Cancel any pending debounced save. Call before doc switch (which does its own save). */
export function cancelDebouncedSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

export function applyChanges(changes: NodeChange[]): number {
  // Apply to server-side document (source of truth)
  const processed = applyChangesToDocument(changes);

  // Lock browser doc-updates to prevent stale state overwrite
  setAgentLock();

  // Broadcast processed changes (with server-assigned IDs) to browser clients
  for (const listener of listeners) {
    listener(processed);
  }

  // Debounced save — coalesces rapid agent writes into a single disk write
  debouncedSave();

  return processed.length;
}

export function onChanges(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ============================================================================
// SERVER-SIDE DOCUMENT MUTATIONS
// ============================================================================

// generateNodeId imported from helpers.ts

/**
 * Find a node by ID in the document tree.
 * Returns the parent array and index for in-place mutation.
 */
function findNodeInDoc(nodes: any[], id: string): { parent: any[]; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].attrs?.id === id) {
      return { parent: nodes, index: i };
    }
    if (nodes[i].content && Array.isArray(nodes[i].content)) {
      const result = findNodeInDoc(nodes[i].content, id);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Apply changes to server-side document and return processed changes
 * with server-assigned IDs for broadcast to browsers.
 */
function applyChangesToDocument(changes: NodeChange[]): NodeChange[] {
  const processed: NodeChange[] = [];

  for (const change of changes) {
    if (change.operation === 'rewrite' && change.nodeId && change.content) {
      const found = findNodeInDoc(state.document.content, change.nodeId);
      if (!found) continue;

      const contentArray = Array.isArray(change.content) ? change.content : [change.content];
      const originalNode = JSON.parse(JSON.stringify(found.parent[found.index]));

      // Only store original on first rewrite (preserve baseline for reject)
      const existingOriginal = found.parent[found.index].attrs?.pendingOriginalContent;

      // First node replaces the target (rewrite)
      const firstNode = {
        ...contentArray[0],
        attrs: {
          ...contentArray[0].attrs,
          id: change.nodeId,
          pendingStatus: 'rewrite',
          pendingOriginalContent: existingOriginal || originalNode,
        },
      };

      // Additional nodes get inserted after as pending inserts
      const extraNodes = contentArray.slice(1).map((node: any) => ({
        ...node,
        attrs: {
          ...node.attrs,
          id: node.attrs?.id || generateNodeId(),
          pendingStatus: 'insert',
        },
      }));

      found.parent.splice(found.index, 1, firstNode, ...extraNodes);

      processed.push({
        ...change,
        content: [firstNode, ...extraNodes],
      });
    }

    else if (change.operation === 'insert' && change.content) {
      const contentArray = Array.isArray(change.content) ? change.content : [change.content];

      // Assign IDs to all new nodes before broadcast
      const contentWithIds = contentArray.map((node: any, i: number) => ({
        ...node,
        attrs: {
          ...node.attrs,
          id: node.attrs?.id || (change.nodeId && !change.afterNodeId && i === 0 ? change.nodeId : generateNodeId()),
          pendingStatus: 'insert',
        },
      }));

      if (change.nodeId && !change.afterNodeId) {
        // Replace empty node
        const found = findNodeInDoc(state.document.content, change.nodeId);
        if (!found) continue;
        found.parent.splice(found.index, 1, ...contentWithIds);
      } else if (change.afterNodeId) {
        const found = findNodeInDoc(state.document.content, change.afterNodeId);
        if (!found) continue;
        found.parent.splice(found.index + 1, 0, ...contentWithIds);
      } else {
        continue;
      }

      // Broadcast with server-assigned IDs so browser uses the same IDs
      processed.push({
        ...change,
        content: contentWithIds.length === 1 ? contentWithIds[0] : contentWithIds,
      });
    }

    else if (change.operation === 'delete' && change.nodeId) {
      const found = findNodeInDoc(state.document.content, change.nodeId);
      if (!found) continue;

      found.parent[found.index] = {
        ...found.parent[found.index],
        attrs: {
          ...found.parent[found.index].attrs,
          pendingStatus: 'delete',
        },
      };

      processed.push(change);
    }
  }

  if (processed.length > 0) {
    state.lastModified = new Date();
  }

  return processed;
}

/**
 * Apply fine-grained text edits to a node. Resolves text matches,
 * produces a modified node, and routes through applyChanges as a rewrite.
 */
export function applyTextEdits(nodeId: string, edits: TextEdit[]): { success: boolean; error?: string } {
  const found = findNodeInDoc(state.document.content, nodeId);
  if (!found) return { success: false, error: `Node ${nodeId} not found` };

  const originalNode = found.parent[found.index];
  const result = applyTextEditsToNode(originalNode, edits);
  if (!result) return { success: false, error: 'No edits matched' };

  // Store inline edit ranges for fine-grained decoration
  result.node.attrs = {
    ...result.node.attrs,
    pendingTextEdits: result.textEdits,
  };

  // Route through applyChanges as a rewrite so it goes through the normal pipeline
  applyChanges([{
    operation: 'rewrite',
    nodeId,
    content: result.node,
  }]);

  return { success: true };
}

/** Set the active document state. Used by documents.ts for multi-doc operations. */
export function setActiveDocument(
  doc: PadDocument, title: string, filePath: string, isTemp: boolean,
  lastModified?: Date, metadata?: Record<string, any>,
): void {
  state.document = doc;
  state.title = title;
  state.metadata = metadata || { title };
  state.filePath = filePath;
  state.isTemp = isTemp;
  state.lastModified = lastModified || new Date();
  state.docId = ensureDocId(state.metadata);
}

// ============================================================================
// PENDING DOCUMENT STORE OPERATIONS
// ============================================================================

/** Check if a document (or the current doc) has any pending changes. */
export function hasPendingChanges(doc?: PadDocument): boolean {
  const target = doc || state.document;
  function scan(nodes: any[]): boolean {
    if (!nodes) return false;
    for (const node of nodes) {
      if (node.attrs?.pendingStatus) return true;
      if (node.content && scan(node.content)) return true;
    }
    return false;
  }
  return scan(target.content);
}

/** Strip all pending attrs from the current document (after browser resolves all changes). */
export function stripPendingAttrs(): void {
  function strip(nodes: any[]) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.attrs?.pendingStatus) {
        delete node.attrs.pendingStatus;
        delete node.attrs.pendingOriginalContent;
        delete node.attrs.pendingTextEdits;
      }
      if (node.content) strip(node.content);
    }
  }
  strip(state.document.content);
}

/**
 * Mark leaf block nodes as pending. Only marks text-containing blocks
 * (paragraph, heading, codeBlock, horizontalRule) — NOT container nodes
 * (bulletList, orderedList, listItem, blockquote) whose children get marked instead.
 * This prevents overlapping decorations and ensures accept/reject acts on visible blocks.
 */
export function markAllNodesAsPending(doc: PadDocument, status: 'insert' | 'rewrite'): void {
  function mark(nodes: any[]) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.type && LEAF_BLOCK_TYPES.has(node.type)) {
        node.attrs = { ...node.attrs, pendingStatus: status };
        if (!node.attrs.id) {
          node.attrs.id = generateNodeId();
        }
        // Don't recurse into leaf blocks — prevents overlapping decorations
        // (e.g. table marked + its inner paragraphs also marked)
      } else if (node.content) {
        // Recurse into container children to mark nested leaf blocks (e.g. paragraphs inside listItems)
        mark(node.content);
      }
    }
  }
  mark(doc.content);
}

/** Get filenames of all docs with pending changes (disk scan + external docs + current in-memory doc). */
export function getPendingDocFilenames(): string[] {
  const filenames: string[] = [];
  try {
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      try {
        const raw = readFileSync(join(DATA_DIR, f), 'utf-8');
        const { data } = matter(raw);
        if (data.pending && Object.keys(data.pending).length > 0) {
          filenames.push(f);
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* ignore */ }
  // Scan external docs for pending frontmatter
  for (const extPath of externalDocs) {
    try {
      if (!existsSync(extPath)) continue;
      const raw = readFileSync(extPath, 'utf-8');
      const { data } = matter(raw);
      if (data.pending && Object.keys(data.pending).length > 0) {
        filenames.push(extPath);
      }
    } catch { /* skip unreadable files */ }
  }
  // Check current in-memory doc (may have unsaved pending state)
  const currentFilename = state.filePath
    ? (isExternalDoc(state.filePath) ? state.filePath : state.filePath.split(/[/\\]/).pop() || '')
    : '';
  if (currentFilename && hasPendingChanges() && !filenames.includes(currentFilename)) {
    filenames.push(currentFilename);
  }
  return filenames;
}

/** Get pending change counts per filename (disk scan + external docs + current in-memory doc). */
export function getPendingDocCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  try {
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      try {
        const raw = readFileSync(join(DATA_DIR, f), 'utf-8');
        const { data } = matter(raw);
        if (data.pending && Object.keys(data.pending).length > 0) {
          counts[f] = Object.keys(data.pending).length;
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* ignore */ }
  // Scan external docs
  for (const extPath of externalDocs) {
    try {
      if (!existsSync(extPath)) continue;
      const raw = readFileSync(extPath, 'utf-8');
      const { data } = matter(raw);
      if (data.pending && Object.keys(data.pending).length > 0) {
        counts[extPath] = Object.keys(data.pending).length;
      }
    } catch { /* skip unreadable files */ }
  }
  // Current in-memory doc may have unsaved pending state
  const currentFilename = state.filePath
    ? (isExternalDoc(state.filePath) ? state.filePath : state.filePath.split(/[/\\]/).pop() || '')
    : '';
  if (currentFilename && hasPendingChanges()) {
    counts[currentFilename] = getPendingChangeCount();
  }
  return counts;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

function writeToDisk(): void {
  ensureDataDir();
  const markdown = tiptapToMarkdown(state.document, state.title, state.metadata);

  if (existsSync(state.filePath)) {
    // Skip write if content is identical (prevents phantom git changes on doc switch)
    try {
      const existing = readFileSync(state.filePath, 'utf-8');
      if (existing === markdown) return;
    } catch { /* read failed, proceed with write */ }

    // Safety: don't overwrite a file with substantial content using near-empty content.
    // Prevents save cascades where empty editor state destroys chapter files.
    // Exception: docs with pending changes may legitimately be smaller (agent replaced content).
    if (!hasPendingChanges()) {
      try {
        const existingSize = statSync(state.filePath).size;
        if (existingSize > 200 && markdown.length < existingSize * 0.1) {
          console.error(`[State] BLOCKED destructive save: ${markdown.length} bytes would replace ${existingSize} bytes in ${state.filePath}`);
          return;
        }
      } catch { /* stat failed, proceed with save */ }
    }
  }

  writeFileSync(state.filePath, markdown, 'utf-8');

  // Best-effort version snapshot — never blocks saves
  try { snapshotIfNeeded(state.docId, state.filePath); } catch { /* ignore */ }
}

export function save(): void {
  if (!state.filePath) {
    // First save — assign a file path
    ensureDataDir();
    if (state.title === 'Untitled') {
      state.filePath = tempFilePath();
      state.isTemp = true;
    } else {
      state.filePath = filePathForTitle(state.title);
      state.isTemp = false;
    }
  }
  writeToDisk();
}

export function load(): void {
  ensureDataDir();

  // Restore external document registry from disk
  loadExternalDocs();

  // Migrate any .sw.json files to .md
  migrateSwJsonFiles();

  // Clean up empty temp files from previous sessions
  cleanupEmptyTempFiles();

  // Find most recently modified .md file
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fullPath = join(DATA_DIR, f);
      const stat = statSync(fullPath);
      return { name: f, path: fullPath, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    // No existing docs — start fresh with temp file
    state.filePath = tempFilePath();
    state.isTemp = true;
    return;
  }

  // Open the most recent file
  const latest = files[0];
  try {
    const raw = readFileSync(latest.path, 'utf-8');
    const parsed = markdownToTiptap(raw);
    state.document = parsed.document;
    state.title = parsed.title;
    state.metadata = parsed.metadata;
    state.lastModified = new Date(statSync(latest.path).mtimeMs);
    state.filePath = latest.path;
    state.isTemp = latest.name.startsWith(TEMP_PREFIX);

    // Lazy docId migration: assign if missing, save to persist
    const hadDocId = !!state.metadata.docId;
    state.docId = ensureDocId(state.metadata);
    if (!hadDocId) {
      const md = tiptapToMarkdown(state.document, state.title, state.metadata);
      writeFileSync(state.filePath, md, 'utf-8');
    }
  } catch {
    // Corrupt file — start fresh
    state.filePath = tempFilePath();
    state.isTemp = true;
  }

  // Startup lock: block browser doc-updates briefly to prevent stale reconnect pushes
  setAgentLock();
}

/** Migrate legacy .sw.json files to .md format */
function migrateSwJsonFiles(): void {
  try {
    const jsonFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith('.sw.json'));
    for (const f of jsonFiles) {
      const jsonPath = join(DATA_DIR, f);
      const mdName = f.replace(/\.sw\.json$/, '.md');
      const mdPath = join(DATA_DIR, mdName);

      // Skip if .md already exists
      if (existsSync(mdPath)) {
        try { unlinkSync(jsonPath); } catch { /* ignore */ }
        continue;
      }

      try {
        const raw = readFileSync(jsonPath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.document) {
          const title = data.title || 'Untitled';
          const markdown = tiptapToMarkdown(data.document, title);
          writeFileSync(mdPath, markdown, 'utf-8');
          console.log(`[State] Migrated ${f} → ${mdName}`);
        }
        unlinkSync(jsonPath);
      } catch {
        // Corrupt JSON file — delete it
        try { unlinkSync(jsonPath); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore errors during migration */ }
}

/** Collect all filenames referenced by any workspace manifest. */
function getWorkspaceReferencedFiles(): Set<string> {
  const referenced = new Set<string>();
  try {
    const wsDir = join(DATA_DIR, '_workspaces');
    if (!existsSync(wsDir)) return referenced;
    const manifests = readdirSync(wsDir).filter((f) => f.endsWith('.json'));
    for (const m of manifests) {
      try {
        const raw = readFileSync(join(wsDir, m), 'utf-8');
        const ws = JSON.parse(raw);
        // Recursively collect doc files from root tree
        const collect = (nodes: any[]) => {
          for (const n of nodes) {
            if (n.type === 'doc' && n.file) referenced.add(n.file);
            if (n.type === 'container' && Array.isArray(n.items)) collect(n.items);
          }
        };
        if (Array.isArray(ws.root)) collect(ws.root);
        else if (Array.isArray(ws.items)) {
          // v1 format
          for (const item of ws.items) {
            if (item.file) referenced.add(item.file);
          }
        }
      } catch { /* skip corrupt manifests */ }
    }
  } catch { /* ignore */ }
  return referenced;
}

/** Remove temp files that are empty (from abandoned sessions) */
function cleanupEmptyTempFiles(): void {
  try {
    const wsRefs = getWorkspaceReferencedFiles();
    const files = readdirSync(DATA_DIR).filter((f) => f.startsWith(TEMP_PREFIX) && f.endsWith('.md'));
    for (const f of files) {
      // Never delete temp files that are referenced by a workspace
      if (wsRefs.has(f)) continue;
      const fullPath = join(DATA_DIR, f);
      try {
        const raw = readFileSync(fullPath, 'utf-8');
        const parsed = markdownToTiptap(raw);
        if (isDocEmpty(parsed.document)) {
          unlinkSync(fullPath);
        }
      } catch {
        // Corrupt temp file — delete it (but only if not workspace-referenced)
        try { unlinkSync(fullPath); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore errors during cleanup */ }
}
