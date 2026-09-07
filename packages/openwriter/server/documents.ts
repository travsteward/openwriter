/**
 * Multi-document operations for OpenWriter workspace.
 * Manages listing, switching, creating, deleting documents.
 * Each document is a .md file in ~/.openwriter/.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import trash from 'trash';
import { tiptapToMarkdownChecked, markdownToTiptap } from './markdown.js';
import { resolveTypeMeta } from './content-type-meta.js';
import { parseMarkdownContent } from './compact.js';
import {
  getDocument, getTitle, getFilePath, getIsTemp, getMetadata, save, cancelDebouncedSave, setActiveDocument,
  registerExternalDoc, unregisterExternalDoc, getExternalDocs,
  cacheActiveDocument, getCachedDocument, invalidateDocCache, removePendingCacheEntry, setPendingCacheEntry,
  resetDocVersion, markAsAgentStub, unmarkAgentStub, isAgentStub,
  type PadDocument, type DocumentInfo,
} from './state.js';
import { getDataDir, TEMP_PREFIX, ensureDataDir, filePathForTitle, tempFilePath, generateNodeId, resolveDocPath, isExternalDoc, atomicWriteFileSync, canonicalizePath } from './helpers.js';
import { resolveListingTitle, getWorkspaceTitleMap } from './title-resolve.js';
import { ensureDocId } from './versions.js';
import { renameDocInAllWorkspaces, removeDocFromAllWorkspaces, listWorkspaces, getWorkspace } from './workspaces.js';
import { collectAllFiles } from './workspace-tree.js';
import { renameComments } from './comments.js';
import { deleteOverlay, diagLog } from './pending-overlay.js';
import { loadPendingMetadata, savePendingMetadata, type PendingMetadata } from './pending-metadata.js';
import { getPendingMetadata as getActivePendingMetadata, setPendingMetadata as setActivePendingMetadata, getDocVersion } from './state.js';

import { getDocId as getActiveDocId } from './state.js';

function getDocOrderFile(): string { return join(getDataDir(), '_doc-order.json'); }

/** Scan files for matching docId. Checks active doc first (free), then getDataDir(), then external docs. */
export function filenameByDocId(docId: string): string | null {
  // Fast path: check active document (no disk read)
  if (getActiveDocId() === docId) {
    return getActiveFilename();
  }

  // Scan getDataDir() files
  ensureDataDir();
  for (const f of readdirSync(getDataDir()).filter(f => f.endsWith('.md'))) {
    try {
      const raw = readFileSync(join(getDataDir(), f), 'utf-8');
      const { data } = matter(raw);
      if (data.docId === docId) return f;
    } catch { /* skip */ }
  }

  // Scan external docs
  for (const extPath of getExternalDocs()) {
    try {
      if (!existsSync(extPath)) continue;
      const raw = readFileSync(extPath, 'utf-8');
      const { data } = matter(raw);
      if (data.docId === docId) return extPath;
    } catch { /* skip */ }
  }

  return null;
}

/** Resolve docId to filename. Throws if not found. */
export function resolveDocId(docId: string): string {
  const filename = filenameByDocId(docId);
  if (!filename) throw new Error(`Document not found for docId: ${docId}`);
  return filename;
}

function readDocOrder(): string[] {
  try {
    if (!existsSync(getDocOrderFile())) return [];
    return JSON.parse(readFileSync(getDocOrderFile(), 'utf-8'));
  } catch { return []; }
}

function writeDocOrder(order: string[]): void {
  ensureDataDir();
  writeFileSync(getDocOrderFile(), JSON.stringify(order, null, 2), 'utf-8');
}

export function reorderDocs(orderedFilenames: string[]): void {
  writeDocOrder(orderedFilenames);
}

/** Derive content_type from frontmatter — explicit field first, then fallback from context keys. */
function deriveContentType(data: Record<string, any>): string | undefined {
  if (data.content_type) return data.content_type as string;
  if (data.tweetContext) return data.tweetContext.mode || 'tweet';
  if (data.articleContext) return 'article';
  if (data.linkedinContext) return 'linkedin';
  if (data.newsletterContext) return 'newsletter';
  if (data.blogContext) return 'blog';
  return undefined;
}

export function listDocuments(): DocumentInfo[] {
  ensureDataDir();
  const currentPath = getFilePath();
  const wsTitles = getWorkspaceTitleMap();
  const files = readdirSync(getDataDir())
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fullPath = join(getDataDir(), f);
      try {
        const stat = statSync(fullPath);
        const raw = readFileSync(fullPath, 'utf-8');

        // Use gray-matter directly — skip full TipTap parse for listing
        const { data, content } = matter(raw);
        const title = resolveListingTitle({ fmTitle: data.title, workspaceTitle: wsTitles.get(f), content, filename: f });

        // Skip archived docs
        if (data.archivedAt) return null;

        // Skip empty temp files (not the active doc)
        const trimmed = content.trim();
        if (f.startsWith(TEMP_PREFIX) && !trimmed && fullPath !== currentPath) return null;

        const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

        return {
          filename: f,
          title,
          path: fullPath,
          lastModified: stat.mtime.toISOString(),
          wordCount,
          isActive: fullPath === currentPath,
          ...(data.docId ? { docId: data.docId as string } : {}),
          ...(data.newsletterContext?.lastSend?.sentAt ? { lastSent: data.newsletterContext.lastSend.sentAt } : data.tweetContext?.lastPost?.postedAt ? { lastSent: data.tweetContext.lastPost.postedAt } : data.blogContext?.lastPublish?.publishedAt ? { lastSent: data.blogContext.lastPublish.publishedAt } : data.articleContext?.lastPost?.postedAt ? { lastSent: data.articleContext.lastPost.postedAt } : data.manualPost?.postedAt ? { lastSent: data.manualPost.postedAt } : {}),
          ...(data.tweetContext?.lastPost?.tweetUrl ? { postedUrl: data.tweetContext.lastPost.tweetUrl } : data.articleContext?.lastPost?.tweetUrl ? { postedUrl: data.articleContext.lastPost.tweetUrl } : data.blogContext?.lastPublish?.publishedUrl ? { postedUrl: data.blogContext.lastPublish.publishedUrl } : {}),
          ...(data.newsletterContext ? { isNewsletter: true } : {}),
          ...(deriveContentType(data) ? { contentType: deriveContentType(data) } : {}),
          ...(data.masterDocId ? { masterDocId: data.masterDocId as string } : {}),
          ...(data.variantType ? { variantType: data.variantType as string } : {}),
          ...(typeof data.autoAccept === 'boolean' ? { autoAccept: data.autoAccept } : {}),
          // Tags ride along with the doc listing so the sidebar can populate its
          // tag overlay from one HTTP round-trip instead of N. The server already
          // has the parsed frontmatter in hand here; emitting tags is free.
          ...(Array.isArray(data.tags) && data.tags.length > 0 ? { tags: data.tags as string[] } : {}),
          // Enrichment fields — free at this point since data is in hand.
          // v0.19.0 schema: only logline (LLM) + status (agent) + enrichmentStale
          // (system) are surfaced. domain / concepts / docRole stayed on disk for
          // legacy docs but are no longer read (lazy migration via mark_enriched).
          // See brief 2026-05-21-simplify-enrichment-schema-three-fields.
          ...(typeof data.logline === 'string' && data.logline ? { logline: data.logline as string } : {}),
          ...(typeof data.status === 'string' && data.status ? { status: data.status as string } : {}),
          ...(data.enrichmentStale === true ? { enrichmentStale: true as const } : {}),
          // Sort-request fields — sidebar reads these to render the badge / proposal popover.
          ...(data.sortRequest && typeof data.sortRequest === 'object' ? { sortRequest: data.sortRequest } : {}),
          ...(typeof data.lastSortedAt === 'string' ? { lastSortedAt: data.lastSortedAt } : {}),
        } as DocumentInfo;
      } catch {
        return null;
      }
    })
    .filter((f): f is DocumentInfo => f !== null);

  // Append registered external docs
  for (const extPath of getExternalDocs()) {
    try {
      if (!existsSync(extPath)) {
        unregisterExternalDoc(extPath); // Clean up stale registry entries
        continue;
      }
      const stat = statSync(extPath);
      const raw = readFileSync(extPath, 'utf-8');
      const { data, content } = matter(raw);
      const title = resolveListingTitle({ fmTitle: data.title, workspaceTitle: wsTitles.get(extPath), content, filename: extPath });
      const trimmed = content.trim();
      const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

      files.push({
        filename: extPath, // Full path as identifier
        title,
        path: extPath,
        lastModified: stat.mtime.toISOString(),
        wordCount,
        isActive: extPath === currentPath,
        ...(data.docId ? { docId: data.docId as string } : {}),
        ...(data.newsletterContext?.lastSend?.sentAt ? { lastSent: data.newsletterContext.lastSend.sentAt } : data.tweetContext?.lastPost?.postedAt ? { lastSent: data.tweetContext.lastPost.postedAt } : data.blogContext?.lastPublish?.publishedAt ? { lastSent: data.blogContext.lastPublish.publishedAt } : data.articleContext?.lastPost?.postedAt ? { lastSent: data.articleContext.lastPost.postedAt } : {}),
        ...(data.tweetContext?.lastPost?.tweetUrl ? { postedUrl: data.tweetContext.lastPost.tweetUrl } : data.articleContext?.lastPost?.tweetUrl ? { postedUrl: data.articleContext.lastPost.tweetUrl } : data.blogContext?.lastPublish?.publishedUrl ? { postedUrl: data.blogContext.lastPublish.publishedUrl } : {}),
        ...(data.newsletterContext ? { isNewsletter: true } : {}),
        ...(deriveContentType(data) ? { contentType: deriveContentType(data) } : {}),
        ...(data.masterDocId ? { masterDocId: data.masterDocId as string } : {}),
        ...(data.variantType ? { variantType: data.variantType as string } : {}),
        ...(typeof data.autoAccept === 'boolean' ? { autoAccept: data.autoAccept } : {}),
      });
    } catch { /* skip unreadable external files */ }
  }

  // Sort by persisted order; docs not in manifest prepend (newest first by mtime)
  const order = readDocOrder();
  if (order.length > 0) {
    const orderIndex = new Map(order.map((f, i) => [f, i]));
    const hasUnknown = files.some(f => !orderIndex.has(f.filename));
    files.sort((a, b) => {
      const ai = orderIndex.get(a.filename) ?? -1;
      const bi = orderIndex.get(b.filename) ?? -1;
      // Both unknown → newest first by mtime
      if (ai === -1 && bi === -1) return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
      // Unknown docs sort before known (prepend)
      if (ai === -1) return -1;
      if (bi === -1) return 1;
      return ai - bi;
    });
    // Absorb unknown docs into manifest so they stay put after edits
    if (hasUnknown) {
      writeDocOrder(files.map(f => f.filename));
    }
  } else {
    // No manifest yet — create one from current mtime order so all docs are tracked
    writeDocOrder(files.map(f => f.filename));
  }

  return files;
}

// ============================================================================
// ARCHIVE
// ============================================================================

export function listArchivedDocuments(): DocumentInfo[] {
  ensureDataDir();
  const files = readdirSync(getDataDir())
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fullPath = join(getDataDir(), f);
      try {
        const stat = statSync(fullPath);
        const raw = readFileSync(fullPath, 'utf-8');
        const { data, content } = matter(raw);
        if (!data.archivedAt) return null;
        const title = resolveListingTitle({ fmTitle: data.title, content, filename: f });
        const trimmed = content.trim();
        const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
        return {
          filename: f,
          title,
          path: fullPath,
          lastModified: stat.mtime.toISOString(),
          wordCount,
          isActive: false,
          ...(data.docId ? { docId: data.docId as string } : {}),
          ...(data.masterDocId ? { masterDocId: data.masterDocId as string } : {}),
          ...(data.variantType ? { variantType: data.variantType as string } : {}),
          archivedAt: data.archivedAt as string,
        } as DocumentInfo & { archivedAt: string };
      } catch { return null; }
    })
    .filter((f): f is DocumentInfo & { archivedAt: string } => f !== null);

  // Sort by archivedAt desc (most recently archived first)
  files.sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());
  return files;
}

// ============================================================================
// ENRICHMENT — list dirty docs + crawl + surfacing helpers
// See brief 2026-05-18-frontmatter-enrichment-system.
// ============================================================================

/** One-line footer the high-frequency MCP discovery tools (list_documents,
 *  list_workspaces, get_workspace_structure) append when dirty docs exist.
 *  Constant pressure that doesn't require hook setup. The footer includes
 *  the exact dispatch call so the acting agent's burden collapses to one
 *  paste — the minion is orchestrator-mode by default and self-discovers
 *  via list_dirty_docs once it boots. */
export function enrichmentFooter(): string {
  const count = listDirtyDocs().length;
  if (count === 0) return '';
  return `\n\n⚠ ${count} doc${count === 1 ? '' : 's'} need enrichment. Dispatch:\nAgent(\n  subagent_type: "openwriter-enrichment-minion",\n  description: "Drain stale docs",\n  prompt: "Enrich stale docs.",\n  run_in_background: true\n)`;
}

/** Session-start enrichment notice injected into the MCP server's
 *  `instructions` field at boot. Every MCP client (Claude Code, Cursor, etc.)
 *  delivers this to the agent as part of its system context — no hook setup
 *  needed. Returns empty string when there's no enrichment work to do. */
export function buildEnrichmentInstructions(): string {
  const dirty = listDirtyDocs();
  if (dirty.length === 0) return '';

  // Group by workspace for the notice
  const byWorkspace = new Map<string, number>();
  let orphans = 0;
  for (const d of dirty) {
    if (d.workspaceFile) {
      byWorkspace.set(d.workspaceFile, (byWorkspace.get(d.workspaceFile) || 0) + 1);
    } else {
      orphans++;
    }
  }
  const parts: string[] = [];
  for (const [ws, n] of byWorkspace) parts.push(`${n} in ${ws}`);
  if (orphans > 0) parts.push(`${orphans} unfiled`);

  return [
    '',
    `ENRICHMENT_STATUS: ${dirty.length} doc${dirty.length === 1 ? '' : 's'} need enrichment (${parts.join(', ')}).`,
    'Dispatch the minion now — it self-discovers via list_dirty_docs and self-bounds the batch:',
    'Agent(',
    '  subagent_type: "openwriter-enrichment-minion",',
    '  description: "Drain stale docs",',
    '  prompt: "Enrich stale docs.",',
    '  run_in_background: true',
    ')',
  ].join('\n');
}

export interface DirtyDocEntry {
  docId: string;
  filename: string;
  title: string;
  workspaceFile?: string;
  reason: 'never_enriched' | 'stale_flag';
  lastEnrichedAt?: string;
}

export interface PendingSortEntry {
  docId: string;
  filename: string;
  title: string;
  /** Workspace the doc currently lives in (if any). The agent uses this to
   *  understand whether the sort is "find a home" (unfiled) or "find a better
   *  home" (already in workspace X). */
  currentWorkspaceFile?: string;
  /** Container the doc currently sits in (null = workspace root). */
  currentContainerId?: string | null;
  requestedAt: string;
  /** Present when the agent has already written back a proposal. The UI uses
   *  presence to flip the badge state from pending → proposal-ready. */
  proposal?: {
    wsFilename: string;
    containerId: string | null;
    reasoning: string;
  };
}

/** Footer on the three high-frequency discovery tools when sort requests are
 *  pending. Stacks beneath enrichmentFooter. Carries the exact dispatch call
 *  so the acting agent's burden collapses to one paste — the sort minion is
 *  autonomous and self-discovers via list_pending_sorts once it boots, files
 *  each doc, and reports what moved. The earlier "handle it inline, no minion"
 *  model never drained (marks rotted for days); auto-drain replaces it.
 *  adr: adr/sort-minion-drain.md */
export function sortFooter(): string {
  const count = listPendingSorts().length;
  if (count === 0) return '';
  return `\n\n⚠ ${count} doc${count === 1 ? '' : 's'} awaiting sort. Dispatch:\nAgent(\n  subagent_type: "openwriter-sort-minion",\n  description: "File pending sorts",\n  prompt: "File pending sorts.",\n  run_in_background: true\n)`;
}

/** Session-start sort notice — stacks with buildEnrichmentInstructions inside
 *  the MCP `instructions` field. Empty when no sorts pending. Mirrors
 *  buildEnrichmentInstructions: an executable dispatch directive, not advice.
 *  adr: adr/sort-minion-drain.md */
export function buildSortInstructions(): string {
  const pending = listPendingSorts();
  if (pending.length === 0) return '';

  return [
    '',
    `SORT_STATUS: ${pending.length} doc${pending.length === 1 ? '' : 's'} awaiting sort.`,
    'Dispatch the minion now — it self-discovers via list_pending_sorts, picks a destination for each doc, files it (move_item), retires the request (mark_sorted), and reports what moved:',
    'Agent(',
    '  subagent_type: "openwriter-sort-minion",',
    '  description: "File pending sorts",',
    '  prompt: "File pending sorts.",',
    '  run_in_background: true',
    ')',
  ].join('\n');
}

/**
 * List documents with a pending sortRequest. Returns identity + (optional)
 * proposal — no bodies. The agent calls this first to know what to work on.
 *
 * Optional `scopeWorkspace` narrows to one workspace.
 */
export function listPendingSorts(scopeWorkspace?: string): PendingSortEntry[] {
  ensureDataDir();
  const ownership = buildWorkspaceOwnershipMap();
  const containerByFile = buildContainerOwnershipMap();
  const optedOut = collectAutoSortOptedOutFilenames();

  let scopeFiles: Set<string> | null = null;
  if (scopeWorkspace) {
    try {
      const ws = getWorkspace(scopeWorkspace);
      scopeFiles = new Set<string>(collectAllFiles(ws.root));
    } catch {
      return [];
    }
  }

  const out: PendingSortEntry[] = [];
  for (const f of readdirSync(getDataDir()).filter((f) => f.endsWith('.md'))) {
    if (scopeFiles && !scopeFiles.has(f)) continue;
    if (optedOut.has(f)) continue;
    try {
      const raw = readFileSync(join(getDataDir(), f), 'utf-8');
      const { data } = matter(raw);
      if (data.archivedAt) continue;
      const req = data.sortRequest;
      if (!req || typeof req !== 'object') continue;

      out.push({
        docId: (data.docId as string) || '',
        filename: f,
        title: (data.title as string) || f.replace(/\.md$/, ''),
        ...(ownership.get(f) ? { currentWorkspaceFile: ownership.get(f) } : {}),
        ...(containerByFile.has(f) ? { currentContainerId: containerByFile.get(f) ?? null } : {}),
        requestedAt: typeof req.requestedAt === 'string' ? req.requestedAt : '',
        ...(req.proposal && typeof req.proposal === 'object' ? { proposal: req.proposal } : {}),
      });
    } catch { /* skip unreadable */ }
  }
  return out;
}

/** Map filename → containerId (or null for workspace root) for every doc inside
 *  any workspace. Used to attribute current location to pending-sort entries. */
function buildContainerOwnershipMap(): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const info of listWorkspaces()) {
    try {
      const ws = getWorkspace(info.filename);
      walkForContainerOwnership(ws.root, null, (file, containerId) => {
        if (!map.has(file)) map.set(file, containerId);
      });
    } catch { /* skip corrupt */ }
  }
  return map;
}

function walkForContainerOwnership(nodes: any[], parentContainerId: string | null, cb: (file: string, containerId: string | null) => void): void {
  for (const n of nodes) {
    if (n.type === 'doc') cb(n.file, parentContainerId);
    else if (n.type === 'container') walkForContainerOwnership(n.items, n.id, cb);
  }
}

export interface CrawlEntry {
  docId: string;
  filename: string;
  title: string;
  wordCount: number;
  logline?: string;
  tags?: string[];
  /** Agent-owned: "canonical" = committed to spine / load-bearing.
   *  "draft" = working / not load-bearing yet / superseded. v0.19.0. */
  status?: 'canonical' | 'draft' | string;
  /** System-owned: openwriter sets to true on save when drift / volume trips. */
  enrichmentStale?: boolean;
}

/** Build a Set of filenames inside workspaces with enrichmentDisabled: true.
 *  These docs are excluded from list_dirty_docs and crawl results. */
function collectOptedOutFilenames(): Set<string> {
  const out = new Set<string>();
  for (const info of listWorkspaces()) {
    try {
      const ws = getWorkspace(info.filename);
      if (ws.enrichmentDisabled === true) {
        for (const f of collectAllFiles(ws.root)) out.add(f);
      }
    } catch { /* skip corrupt manifests */ }
  }
  return out;
}

/** Build a Set of filenames inside workspaces with autoSortDisabled: true.
 *  These docs are excluded from list_pending_sorts, so the sort minion never
 *  auto-files them — the user handles them manually via the sidebar. */
function collectAutoSortOptedOutFilenames(): Set<string> {
  const out = new Set<string>();
  for (const info of listWorkspaces()) {
    try {
      const ws = getWorkspace(info.filename);
      if (ws.autoSortDisabled === true) {
        for (const f of collectAllFiles(ws.root)) out.add(f);
      }
    } catch { /* skip corrupt manifests */ }
  }
  return out;
}

/** Map filename → first workspace that contains it. Used to attribute
 *  dirty-doc reports to a workspace. */
function buildWorkspaceOwnershipMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const info of listWorkspaces()) {
    try {
      const ws = getWorkspace(info.filename);
      for (const f of collectAllFiles(ws.root)) {
        if (!map.has(f)) map.set(f, info.filename);
      }
    } catch { /* skip */ }
  }
  return map;
}

/**
 * List documents that need re-enrichment. A doc is "dirty" when either:
 *   - it has never been enriched (no lastEnrichedAt) — implicitly stale; or
 *   - openwriter flipped enrichmentStale: true at save (volume or drift trip).
 *
 * Docs inside opt-out workspaces (enrichmentDisabled: true) are excluded.
 * Archived docs are excluded.
 *
 * Optional `scopeWorkspace` narrows results to a single workspace.
 *
 * Cheap: reads each .md file's frontmatter via gray-matter (no TipTap parse,
 * no body scan). Output carries only identity + reason — no enrichment fields.
 */
export function listDirtyDocs(scopeWorkspace?: string): DirtyDocEntry[] {
  ensureDataDir();
  const optedOut = collectOptedOutFilenames();
  const ownership = buildWorkspaceOwnershipMap();

  // If a workspace scope is given, build a Set of its files to filter against.
  let scopeFiles: Set<string> | null = null;
  if (scopeWorkspace) {
    try {
      const ws = getWorkspace(scopeWorkspace);
      scopeFiles = new Set<string>(collectAllFiles(ws.root));
    } catch {
      // Unknown workspace → return empty rather than throw
      return [];
    }
  }

  const out: DirtyDocEntry[] = [];
  for (const f of readdirSync(getDataDir()).filter((f) => f.endsWith('.md'))) {
    if (optedOut.has(f)) continue;
    if (scopeFiles && !scopeFiles.has(f)) continue;
    try {
      const raw = readFileSync(join(getDataDir(), f), 'utf-8');
      const { data } = matter(raw);
      if (data.archivedAt) continue; // archived docs don't participate

      const explicitStale = data.enrichmentStale === true;
      const implicitStale = !data.lastEnrichedAt;
      if (!explicitStale && !implicitStale) continue;

      out.push({
        docId: (data.docId as string) || '',
        filename: f,
        title: (data.title as string) || f.replace(/\.md$/, ''),
        ...(ownership.get(f) ? { workspaceFile: ownership.get(f) } : {}),
        reason: explicitStale ? 'stale_flag' : 'never_enriched',
        ...(typeof data.lastEnrichedAt === 'string' ? { lastEnrichedAt: data.lastEnrichedAt } : {}),
      });
    } catch { /* skip unreadable */ }
  }
  return out;
}

/**
 * Bulk-read primitive for agents building working sets. Returns enriched
 * fields per doc, filtered by criteria. No bodies, no nodes/graveyard, no
 * pending overlay state.
 *
 * Filters compose with AND semantics — a doc must match every supplied
 * criterion. Empty filter object returns every non-archived doc with its
 * enrichment fields (whatever's present in frontmatter).
 *
 * Optimization: one disk pass, one gray-matter parse per file.
 */
export function crawlDocs(filter: {
  workspaceFile?: string;
  tags?: string[];
  /** Agent-owned filter: "canonical" = load-bearing for the workspace,
   *  "draft" = working / superseded. v0.19.0 replaces docRole / domain /
   *  concepts filters with this single trusted authority axis. */
  status?: 'canonical' | 'draft';
  hasLogline?: boolean;
} = {}): CrawlEntry[] {
  ensureDataDir();

  // If a workspace scope is given, prebuild a set of its filenames.
  let scopeFiles: Set<string> | null = null;
  if (filter.workspaceFile) {
    try {
      const ws = getWorkspace(filter.workspaceFile);
      scopeFiles = new Set<string>(collectAllFiles(ws.root));
    } catch {
      return [];
    }
  }

  const out: CrawlEntry[] = [];
  for (const f of readdirSync(getDataDir()).filter((f) => f.endsWith('.md'))) {
    if (scopeFiles && !scopeFiles.has(f)) continue;
    try {
      const raw = readFileSync(join(getDataDir(), f), 'utf-8');
      const { data, content } = matter(raw);
      if (data.archivedAt) continue;

      // Apply filters. v0.19.0 schema: status (agent-owned) replaces
      // docRole / domain / concepts. Legacy fields still on disk are
      // ignored by both filtering and output — they retire as docs get
      // re-enriched. See brief 2026-05-21-simplify-enrichment-schema-three-fields.
      if (filter.status && data.status !== filter.status) continue;
      if (filter.hasLogline === true && !data.logline) continue;
      if (filter.hasLogline === false && data.logline) continue;
      if (filter.tags && filter.tags.length > 0) {
        const docTags: string[] = Array.isArray(data.tags) ? data.tags : [];
        if (!filter.tags.every((t) => docTags.includes(t))) continue;
      }

      const trimmed = content.trim();
      out.push({
        docId: (data.docId as string) || '',
        filename: f,
        title: (data.title as string) || f.replace(/\.md$/, ''),
        wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
        ...(typeof data.logline === 'string' && data.logline ? { logline: data.logline } : {}),
        ...(Array.isArray(data.tags) && data.tags.length > 0 ? { tags: data.tags } : {}),
        ...(typeof data.status === 'string' && data.status ? { status: data.status } : {}),
        ...(data.enrichmentStale === true ? { enrichmentStale: true } : {}),
      });
    } catch { /* skip */ }
  }
  return out;
}

export { archiveDocument, unarchiveDocument } from './document-archive.js';
export interface SearchResult {
  filename: string;
  title: string;
  lastModified: string;
  wordCount: number;
  isActive: boolean;
  matchType: 'title' | 'tag' | 'content';
  snippet: string | null;
  matchedTag: string | null;
  isArchived?: boolean;
}

export function searchDocuments(query: string, includeArchived = false): SearchResult[] {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const currentPath = getFilePath();

  // Collect all files (same pattern as listDocuments)
  ensureDataDir();
  const allFiles: { filename: string; path: string; raw: string; mtime: Date }[] = [];

  for (const f of readdirSync(getDataDir()).filter(f => f.endsWith('.md'))) {
    try {
      const fullPath = join(getDataDir(), f);
      const mtime = statSync(fullPath).mtime;
      const raw = readFileSync(fullPath, 'utf-8');
      allFiles.push({ filename: f, path: fullPath, raw, mtime });
    } catch { /* skip */ }
  }

  for (const extPath of getExternalDocs()) {
    try {
      if (!existsSync(extPath)) { unregisterExternalDoc(extPath); continue; }
      const mtime = statSync(extPath).mtime;
      const raw = readFileSync(extPath, 'utf-8');
      allFiles.push({ filename: extPath, path: extPath, raw, mtime });
    } catch { /* skip */ }
  }

  const results: SearchResult[] = [];
  const wsTitles = getWorkspaceTitleMap();

  for (const file of allFiles) {
    const { data, content } = matter(file.raw);
    const title = resolveListingTitle({ fmTitle: data.title, workspaceTitle: wsTitles.get(file.filename), content, filename: file.filename });
    const trimmed = content.trim();
    const isArchived = !!data.archivedAt;

    // Skip archived unless requested
    if (isArchived && !includeArchived) continue;

    // Skip empty temp files (not active)
    if (file.filename.startsWith(TEMP_PREFIX) && !trimmed && file.path !== currentPath) continue;

    const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
    const isActive = file.path === currentPath;
    const tags: string[] = Array.isArray(data.tags) ? data.tags : [];

    const base = { filename: file.filename, title, lastModified: file.mtime.toISOString(), wordCount, isActive, isArchived };

    // Title match
    if (title.toLowerCase().includes(q)) {
      results.push({ ...base, matchType: 'title', snippet: null, matchedTag: null });
      continue; // Only best match type per doc
    }

    // Tag match
    const matchedTag = tags.find(t => t.toLowerCase().includes(q));
    if (matchedTag) {
      results.push({ ...base, matchType: 'tag', snippet: null, matchedTag });
      continue;
    }

    // Content match
    const lowerContent = content.toLowerCase();
    const idx = lowerContent.indexOf(q);
    if (idx !== -1) {
      // ~80 char snippet around match
      const start = Math.max(0, idx - 30);
      const end = Math.min(content.length, idx + q.length + 50);
      let snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      results.push({ ...base, matchType: 'content', snippet, matchedTag: null });
    }
  }

  // Sort: active first, then title > tag > content, within each group by mtime desc
  // Archived results sort after active results
  const typeOrder = { title: 0, tag: 1, content: 2 };
  results.sort((a, b) => {
    // Archived always after active
    if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
    const typeDiff = typeOrder[a.matchType] - typeOrder[b.matchType];
    if (typeDiff !== 0) return typeDiff;
    return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
  });

  return results;
}

export function switchDocument(filename: string): { document: PadDocument; title: string; filename: string } {
  const tStart = performance.now();
  const prevFilename = getActiveFilename();

  // No-op if already on this document — avoids save/reload cycle that can clear editor content
  if (filename === prevFilename) {
    diagLog(`[Switch] NOOP ${filename} (${(performance.now() - tStart).toFixed(1)}ms)`);
    return { document: getDocument(), title: getTitle(), filename };
  }

  // Cancel any pending debounced save, then save current doc immediately.
  cancelDebouncedSave();
  const tSaveStart = performance.now();
  save();
  const tSaveEnd = performance.now();

  // Cache current doc before switching (preserves node IDs)
  cacheActiveDocument();
  const tCacheEnd = performance.now();

  // Reset version counter — new document starts a fresh version lineage
  resetDocVersion();

  // Read target from disk — markdownToTiptap rehydrates pending state
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) {
    throw new Error(`Document not found: ${filename}`);
  }

  // Register external docs so they appear in listings
  if (isExternalDoc(filename)) {
    registerExternalDoc(targetPath);
  }

  // Check cache first — preserves stable node IDs across switches
  const cached = getCachedDocument(targetPath);
  if (cached) {
    setActiveDocument(cached.document, cached.title, targetPath, cached.isTemp, cached.lastModified, cached.metadata, cached.originalFrontmatter);
    const tEnd = performance.now();
    diagLog(`[Switch] ${prevFilename} → ${filename} CACHE-HIT total=${(tEnd - tStart).toFixed(1)}ms save=${(tSaveEnd - tSaveStart).toFixed(1)}ms cache=${(tCacheEnd - tSaveEnd).toFixed(1)}ms setActive=${(tEnd - tCacheEnd).toFixed(1)}ms`);
    return { document: getDocument(), title: getTitle(), filename };
  }

  const tReadStart = performance.now();
  const raw = readFileSync(targetPath, 'utf-8');
  const tReadEnd = performance.now();
  const parsed = markdownToTiptap(raw);
  const tParseEnd = performance.now();
  const mtime = new Date(statSync(targetPath).mtimeMs);

  // Ensure docId exists on loaded doc metadata (lazy migration)
  ensureDocId(parsed.metadata);

  const baseName = targetPath.split(/[/\\]/).pop() || '';
  setActiveDocument(parsed.document, parsed.title, targetPath, baseName.startsWith(TEMP_PREFIX), mtime, parsed.metadata, parsed.rawFrontmatter);
  const tEnd = performance.now();
  diagLog(`[Switch] ${prevFilename} → ${filename} CACHE-MISS total=${(tEnd - tStart).toFixed(1)}ms save=${(tSaveEnd - tSaveStart).toFixed(1)}ms cache=${(tCacheEnd - tSaveEnd).toFixed(1)}ms read=${(tReadEnd - tReadStart).toFixed(1)}ms parse=${(tParseEnd - tReadEnd).toFixed(1)}ms setActive=${(tEnd - tParseEnd).toFixed(1)}ms`);
  return { document: getDocument(), title: getTitle(), filename };
}

export function createDocument(title?: string, content?: string | PadDocument, path?: string): { document: PadDocument; title: string; filename: string } {
  // Cancel any pending debounced save, then save current doc immediately
  cancelDebouncedSave();
  save();

  // Cache current doc before switching to new one
  cacheActiveDocument();

  const docTitle = title || 'Untitled';
  let filePath: string;
  let isTemp: boolean;
  let filename: string;

  if (path) {
    // External path — create file at the specified location
    filePath = path;
    isTemp = false;
    filename = path; // Full path as identifier for external docs
    registerExternalDoc(path);
    // Ensure parent directory exists
    const dir = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } else {
    isTemp = !title;
    if (isTemp) {
      filePath = tempFilePath();
    } else {
      filePath = filePathForTitle(docTitle);
      // Deduplicate: append counter if file already exists
      if (existsSync(filePath)) {
        let counter = 2;
        while (existsSync(filePathForTitle(`${docTitle} ${counter}`))) counter++;
        filePath = filePathForTitle(`${docTitle} ${counter}`);
      }
    }
    filename = filePath.split(/[/\\]/).pop()!;
  }

  let newDoc: PadDocument;
  if (content) {
    if (typeof content === 'string') {
      // Markdown string → TipTap JSON
      newDoc = { type: 'doc', content: parseMarkdownContent(content) };
    } else {
      // Already TipTap JSON
      newDoc = content;
    }
  } else {
    newDoc = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: generateNodeId() }, content: [] }] };
  }

  const metadata: Record<string, any> = { title: docTitle, docId: generateNodeId() };
  setActiveDocument(newDoc, docTitle, filePath, isTemp, undefined, metadata);

  // Write doc to disk
  const { markdown } = tiptapToMarkdownChecked(newDoc, docTitle, metadata);
  ensureDataDir();
  atomicWriteFileSync(filePath, markdown);

  // Prepend to doc order so new docs appear at top and stay put after edits
  const order = readDocOrder();
  const fn = filePath.split(/[/\\]/).pop()!;
  if (!order.includes(fn)) {
    order.unshift(fn);
    writeDocOrder(order);
  }

  return { document: getDocument(), title: getTitle(), filename };
}

/**
 * Create a new document file on disk WITHOUT switching the active document.
 * Used by the two-step creation flow (create_document → populate_document)
 * so the user's editor isn't hijacked during agent content generation.
 * The file is written with agentCreated: true in frontmatter.
 */
export function createDocumentFile(title?: string, path?: string, extraMeta?: Record<string, any>): { filename: string; docId: string; title: string } {
  const docTitle = title || 'Untitled';
  let filePath: string;
  let filename: string;

  if (path) {
    filePath = path;
    filename = path;
    registerExternalDoc(path);
    const dir = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } else {
    if (!title) {
      filePath = tempFilePath();
    } else {
      filePath = filePathForTitle(docTitle);
      if (existsSync(filePath)) {
        let counter = 2;
        while (existsSync(filePathForTitle(`${docTitle} ${counter}`))) counter++;
        filePath = filePathForTitle(`${docTitle} ${counter}`);
      }
    }
    filename = filePath.split(/[/\\]/).pop()!;
  }

  const newDoc: PadDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: generateNodeId() }, content: [] }] };
  // No `agentCreated: true` in metadata — stub status is in-memory only.
  // adr: adr/agent-stub-model.md
  const metadata: Record<string, any> = { title: docTitle, docId: generateNodeId(), ...extraMeta };

  const { markdown } = tiptapToMarkdownChecked(newDoc, docTitle, metadata);
  ensureDataDir();
  atomicWriteFileSync(filePath, markdown);

  // Mark this filename as a fresh agent stub. Process-lifetime only — any
  // accepted content via subsequent save graduates it out of the set, and a
  // server restart naturally forgets stub status (a stub that survives a
  // restart is by definition no longer fresh).
  markAsAgentStub(filename);

  // Prepend to doc order so new docs appear at top and stay put after edits
  const order = readDocOrder();
  const fn = filePath.split(/[/\\]/).pop()!;
  if (!order.includes(fn)) {
    order.unshift(fn);
    writeDocOrder(order);
  }

  return { filename, docId: metadata.docId, title: docTitle };
}

export async function deleteDocument(filename: string): Promise<{ switched: boolean; newDoc?: { document: PadDocument; title: string; filename: string } }> {
  ensureDataDir();
  const targetPath = resolveDocPath(filename);

  // Invalidate cache for deleted doc
  invalidateDocCache(targetPath);

  // Remove stub status for the deleted filename so a future recreate with
  // the same name doesn't inherit the prior stub flag.
  unmarkAgentStub(filename);

  // Unregister if external
  if (isExternalDoc(filename)) {
    unregisterExternalDoc(targetPath);
  }

  const allDocs = readdirSync(getDataDir()).filter((f) => f.endsWith('.md'));
  if (allDocs.length <= 1) {
    throw new Error('Cannot delete the only document');
  }

  const isDeletingActive = targetPath === getFilePath();

  // Capture the sidebar's flat order BEFORE the file is trashed, so a
  // delete-of-the-active-doc can land the switch on the doc ADJACENT to the one
  // removed (least-jarring — the view barely moves). The prior behavior switched
  // to the globally newest-by-mtime doc, which flung the editor + filetree across
  // the workspace to an unrelated doc. Only needed when deleting the active doc.
  const orderedBefore = isDeletingActive
    ? (() => { try { return listDocuments().map((d) => d.filename); } catch { return [] as string[]; } })()
    : [];

  // Read docId BEFORE deleting the file so we can retire its overlay sidecar
  // in lockstep. The sidecar's lifecycle is bound to the docId's existence in
  // the workspace; delete retires the docId, archive does not.
  // adr: adr/pending-overlay-model.md
  let docIdToRetire = '';
  if (existsSync(targetPath)) {
    try {
      const raw = readFileSync(targetPath, 'utf-8');
      const { data } = matter(raw);
      if (typeof data?.docId === 'string') docIdToRetire = data.docId;
    } catch { /* best-effort */ }
  }

  if (!isExternalDoc(filename) && existsSync(targetPath)) {
    await trash(targetPath);
  }

  if (docIdToRetire) deleteOverlay(docIdToRetire);

  if (isDeletingActive) {
    // Prefer the doc adjacent to the deleted one in sidebar order — previous
    // sibling first, then next. Falls back to newest-by-mtime only if the order
    // lookup comes up empty (e.g. manifest missing), preserving old behavior.
    let nextName: string | null = null;
    const idx = orderedBefore.indexOf(filename);
    if (idx >= 0) {
      for (let i = idx - 1; i >= 0; i--) { if (orderedBefore[i] !== filename) { nextName = orderedBefore[i]; break; } }
      if (!nextName) {
        for (let i = idx + 1; i < orderedBefore.length; i++) { if (orderedBefore[i] !== filename) { nextName = orderedBefore[i]; break; } }
      }
    }

    let nextPath: string | null = null;
    if (nextName) {
      const p = resolveDocPath(nextName);
      if (existsSync(p)) nextPath = p;
    }
    if (!nextPath) {
      const remaining = readdirSync(getDataDir())
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ name: f, path: join(getDataDir(), f), mtime: statSync(join(getDataDir(), f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (remaining.length > 0) { nextName = remaining[0].name; nextPath = remaining[0].path; }
    }

    if (nextPath && nextName) {
      const nextBase = nextPath.split(/[/\\]/).pop() || nextName;
      const raw = readFileSync(nextPath, 'utf-8');
      const parsed = markdownToTiptap(raw);
      const mtime = statSync(nextPath).mtimeMs;
      setActiveDocument(parsed.document, parsed.title, nextPath, nextBase.startsWith(TEMP_PREFIX), new Date(mtime), parsed.metadata, undefined);
      return { switched: true, newDoc: { document: getDocument(), title: getTitle(), filename: nextName } };
    }
  }

  return { switched: false };
}

export function reloadDocument(): { document: PadDocument; title: string; filename: string } {
  const filePath = getFilePath();
  if (!existsSync(filePath)) {
    throw new Error('Active document file not found on disk');
  }

  // Force fresh parse — invalidate any cached version
  invalidateDocCache(filePath);
  const filename = filePath.split(/[/\\]/).pop()!;
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = markdownToTiptap(raw);
  const mtime = new Date(statSync(filePath).mtimeMs);

  setActiveDocument(parsed.document, parsed.title, filePath, filename.startsWith(TEMP_PREFIX), mtime, parsed.metadata, undefined);
  return { document: getDocument(), title: getTitle(), filename };
}

export function updateDocumentTitle(filename: string, newTitle: string): void {
  ensureDataDir();
  const filePath = resolveDocPath(filename);
  if (!existsSync(filePath)) {
    throw new Error(`Document not found: ${filename}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const parsed = markdownToTiptap(raw);
  const metadata = { ...parsed.metadata, title: newTitle };
  const { markdown } = tiptapToMarkdownChecked(parsed.document, newTitle, metadata);
  atomicWriteFileSync(filePath, markdown);

  // Update state if this is the active document
  const baseName = filePath.split(/[/\\]/).pop() || '';
  if (getFilePath() === filePath) {
    setActiveDocument(getDocument(), newTitle, filePath, baseName.startsWith(TEMP_PREFIX), undefined, metadata);
  }
}

// ============================================================================
// PENDING TITLE STAGING (agent-initiated renames gated through pending review)
// ============================================================================
//
// Agent-side renames (MCP rename_item, set_metadata with a title field) route
// here instead of calling updateDocumentTitle directly. The proposal lands in
// the per-doc sidecar's `metadata:` slot; the .md file's frontmatter is
// unchanged on disk; the user accepts or rejects via the title-bar inline
// diff. User-typed renames (HTTP PUT /api/documents/:filename) and creation-
// time titling (populate_document) still write hot — they're the user
// disposing, not the agent proposing.
//
// adr: adr/pending-overlay-model.md

/** Read the canonical current title for a doc without loading it into state.
 *  Active doc → in-memory; otherwise → parse the .md frontmatter from disk. */
function readCanonicalTitle(docId: string, filename: string): string {
  if (getActiveDocId() === docId) {
    return getTitle();
  }
  const filePath = resolveDocPath(filename);
  if (!existsSync(filePath)) {
    throw new Error(`Document not found: ${filename}`);
  }
  const raw = readFileSync(filePath, 'utf-8');
  const { data } = matter(raw);
  return (data.title as string) || filename.replace(/\.md$/i, '');
}

/** Stage a pending title rename for the doc identified by `docId`. Writes
 *  to the sidecar (and to state.pendingMetadata when the doc is active).
 *  Does NOT touch the .md file on disk. Returns the resolved {from, to}
 *  pair for the caller's response message. */
export function stagePendingTitle(docId: string, newTitle: string): { from: string; to: string; filename: string } {
  const filename = filenameByDocId(docId);
  if (!filename) {
    throw new Error(`Document not found: ${docId}`);
  }
  const from = readCanonicalTitle(docId, filename);

  // Idempotency: if the proposal equals canonical, clear any pending entry
  // and return — nothing to review.
  if (newTitle === from) {
    if (getActiveDocId() === docId) {
      setActivePendingMetadata(null);
    } else {
      savePendingMetadata(docId, null);
    }
    return { from, to: newTitle, filename };
  }

  const meta: PendingMetadata = {
    title: { from, to: newTitle, addedAtVersion: getDocVersion() },
  };
  if (getActiveDocId() === docId) {
    setActivePendingMetadata(meta);
  } else {
    savePendingMetadata(docId, meta);
  }
  diagLog(`[Overlay] PENDING-TITLE STAGE docId=${docId} from="${from}" to="${newTitle}"`);
  return { from, to: newTitle, filename };
}

/** Accept a staged title rename — promote it to canonical (writes through
 *  updateDocumentTitle) and clear the pending entry. Returns the {from, to}
 *  applied, or null if no pending title was staged for this doc. */
export function acceptPendingTitle(docId: string): { from: string; to: string; filename: string } | null {
  const filename = filenameByDocId(docId);
  if (!filename) return null;
  const meta = (getActiveDocId() === docId)
    ? getActivePendingMetadata()
    : loadPendingMetadata(docId);
  if (!meta?.title) return null;
  const { from, to } = meta.title;

  // Order matters: clear pending FIRST so updateDocumentTitle's downstream
  // setActiveDocument re-rehydration sees an empty sidecar metadata slot.
  if (getActiveDocId() === docId) {
    setActivePendingMetadata(null);
  } else {
    savePendingMetadata(docId, null);
  }
  updateDocumentTitle(filename, to);
  diagLog(`[Overlay] PENDING-TITLE ACCEPT docId=${docId} from="${from}" to="${to}"`);
  return { from, to, filename };
}

/** Reject a staged title rename — discard the proposal without modifying
 *  the .md file. Returns the {from, to} that was discarded, or null if no
 *  pending title was staged. */
export function rejectPendingTitle(docId: string): { from: string; to: string; filename: string } | null {
  const filename = filenameByDocId(docId);
  if (!filename) return null;
  const meta = (getActiveDocId() === docId)
    ? getActivePendingMetadata()
    : loadPendingMetadata(docId);
  if (!meta?.title) return null;
  const { from, to } = meta.title;

  if (getActiveDocId() === docId) {
    setActivePendingMetadata(null);
  } else {
    savePendingMetadata(docId, null);
  }
  diagLog(`[Overlay] PENDING-TITLE REJECT docId=${docId} from="${from}" to="${to}"`);
  return { from, to, filename };
}

/** Lookup helper: read the currently-staged pending title for a docId, or
 *  null if no proposal exists. Active doc → in-memory; otherwise → sidecar. */
export function getPendingTitle(docId: string): { from: string; to: string; addedAtVersion: number } | null {
  const meta = (getActiveDocId() === docId)
    ? getActivePendingMetadata()
    : loadPendingMetadata(docId);
  return meta?.title ?? null;
}

/** Open an existing file from any path. Saves current doc, registers as external, sets as active.
 *
 *  Canonicalizes the input path at the boundary so opening the same physical
 *  file via different spellings (forward/back slash, drive-letter case,
 *  symlink) hits the same doc identity — same cache slot, same watcher
 *  subscription, same pending overlay.
 *  adr: adr/path-canonicalization.md */
export function openFile(fullPath: string): { document: PadDocument; title: string; filename: string } {
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  const canonPath = canonicalizePath(fullPath);

  // Cancel any pending debounced save, then save current doc immediately
  cancelDebouncedSave();
  save();

  // Cache current doc before switching
  cacheActiveDocument();

  // Register as external if not in getDataDir()
  if (isExternalDoc(canonPath)) {
    registerExternalDoc(canonPath);
  }

  // Check cache first — preserves stable node IDs
  const cached = getCachedDocument(canonPath);
  if (cached) {
    setActiveDocument(cached.document, cached.title, canonPath, cached.isTemp, cached.lastModified, cached.metadata, cached.originalFrontmatter);
    const filename = isExternalDoc(canonPath) ? canonPath : (canonPath.split(/[/\\]/).pop() || '');
    return { document: getDocument(), title: getTitle(), filename };
  }

  const raw = readFileSync(canonPath, 'utf-8');
  const parsed = markdownToTiptap(raw);
  const mtime = new Date(statSync(canonPath).mtimeMs);

  ensureDocId(parsed.metadata);

  // Title fallback: use filename stem instead of "Untitled" for files without a title
  let title = parsed.title;
  if (title === 'Untitled') {
    const stem = canonPath.split(/[/\\]/).pop()?.replace(/\.md$/i, '');
    if (stem) title = stem;
  }

  const baseName = canonPath.split(/[/\\]/).pop() || '';
  setActiveDocument(parsed.document, title, canonPath, baseName.startsWith(TEMP_PREFIX), mtime, parsed.metadata, parsed.rawFrontmatter);

  // Use full path as filename for external docs, basename for getDataDir() docs
  const filename = isExternalDoc(canonPath) ? canonPath : baseName;
  return { document: getDocument(), title: getTitle(), filename };
}

export function duplicateDocument(
  filename: string,
  variant?: { masterDocId?: string; variantType?: string },
): { document: PadDocument; title: string; filename: string } {
  // Cancel any pending debounced save, then save current doc immediately
  cancelDebouncedSave();
  save();

  const sourcePath = resolveDocPath(filename);
  if (!existsSync(sourcePath)) {
    throw new Error(`Document not found: ${filename}`);
  }

  const raw = readFileSync(sourcePath, 'utf-8');
  const parsed = markdownToTiptap(raw);

  // Title suffix: variants read as "(Tweet)" / "(Blog)", plain copies as "(Copy)".
  const suffix = variant?.variantType
    ? variant.variantType.charAt(0).toUpperCase() + variant.variantType.slice(1)
    : 'Copy';

  // Generate deduplicated title
  let newTitle = `${parsed.title} (${suffix})`;
  let filePath = filePathForTitle(newTitle);
  if (existsSync(filePath)) {
    let counter = 2;
    while (existsSync(filePathForTitle(`${parsed.title} (${suffix} ${counter})`))) counter++;
    newTitle = `${parsed.title} (${suffix} ${counter})`;
    filePath = filePathForTitle(newTitle);
  }

  const metadata: Record<string, any> = { ...parsed.metadata, title: newTitle, docId: generateNodeId() };
  // Variant relationship — set AFTER the spread so it overrides any inherited
  // masterDocId/variantType from the source doc. masterDocId points at the
  // source (the master); variantType labels this copy's intended format.
  // adr: docs/variants.md
  if (variant?.masterDocId) metadata.masterDocId = variant.masterDocId;
  if (variant?.variantType) metadata.variantType = variant.variantType;
  setActiveDocument(parsed.document, newTitle, filePath, false, undefined, metadata);

  const { markdown } = tiptapToMarkdownChecked(parsed.document, newTitle, metadata);
  ensureDataDir();
  atomicWriteFileSync(filePath, markdown);

  const newFilename = filePath.split(/[/\\]/).pop()!;
  return { document: getDocument(), title: getTitle(), filename: newFilename };
}

// Content types that surface an editable title/headline above the body. For
// these, the doc's frontmatter `title` IS content (blog headline, article title,
// newsletter subject). For every other type the title is just a sidebar label
// and the body carries everything. adr: docs/variants.md
const TITLE_BEARING_TYPES = new Set(['blog', 'article', 'newsletter']);

/**
 * Create a variant of `masterFilename` retyped as `variantType`, nested under
 * the master. Field-projection model (NOT a verbatim clone — that's
 * duplicateDocument): port the fields the two types share.
 *  - body: always ported.
 *  - downcast (title-bearing master → body-only variant): the master's title is
 *    folded into the body as its first paragraph so the headline isn't lost.
 *  - the variant is scaffolded with the TARGET type's content_type + context;
 *    the source's context objects (blogContext, tweetContext, …) are NOT
 *    inherited — a variant is a new typed doc, not a surface clone.
 * adr: docs/variants.md
 */
export function createVariant(
  masterFilename: string,
  opts: { masterDocId: string; variantType: string },
): { document: PadDocument; title: string; filename: string } {
  cancelDebouncedSave();
  save();

  const sourcePath = resolveDocPath(masterFilename);
  if (!existsSync(sourcePath)) throw new Error(`Document not found: ${masterFilename}`);

  const raw = readFileSync(sourcePath, 'utf-8');
  const parsed = markdownToTiptap(raw);
  const srcType = deriveContentType(parsed.metadata) || 'document';
  const tgtType = opts.variantType;
  const srcTitleBearing = TITLE_BEARING_TYPES.has(srcType);
  const tgtTitleBearing = TITLE_BEARING_TYPES.has(tgtType);

  // Body projection. Downcast (title-bearing → body-only): prepend the master's
  // title as the first paragraph so the headline survives in a surface with no
  // title field ("title becomes first line, body the next paragraph"). Otherwise
  // the body ports unchanged.
  let bodyContent = parsed.document.content || [];
  if (srcTitleBearing && !tgtTitleBearing && parsed.title) {
    bodyContent = [
      { type: 'paragraph', content: [{ type: 'text', text: parsed.title }] },
      ...bodyContent,
    ];
  }
  const bodyDoc = { ...parsed.document, content: bodyContent } as PadDocument;

  // Title is always label-suffixed: it doubles as the filename + sidebar name,
  // so it must stay unique vs the master (a raw duplicate title would collide).
  // The title CONTENT still rides along for title-bearing targets — they render
  // it as the headline and the user trims the suffix.
  const Label = tgtType.charAt(0).toUpperCase() + tgtType.slice(1);
  let newTitle = `${parsed.title} (${Label})`;
  let filePath = filePathForTitle(newTitle);
  if (existsSync(filePath)) {
    let counter = 2;
    while (existsSync(filePathForTitle(`${parsed.title} (${Label} ${counter})`))) counter++;
    newTitle = `${parsed.title} (${Label} ${counter})`;
    filePath = filePathForTitle(newTitle);
  }

  // Fresh metadata: target type scaffold + variant relationship only. Source
  // context objects are intentionally dropped (see header).
  const metadata: Record<string, any> = {
    title: newTitle,
    docId: generateNodeId(),
    ...(resolveTypeMeta(tgtType) || {}),
    masterDocId: opts.masterDocId,
    variantType: tgtType,
  };

  setActiveDocument(bodyDoc, newTitle, filePath, false, undefined, metadata);
  const { markdown } = tiptapToMarkdownChecked(bodyDoc, newTitle, metadata);
  ensureDataDir();
  atomicWriteFileSync(filePath, markdown);

  const newFilename = filePath.split(/[/\\]/).pop()!;
  return { document: getDocument(), title: getTitle(), filename: newFilename };
}

export function getActiveFilename(): string {
  const filePath = getFilePath();
  // For external docs, return the full path as the identifier
  if (isExternalDoc(filePath)) return filePath;
  return filePath.split(/[/\\]/).pop() || '';
}

/**
 * Promote a temp file (_untitled-xxx.md) to a named file when the title is set.
 * Renames the file on disk, updates state, workspace refs, marks sidecar, and caches.
 * Returns the new filename, or null if not applicable (not temp, or title is 'Untitled').
 */
export function promoteTempFile(newTitle: string): string | null {
  if (!getIsTemp() || !newTitle || newTitle === 'Untitled') return null;

  const oldPath = getFilePath();
  const oldFilename = oldPath.split(/[/\\]/).pop() || '';
  if (!oldFilename || !existsSync(oldPath)) return null;

  // Generate new path with dedup
  let newPath = filePathForTitle(newTitle);
  if (existsSync(newPath)) {
    let counter = 2;
    while (existsSync(filePathForTitle(`${newTitle} ${counter}`))) counter++;
    newPath = filePathForTitle(`${newTitle} ${counter}`);
  }
  const newFilename = newPath.split(/[/\\]/).pop()!;

  // Rename on disk
  renameSync(oldPath, newPath);

  // Update state
  setActiveDocument(getDocument(), newTitle, newPath, false, undefined, getMetadata());

  // Invalidate old caches
  removePendingCacheEntry(oldFilename);
  invalidateDocCache(oldPath);

  // Carry the agent-stub flag across the rename (if the doc was still a
  // fresh stub when renamed — uncommon but possible). The Set is keyed by
  // filename, so we must transfer the entry to the new key.
  // adr: adr/agent-stub-model.md
  if (isAgentStub(oldFilename)) {
    unmarkAgentStub(oldFilename);
    markAsAgentStub(newFilename);
  }

  // Update workspace references
  renameDocInAllWorkspaces(oldFilename, newFilename, newTitle);

  // Rename comments sidecar
  renameComments(oldFilename, newFilename);

  return newFilename;
}

// ============================================================================
// BATCH RESOLVE — accept/reject pending changes across multiple docs
// ============================================================================

const PENDING_ATTRS = ['pendingStatus', 'pendingOriginalContent', 'pendingGroupId', 'pendingSelectionFrom', 'pendingSelectionTo', 'pendingOriginalFrom', 'pendingOriginalTo'];

function clearPendingAttrs(attrs: Record<string, any>): Record<string, any> {
  const clean = { ...attrs };
  for (const key of PENDING_ATTRS) delete clean[key];
  return clean;
}

/** Walk TipTap JSON, accept all pending changes in-place. Returns count of resolved nodes. */
function acceptAllInDoc(doc: any): number {
  let count = 0;
  function walk(nodes: any[]): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      const status = node.attrs?.pendingStatus;
      if (status === 'delete') {
        count++;
        continue; // Remove delete nodes
      }
      if (status === 'insert' || status === 'rewrite') {
        node.attrs = clearPendingAttrs(node.attrs);
        count++;
      }
      if (node.content) {
        node.content = walk(node.content);
      }
      result.push(node);
    }
    return result;
  }
  if (doc.content) doc.content = walk(doc.content);
  return count;
}

/** Walk TipTap JSON, reject all pending changes in-place. Returns count of resolved nodes. */
function rejectAllInDoc(doc: any): number {
  let count = 0;
  function walk(nodes: any[]): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      const status = node.attrs?.pendingStatus;
      if (status === 'insert') {
        count++;
        continue; // Remove inserted nodes
      }
      if (status === 'rewrite') {
        const original = node.attrs?.pendingOriginalContent;
        if (original) {
          // Replace with original content
          result.push(original);
        }
        // If no original, just drop the node
        count++;
        continue;
      }
      if (status === 'delete') {
        // Keep the node, just clear pending status
        node.attrs = clearPendingAttrs(node.attrs);
        count++;
      }
      if (node.content) {
        node.content = walk(node.content);
      }
      result.push(node);
    }
    return result;
  }
  if (doc.content) doc.content = walk(doc.content);
  return count;
}

/** Resolve a single doc file on disk. Returns number of changes resolved. */
function resolveDocFile(filePath: string, action: 'accept' | 'reject'): number {
  const raw = readFileSync(filePath, 'utf-8');
  const { data } = matter(raw);

  // Skip docs with no pending changes
  if (!data.pending) return 0;

  // Pass full raw file — markdownToTiptap calls matter() internally and rehydrates pending state
  const parsed = markdownToTiptap(raw);
  const doc = parsed.document;

  const count = action === 'accept' ? acceptAllInDoc(doc) : rejectAllInDoc(doc);
  if (count === 0) return 0;

  // Re-serialize — pending attrs are cleared so pending key will be removed from frontmatter
  const { markdown: newRaw } = tiptapToMarkdownChecked(doc, parsed.title, parsed.metadata);
  atomicWriteFileSync(filePath, newRaw);

  return count;
}

export function batchResolve(filenames: string[], action: 'accept' | 'reject'): { docsResolved: number; changesResolved: number } {
  let docsResolved = 0;
  let changesResolved = 0;

  for (const filename of filenames) {
    const filePath = isExternalDoc(filename) ? filename : join(getDataDir(), filename);
    if (!existsSync(filePath)) continue;

    try {
      const count = resolveDocFile(filePath, action);
      if (count > 0) {
        docsResolved++;
        changesResolved += count;
        // Active doc: update in-memory state directly (no reload flicker)
        if (filePath === getFilePath()) {
          const currentDoc = getDocument();
          if (action === 'accept') acceptAllInDoc(currentDoc);
          else rejectAllInDoc(currentDoc);
          save();
        }
      }
    } catch { /* skip unreadable files */ }
  }

  return { docsResolved, changesResolved };
}
