/**
 * File-backed document state for OpenWriter.
 * Each document is a .md file in ~/.openwriter/ with YAML frontmatter.
 * Title lives in frontmatter metadata. Filenames are stable identifiers.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, utimesSync, watch, type Stats, type FSWatcher } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { tiptapToMarkdown, tiptapToMarkdownChecked, tiptapToBody, markdownToTiptap } from './markdown.js';
import { applyTextEditsToNode, type TextEdit } from './text-edit.js';
import { getDataDir, TEMP_PREFIX, ensureDataDir, filePathForTitle, tempFilePath, generateNodeId, LEAF_BLOCK_TYPES, resolveDocPath, isExternalDoc, atomicWriteFileSync, canonicalizePath, canonicalizeIdentifier, type CanonPath } from './helpers.js';
import { snapshotIfNeeded, ensureDocId, forceSnapshot } from './versions.js';
import { captureAttribution, bindBlameToVersion, type Actor } from './attribution.js';
import { scheduleAgentCommit } from './commits.js';
import { syncReferencesFromProse, invalidateBacklinksCache, writeFrontmatter } from './backlinks.js';
import { isAutoAcceptInheritedForDoc } from './workspaces.js';
import { matchNodes, type NodeEntry } from './node-matcher.js';
import { tiptapToBlocks, applyIdsToTiptap } from './node-blocks.js';
import { type Fingerprint, anyLegacyRaw } from './node-fingerprint.js';
import { markdownToNodes, resolvePreviousNodes, resolveGraveyard } from './markdown-parse.js';
import { extractOverlay, applyOverlayPure, splitMergedDoc, reconcileCanonicalToBaselines, saveOverlay, loadOverlay, loadDocFromDisk, deleteOverlay, clearAllOverlays, migrateLegacyPending, repairOverlaysOnStartup, diagLog, type PendingEntry } from './pending-overlay.js';
import { loadPendingMetadata, savePendingMetadata, type PendingMetadata } from './pending-metadata.js';
import { harvestSentenceHashes, harvestCharCount, isEnrichmentStale } from './enrichment.js';
import { clearActivityBuffer } from './activity-log.js';
import { titleFromDoc, shouldAutoTitle } from './title-from-body.js';
import { mergeBrowserState } from './browser-state-merge.js';

/** Read the persisted identity graph (nodes + graveyard) from a file's
 *  frontmatter. The save-time matcher reads previousNodes + graveyard
 *  directly from disk every write — the disk is the source of truth, not
 *  a parallel in-memory cache.
 *
 *  Slim disk entries are enriched against the freshly-parsed disk body so
 *  derived fields (position, neighbor types, etc.) flow into the rich
 *  Fingerprint the matcher expects. Legacy verbose-object entries are
 *  positionally re-fingerprinted via the same helper.
 *  adr: adr/node-identity-matcher.md */
function readPersistedIdentity(filePath: string): { previousNodes: NodeEntry[]; graveyard: NodeEntry[] } {
  if (!filePath || !existsSync(filePath)) return { previousNodes: [], graveyard: [] };
  try {
    const raw = readFileSync(filePath, 'utf-8');

    // Bypass gray-matter for identity reads. gray-matter caches its parsed
    // `data` object by raw string within a process, so any upstream
    // mutation (test wrappers, dev tools) leaks into the matcher's input
    // on subsequent reads. Identity fields live in a JSON frontmatter
    // block emitted by tiptapToMarkdown — parse it directly so we always
    // see fresh data.
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let rawNodes: any[] = [];
    let rawGraveyard: any[] = [];
    let body = raw;
    if (fmMatch) {
      try {
        const fmObj = JSON.parse(fmMatch[1]);
        if (Array.isArray(fmObj.nodes)) rawNodes = fmObj.nodes;
        if (Array.isArray(fmObj.graveyard)) rawGraveyard = fmObj.graveyard;
      } catch { /* malformed JSON frontmatter — treat as no identity */ }
      body = raw.slice(fmMatch[0].length).replace(/^[\r\n]+/, '');
    }

    // Slim entries derive position/parent/neighbors from the slim array
    // itself — no body parse needed. Legacy entries need positional
    // re-fingerprinting from the body, so we parse it lazily only then.
    // This avoids a full markdown re-parse on every save for the common
    // (ultra-lean) case, which was the dominant cost of switchDocument's
    // pre-switch save() for large docs.
    const needsBodyParse =
      (Array.isArray(rawNodes) && rawNodes.length > 0 && anyLegacyRaw(rawNodes));
    let previousBlocks: any[] = [];
    if (needsBodyParse) {
      const previousDocContent = markdownToNodes(body);
      previousBlocks = tiptapToBlocks({ content: previousDocContent });
    }

    return {
      previousNodes: resolvePreviousNodes(rawNodes, previousBlocks),
      graveyard: resolveGraveyard(rawGraveyard),
    };
  } catch {
    return { previousNodes: [], graveyard: [] };
  }
}

export interface NodeChange {
  operation: 'rewrite' | 'insert' | 'delete';
  nodeId?: string;
  afterNodeId?: string;
  content?: any;
  /** When true, the change committed directly without pending decoration —
   *  client should apply it as a normal edit, not as a pending review item. */
  autoAccept?: boolean;
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
  docId?: string;
  lastSent?: string;  // ISO date — doc was sent/posted
  postedUrl?: string; // URL of posted tweet/thread (X only)
  contentType?: string; // Explicit content_type from frontmatter
  masterDocId?: string; // Parent document ID (variant relationship)
  variantType?: string; // Content type of this variant (blog, tweet, etc.)
  autoAccept?: boolean; // True when this doc bypasses pending-review (agent writes commit directly)
  tags?: string[]; // Document-level tags. Included so the sidebar doesn't have to
                   // re-fetch per-doc tags via N round-trips on initial load — the
                   // server already parsed each doc's frontmatter once in listDocuments.
                   // adr: adr/pending-overlay-model.md
  // ---- Enrichment fields (three-field schema, v0.19.0) ----
  // Each field has exactly one owner; no other actor writes it.
  // See brief 2026-05-21-simplify-enrichment-schema-three-fields.
  /** LLM-owned: one-sentence "what this doc is about". ≤150 chars. Written by
   *  the enrichment minion via mark_enriched. The one field LLMs are strong at:
   *  natural-language inference over a body, drift-resistant. */
  logline?: string;
  /** Agent-owned: lifecycle intent. "canonical" = committed to spine /
   *  load-bearing. "draft" = working / not load-bearing yet / superseded /
   *  scratch. Set on create_document (default "draft") and via set_metadata
   *  on lifecycle transitions (draft → canonical on commit; canonical →
   *  draft when superseded). Archived state lives in archivedAt, not here. */
  status?: 'canonical' | 'draft' | string;
  /** System-owned: openwriter flips to true on save when sentence-hash drift
   *  or char-volume ratio trips its threshold. Cleared atomically by
   *  mark_enriched. Agents read but never write this. */
  enrichmentStale?: boolean;
  // ---- Connection fields (structural, v0.20.0) ----
  // Connections live in frontmatter as docId arrays, not in prose. Body markdown
  // stays clean. Backlinks are computed live (inverse traversal of references
  // across the workspace) — no stored derived field. See brief 2026-05-22-references.
  /** Agent-owned: outbound connections this doc declares. Each entry is an 8-char
   *  docId. Written by link_to (idempotent) or directly via set_metadata. Auto-
   *  populated on save from any legacy prose `doc:` links found in the body
   *  (backward compat — prose links still render, but the structural connection
   *  is what graph/crawl/backlinks-panel read). Dedup'd via Set on every write. */
  references?: string[];
  /** Agent-owned: phrases this doc is the canonical reference for. Used by the
   *  workspace alias index for auto-highlight at render time (deferred — schema
   *  slot exists in v0.20.0; the highlight plugin lands in a later release). */
  aliases?: string[];
  // ---- Sort-request fields ----
  // User-triggered: "I don't know where this should go, sort it for me."
  // Marker lives in frontmatter; the main agent picks pending sorts up via
  // list_pending_sorts and either discusses inline or writes a proposal back
  // for the UI accept/reject flow. Every sort goes through human confirmation
  // — there is no auto-execute mode. (Source-folder trust doesn't transfer to
  // an unknown destination, so a "trust me" preference has no good home.)
  /** User-set marker. Cleared on fulfillment. */
  sortRequest?: {
    requestedAt: string;
    /** Set by the agent after it has picked a destination. Presence flips the
     *  doc's sidebar badge from "pending" to "proposal ready". */
    proposal?: {
      wsFilename: string;
      containerId: string | null;
      reasoning: string;
    };
  };
  /** System-stamped on fulfillment. */
  lastSortedAt?: string;
}

interface PadState {
  // PRIMARY state — the two-actor model the architecture has always
  // implied. Canonical is the parsed disk content (clean markdown, no
  // pending decorations). Overlay is the structured pending state,
  // keyed by nodeId so duplicates are structurally impossible. Every
  // mutation goes through sanctioned helpers (setCanonical,
  // setOverlayEntry, etc.) that update primary state and recompute
  // the merged view.
  // adr: adr/pending-overlay-model.md
  canonical: PadDocument;
  overlay: Map<string, PendingEntry>;
  /** Pending frontmatter changes (currently just title). Mirrored to the
   *  per-doc sidecar's `metadata:` slot so it survives restarts and doc
   *  switches. The canonical `metadata` field above is the on-disk truth;
   *  this slot is what the agent has proposed but the user hasn't accepted.
   *  adr: adr/pending-overlay-model.md */
  pendingMetadata: PendingMetadata | null;
  // DERIVED state — the merged view (canonical + overlay applied).
  // Refreshed by recomputeMerged() after any mutation to canonical
  // or overlay. External readers via getDocument() see this. Direct
  // assignment is a bug — the next recompute will overwrite it.
  document: PadDocument;
  title: string;
  metadata: Record<string, any>;      // All frontmatter fields (including title)
  filePath: CanonPath | '';           // Canonical path of current file on disk (empty before first save)
  isTemp: boolean;                    // True = untitled temp file, cleaned up if empty on close
  lastModified: Date;
  docId: string;                      // 8-char hex ID for version history
  originalFrontmatter: string | null; // Raw frontmatter for external files (preserved verbatim on save)
  // Disk mtime captured at the last load OR successful save. Compared against
  // the live file mtime in writeToDisk to detect external writes that landed
  // between our reads — without this check, the next auto-save silently
  // clobbers the external writer's content. Drives the open_file + external-
  // Write conflict guard.
  loadedMtime: number;
}

type ChangeListener = (changes: NodeChange[], version: number) => void;

/**
 * Save-time matcher can reassign block IDs (the matcher is the authority on
 * identity). Whenever it does, every connected client needs to know — otherwise
 * the browser's in-memory TipTap doc holds the old IDs, future server→browser
 * messages targeting the new IDs silently fail to resolve, and the browser's
 * autosave eventually overwrites server state with stale content. The hotfix
 * matcher guard reduces how often the matcher rewrites in the first place; this
 * listener mechanism handles the residual cases (transient editor-minted IDs,
 * doc-update reconciliation, etc.) so server and browser converge after every
 * save instead of silently diverging.
 *
 * adr: adr/node-identity-matcher.md
 */
export interface IdRewrite { oldId: string; newId: string }
type IdRewriteListener = (rewrites: IdRewrite[]) => void;

const DEFAULT_DOC: PadDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [] }],
};

let state: PadState = {
  canonical: DEFAULT_DOC,
  overlay: new Map(),
  pendingMetadata: null,
  document: DEFAULT_DOC,
  title: 'Untitled',
  metadata: { title: 'Untitled' },
  filePath: '',
  isTemp: true,
  lastModified: new Date(),
  docId: '',
  originalFrontmatter: null,
  loadedMtime: 0,
};

// ============================================================================
// PRIMARY-STATE WRITE HELPERS
// ============================================================================
// All mutations to canonical or overlay go through these helpers. Each updates
// the underlying state AND recomputes state.document so external readers via
// getDocument() see the new merged view. Direct assignment to state.canonical,
// state.overlay, or state.document is forbidden outside this module.
// adr: adr/pending-overlay-model.md

/** Recompute the merged view from primary state. Idempotent — running twice
 *  produces the same result. */
function recomputeMerged(): void {
  state.document = applyOverlayPure(state.canonical, Array.from(state.overlay.values()));
}

/** Replace canonical wholesale. Used by load paths and accept-all flows. */
function setCanonical(doc: PadDocument): void {
  state.canonical = doc;
  recomputeMerged();
}

/** Replace overlay wholesale from an entry array. Dedupes by nodeId
 *  (first occurrence wins; preserves original anchors). Preserves
 *  addedAtVersion from any pre-existing state.overlay entry with the
 *  same nodeId; stamps current docVersion on entries that are new. */
function setOverlayFromEntries(entries: PendingEntry[]): void {
  const currentVersion = getDocVersion();
  const newOverlay = new Map<string, PendingEntry>();
  for (const e of entries) {
    if (newOverlay.has(e.nodeId)) continue;
    const existing = state.overlay.get(e.nodeId);
    const entry = { ...e };
    if (existing?.addedAtVersion !== undefined) {
      entry.addedAtVersion = existing.addedAtVersion;
    } else if (entry.addedAtVersion === undefined) {
      entry.addedAtVersion = currentVersion;
    }
    newOverlay.set(e.nodeId, entry);
  }
  state.overlay = newOverlay;
  recomputeMerged();
}

/** Replace primary state from a merged-shape doc. Splits via splitMergedDoc.
 *  Used by paths that receive a merged doc (browser doc-updates, legacy
 *  on-disk migration). */
function setPrimaryFromMerged(merged: PadDocument): void {
  const { canonical, overlayEntries } = splitMergedDoc(merged);
  state.canonical = canonical;
  setOverlayFromEntries(overlayEntries);
}

/**
 * Browser-write body-fidelity invariant. adr: adr/browser-write-fidelity.md
 *
 * A browser editor surface can mount empty, or parse the canonical body
 * through a NARROWER schema (the X-article / tweet compose extensions),
 * then autosave that lossy view back — collapsing a populated body to
 * empty/near-empty on disk. This is the "autosave-clobber" class: silent
 * data loss the user never authored.
 *
 * The invariant lives at the BROWSER-WRITE BOUNDARY — every function that
 * replaces canonical from a browser-sent doc (`updateDocument`,
 * `syncBrowserDocUpdate`, `saveDocToFile`). It deliberately does NOT live
 * at the disk chokepoint (`writeToDisk`): restore_version, MCP edits, and
 * agent `applyChanges` mutate canonical directly and are TRUSTED to shrink
 * a doc intentionally. Recovery-restores GROW the doc (incoming > current)
 * and so pass freely here too.
 *
 * A replacement that collapses a substantial body (>5 nodes) to under 30%
 * of its node count is a view artifact, not an edit — refuse it.
 */
export function wouldCollapseBody(current: PadDocument | null | undefined, incoming: PadDocument | null | undefined): boolean {
  const currentNodes = current?.content?.length ?? 0;
  const incomingNodes = incoming?.content?.length ?? 0;
  return currentNodes > 5 && incomingNodes < currentNodes * 0.3;
}

/**
 * Checkpoint-then-refuse helper for the active doc. Forces a version
 * snapshot of the current ON-DISK body — still the good content, since the
 * clobbering write is being refused — so it is recoverable under a labeled
 * version even if no prior autosave snapshot happened to retain it.
 */
function checkpointActiveBody(): void {
  const docId = getDocId();
  if (docId && state.filePath) forceSnapshot(docId, state.filePath);
}

/**
 * Sync routing for a stale-version browser doc-update. The browser's
 * submission was captured at server version `browserVersion`; the server
 * has since advanced to a higher version because the agent wrote concurrently.
 *
 * Behavior: the browser's view of canonical is accepted as authoritative.
 * The overlay merges browser's view with server's recent additions: any
 * server overlay entry with addedAtVersion > browserVersion is an agent
 * addition the browser hadn't seen, so it survives. Conflicting nodeIds
 * (both browser and server have entries) → server wins, on the principle
 * that an explicit agent proposal outranks a browser save that didn't see
 * it. The user can reject the server's entry through the normal review UI
 * if they disagree.
 *
 * Replaces the older "BLOCK stale doc-update" behavior — that pattern lost
 * the user's typing without warning. The merge approach preserves both
 * sides' work in the common case (disjoint touches) and surfaces conflicts
 * (same-paragraph touches) via the existing pending-review UI.
 *
 * Returns the count of server overlay entries that were preserved.
 * adr: adr/pending-overlay-model.md
 */
export function syncBrowserDocUpdate(browserDoc: PadDocument, browserVersion: number): { preservedServerEntries: number } {
  // Browser-write fidelity: a STALE-version browser doc-update is the same
  // autosave-clobber class as the current-version path — and this path
  // previously bypassed the guard, writing the empty surface straight to
  // canonical. Refuse + checkpoint here too. adr: adr/browser-write-fidelity.md
  if (wouldCollapseBody(state.document, browserDoc)) {
    checkpointActiveBody();
    console.error(`[State] REFUSED body-collapse in syncBrowserDocUpdate: ${browserDoc?.content?.length ?? 0} nodes would replace ${state.document?.content?.length ?? 0} nodes (checkpointed, write refused)`);
    return { preservedServerEntries: 0 };
  }
  const merged = mergeBrowserState(browserDoc, browserVersion, state.overlay.values());
  // Install through the same mutation boundary as current-version browser
  // edits, including lastModified and docVersion. Otherwise save's no-op gate
  // can silently skip an accepted stale-version edit after metadata changes.
  updateDocument(applyOverlayPure(merged.canonical, merged.entries));
  return { preservedServerEntries: merged.preservedServerEntries };
}

const listeners: Set<ChangeListener> = new Set();
const idRewriteListeners: Set<IdRewriteListener> = new Set();

/**
 * Listener mechanism for external-write conflicts. Fired from writeToDisk
 * when the disk mtime is newer than our stamped loadedMtime — meaning an
 * external tool (Write, an editor, a script) modified the file between our
 * last load/save and this would-be write. Subscribers (ws.ts) broadcast a
 * sync-status warning to connected clients so the user knows to reload.
 *
 * adr: adr/external-write-guard.md
 */
export interface ExternalWriteConflict {
  filePath: string;
  diskMtime: number;
  loadedMtime: number;
}
type ExternalWriteConflictListener = (conflict: ExternalWriteConflict) => void;
const externalWriteConflictListeners: Set<ExternalWriteConflictListener> = new Set();

export function onExternalWriteConflict(listener: ExternalWriteConflictListener): () => void {
  externalWriteConflictListeners.add(listener);
  return () => externalWriteConflictListeners.delete(listener);
}

/**
 * Listener for auto-titling. Fires from `save()` when a doc that still
 * has a default/empty title has been given a derived title from its body.
 * Subscribers (ws.ts) handle the on-disk rename (promoteTempFile) and
 * broadcast the metadata change to clients so the sidebar updates live.
 */
type AutoTitleAppliedListener = (newTitle: string) => void;
const autoTitleAppliedListeners: Set<AutoTitleAppliedListener> = new Set();

export function onAutoTitleApplied(listener: AutoTitleAppliedListener): () => void {
  autoTitleAppliedListeners.add(listener);
  return () => autoTitleAppliedListeners.delete(listener);
}

function notifyAutoTitleApplied(newTitle: string): void {
  for (const listener of autoTitleAppliedListeners) {
    try { listener(newTitle); }
    catch (err) { console.error('[State] auto-title listener threw:', err); }
  }
}

function notifyExternalWriteConflict(filePath: string, diskMtime: number, loadedMtime: number): void {
  for (const listener of externalWriteConflictListeners) {
    try { listener({ filePath, diskMtime, loadedMtime }); }
    catch (err) { console.error('[State] external-write listener threw:', err); }
  }
}

/**
 * Check whether the active doc's on-disk mtime is newer than what we
 * loaded/saved. Returns null when the doc has no file path, the file is
 * gone, or there's no drift. Exposed for the get_pad_status MCP tool so
 * agents can detect "you need to reload_from_disk before your next save"
 * without waiting for the save itself to fail.
 */
export function getExternalMtimeDrift(): { diskMtime: number; loadedMtime: number } | null {
  if (!state.filePath || state.loadedMtime === 0) return null;
  try {
    const diskMtime = statSync(state.filePath).mtimeMs;
    if (diskMtime !== state.loadedMtime) {
      return { diskMtime, loadedMtime: state.loadedMtime };
    }
  } catch { /* file missing */ }
  return null;
}

/** Force-refresh the active doc's loadedMtime snapshot to current disk mtime.
 *  Used by reload_from_disk after re-reading the file, so the freshly
 *  adopted content's mtime becomes our new baseline. */
export function refreshLoadedMtime(): void {
  if (!state.filePath) return;
  try { state.loadedMtime = statSync(state.filePath).mtimeMs; } catch { /* best-effort */ }
}

// ============================================================================
// ACTIVE DOC FILE WATCHER
// ============================================================================
//
// Watches the currently-active doc's file for external writes. When any
// other process (Edit tool, VSCode, a script) mutates the file, fs.watch
// fires; we debounce burst events, verify the disk mtime actually advanced
// past our last-stamped `loadedMtime`, and route through the unified
// reloadActiveDocFromDisk pathway — which re-parses disk, re-attaches the
// pending overlay by nodeId, runs the matcher, and lets subscribers
// broadcast a document-reloaded message to clients.
//
// Why push (fs.watch) instead of pull (mtime poll on writes only):
//   - The browser autosave race was: external editor writes → server's
//     in-memory state is now stale → browser sends an autosave from BEFORE
//     the external write → server's version counter hasn't advanced (no
//     MCP write occurred) → version check passes → stale content clobbers
//     the external write.
//   - The fix is to advance docVersion the instant the file changes on
//     disk, not the instant we try to save. fs.watch makes that immediate.
//
// Single watcher at a time: we only care about the active doc. Switching
// docs tears down the previous watcher and opens a new one.
//
// Cross-platform: Node's fs.watch is inotify on Linux, FSEvents on macOS,
// ReadDirectoryChangesW on Windows. Single-file watching is reliable on
// all three; chokidar would add value for recursive directory trees, not
// here.
//
// adr: adr/active-doc-watcher.md
let activeWatcher: FSWatcher | null = null;
let activeWatcherPath: CanonPath | '' = '';
let watcherDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export interface DocumentReloaded {
  filePath: string;
  filename: string;
  document: PadDocument;
  title: string;
  docId: string;
  metadata: Record<string, any>;
  orphans: PendingEntry[];
  staleBaseline: PendingEntry[];
}
type DocumentReloadedListener = (event: DocumentReloaded) => void;
const documentReloadedListeners: Set<DocumentReloadedListener> = new Set();

export function onDocumentReloaded(listener: DocumentReloadedListener): () => void {
  documentReloadedListeners.add(listener);
  return () => documentReloadedListeners.delete(listener);
}

function notifyDocumentReloaded(event: DocumentReloaded): void {
  for (const listener of documentReloadedListeners) {
    try { listener(event); }
    catch (err) { console.error('[State] document-reloaded listener threw:', err); }
  }
}

/** Tear down the active-doc watcher (if any) and clear bookkeeping. */
function stopActiveDocWatcher(): void {
  if (watcherDebounceTimer) {
    clearTimeout(watcherDebounceTimer);
    watcherDebounceTimer = null;
  }
  if (activeWatcher) {
    try { activeWatcher.close(); } catch { /* best-effort */ }
    activeWatcher = null;
  }
  activeWatcherPath = '';
}

/** Handle a watcher event after debounce — reload if mtime actually advanced. */
function handleWatcherEvent(): void {
  // Only act if the watched path is still the active doc. If the user
  // switched away during the debounce window, drop this event — the new
  // active doc has its own watcher already running.
  if (!state.filePath || state.filePath !== activeWatcherPath) return;

  // Skip if the file is gone (e.g., delete during watch). The next save
  // will re-create it from in-memory state.
  if (!existsSync(state.filePath)) return;

  let diskMtime: number;
  try {
    diskMtime = statSync(state.filePath).mtimeMs;
  } catch {
    return;
  }

  // Filter out events from our own writes. writeToDisk re-stamps
  // state.loadedMtime to the post-write disk mtime, so by the time this
  // handler fires for our own atomicWriteFileSync, mtimes match and we
  // skip. Only genuine external writes have diskMtime > loadedMtime.
  if (diskMtime === state.loadedMtime) return;

  const reloaded = reloadActiveDocFromDisk();
  if (!reloaded) return;

  // (docVersion already bumped inside reloadActiveDocFromDisk — single
  // source of truth for the reload-version-bump.)

  notifyDocumentReloaded({
    filePath: state.filePath,
    filename: reloaded.filename,
    document: reloaded.document,
    title: reloaded.title,
    docId: state.docId,
    metadata: state.metadata,
    orphans: reloaded.orphans,
    staleBaseline: reloaded.staleBaseline,
  });

  const orphanCount = reloaded.orphans.length;
  const staleCount = reloaded.staleBaseline.length;
  const suffix = orphanCount || staleCount
    ? ` (${orphanCount} orphan, ${staleCount} stale-baseline pending entries)`
    : '';
  console.log(`[State] reload active doc from external write: ${reloaded.filename}${suffix}`);
}

/** Start (or restart) the watcher on the active doc's filePath. Called
 *  whenever the active doc changes, or whenever load() lands a file. */
export function startActiveDocWatcher(): void {
  stopActiveDocWatcher();
  if (!state.filePath || !existsSync(state.filePath)) return;

  // Some test environments (Windows CI, ephemeral filesystems) error from
  // fs.watch on transient files. Swallow the failure — we'll simply not
  // have external-write detection for this doc, which is degraded but
  // not broken. writeToDisk still has the loadedMtime guard as a backstop.
  try {
    activeWatcherPath = state.filePath;
    activeWatcher = watch(state.filePath, { persistent: false }, () => {
      // Burst-debounce: editors often write through a temp file + rename,
      // which fires multiple events in rapid succession. 80ms is short
      // enough that human-perceptible latency is unchanged and long
      // enough that one logical save coalesces.
      if (watcherDebounceTimer) clearTimeout(watcherDebounceTimer);
      watcherDebounceTimer = setTimeout(handleWatcherEvent, 80);
    });
    activeWatcher.on('error', (err) => {
      console.error(`[State] active doc watcher error on ${activeWatcherPath}:`, err.message);
      stopActiveDocWatcher();
    });
  } catch (err: any) {
    console.error(`[State] failed to watch ${state.filePath}:`, err?.message || err);
    stopActiveDocWatcher();
  }
}

// ============================================================================
// EXTERNAL DOCUMENT REGISTRY
// ============================================================================

function getExternalDocsFile(): string { return join(getDataDir(), 'external-docs.json'); }

/** External docs registered with openwriter — canonicalized paths only.
 *  Adding via `registerExternalDoc` runs paths through `canonicalizePath`
 *  before insertion, so the same physical file via any spelling
 *  (forward/back slash, mixed case drive letter, symlink) collapses to a
 *  single entry.
 *  adr: adr/path-canonicalization.md */
const externalDocs = new Set<CanonPath>();

// ============================================================================
// AGENT-STUB REGISTRY (in-memory only — never persisted)
// ============================================================================
//
// A doc is an "agent stub" between create_document (which mints an empty
// shell) and populate_document + accept (which fills it with content). If
// the user rejects the populated content, the stub is deleted — the agent
// proposed a doc, the user declined, nothing should remain.
//
// HISTORICAL MISTAKE: stub status was stored as `agentCreated: true` in
// frontmatter on disk. That made it sticky across sessions, server
// restarts, and arbitrary file lifetimes. Any reject-all on a doc whose
// stub status had been forgotten in a previous flow would destructively
// delete a file with hours of accepted work. The fix is not "guard the
// destruction more carefully"; the fix is "don't persist transient
// session state to disk in the first place."
//
// Stub status is now an in-memory Set<filename> with process lifetime.
//   - markAsAgentStub(filename) — called on create_document
//   - unmarkAgentStub(filename) — called on any save that contains
//     non-pending content (graduation), on accept-all, on rename
//   - isAgentStub(filename) — the only thing reject-all-deletes consults
//
// A stub that survives a server restart is by definition no longer fresh.
// It loads from disk like any other doc and reject-all will not delete it.
// This is intentional: graduating-by-lifetime is the safest fallback.
//
// adr: adr/agent-stub-model.md
const agentStubFilenames = new Set<string>();

export function markAsAgentStub(filename: string): void {
  if (filename) agentStubFilenames.add(filename);
}

export function unmarkAgentStub(filename: string): void {
  if (filename) agentStubFilenames.delete(filename);
}

export function isAgentStub(filename: string): boolean {
  return !!filename && agentStubFilenames.has(filename);
}

/** Legacy migration. If a file's frontmatter has `agentCreated: true`, that
 *  field came from the pre-architectural-fix code path. Strip it on load so
 *  we don't keep round-tripping a dead field. No in-memory stub registration
 *  happens — by definition, if the flag survived to disk this long, the doc
 *  is not a fresh stub anymore. */
function stripLegacyAgentCreated(metadata: Record<string, any>): void {
  if (metadata && 'agentCreated' in metadata) delete metadata.agentCreated;
}

/** Strip the legacy `backlinks` field. v0.19 stored derived inbound edges in
 *  frontmatter; v0.20 computes them live from the inverse of `references`
 *  across the workspace. Any save that visits a doc with the stale field drops
 *  it — lazy migration. No data loss because the new `references` field on
 *  source docs is the authoritative inbound source; we can always recompute. */
function stripLegacyBacklinks(metadata: Record<string, any>): void {
  if (metadata && 'backlinks' in metadata) delete metadata.backlinks;
}

function persistExternalDocs(): void {
  try {
    atomicWriteFileSync(getExternalDocsFile(), JSON.stringify([...externalDocs]));
  } catch { /* best-effort */ }
}

/** Load external-doc registry from disk and canonicalize every entry on
 *  the way in. The Set's branded type collapses any pre-existing
 *  duplicates (forward-slash vs backslash entries for the same file)
 *  to one — that's the one-time migration. If canonicalization changed
 *  the on-disk representation, we re-persist so the file matches
 *  in-memory state.
 *  adr: adr/path-canonicalization.md */
function loadExternalDocs(): void {
  try {
    if (!existsSync(getExternalDocsFile())) return;
    const paths: string[] = JSON.parse(readFileSync(getExternalDocsFile(), 'utf-8'));
    let needsRewrite = false;
    for (const p of paths) {
      if (!existsSync(p)) { needsRewrite = true; continue; }
      const canon = canonicalizePath(p);
      if (canon !== p) needsRewrite = true;
      externalDocs.add(canon);
    }
    // If the on-disk file had duplicates or non-canonical entries, the
    // collapsed Set is now smaller and/or different — persist it back.
    if (needsRewrite || externalDocs.size !== paths.length) {
      persistExternalDocs();
    }
  } catch { /* corrupt file — start fresh */ }
}

export function registerExternalDoc(fullPath: string): void {
  externalDocs.add(canonicalizePath(fullPath));
  persistExternalDocs();
}

export function unregisterExternalDoc(fullPath: string): void {
  externalDocs.delete(canonicalizePath(fullPath));
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

/** The clean canonical document — what disk holds, what the matcher pairs
 *  against, what snapshots capture. Primary state; not derived. */
export function getCanonical(): PadDocument {
  return state.canonical;
}

/** Snapshot of the structured pending overlay. Primary state. */
export function getOverlayEntries(): PendingEntry[] {
  return Array.from(state.overlay.values());
}

/** Read-only view of the overlay Map. Use when you need keyed lookup
 *  rather than iteration. */
export function getOverlay(): ReadonlyMap<string, PendingEntry> {
  return state.overlay;
}

export function getTitle(): string {
  return state.title;
}

/** Snapshot of the active doc's pending metadata (title, etc.). Null if no
 *  metadata is staged. The sidebar / title bar / ReviewTab consult this to
 *  decide whether to render a metadata-pending decoration.
 *  adr: adr/pending-overlay-model.md */
export function getPendingMetadata(): PendingMetadata | null {
  return state.pendingMetadata ? { ...state.pendingMetadata } : null;
}

/** Replace the active doc's pending metadata. Persists to the sidecar so the
 *  proposal survives a doc switch or restart. Pass null to clear. */
export function setPendingMetadata(meta: PendingMetadata | null): void {
  state.pendingMetadata = meta && Object.keys(meta).length > 0 ? meta : null;
  if (state.docId) {
    savePendingMetadata(state.docId, state.pendingMetadata);
  }
}

export function getFilePath(): string {
  return state.filePath;
}

export function getIsTemp(): boolean {
  return state.isTemp;
}

export function getDocId(): string {
  return state.docId;
}

export function getPlainText(): string {
  return extractText(state.document.content);
}

export function extractText(nodes: any[]): string {
  if (!nodes) return '';
  return nodes
    .map((node) => {
      if (node.text) return node.text;
      if (node.content) return extractText(node.content);
      return '';
    })
    .join('\n');
}

/**
 * Compute linear text from a node's inline content array.
 * Matches the frontend's mapTextOffsetToPos: text chars + hardBreak=1 char.
 */
function linearText(content: any[]): string {
  if (!content) return '';
  let out = '';
  for (const child of content) {
    if (child.type === 'text' && typeof child.text === 'string') out += child.text;
    else if (child.type === 'hardBreak') out += '\n';
  }
  return out;
}

/**
 * Tokenize text into words with character offsets.
 */
function tokenize(text: string): Array<{ word: string; start: number; end: number }> {
  const words: Array<{ word: string; start: number; end: number }> = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(text))) {
    words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return words;
}

/**
 * Compute sub-node selection range by word-level diff.
 * Finds first and last differing words → decoration spans that range.
 */
function computePartialRange(origContent: any[], newContent: any[]): {
  selectionFrom: number; selectionTo: number;
  originalFrom: number; originalTo: number;
} | null {
  const origText = linearText(origContent || []);
  const newText = linearText(newContent || []);
  if (!origText || !newText || origText === newText) return null;

  const origWords = tokenize(origText);
  const newWords = tokenize(newText);
  if (origWords.length === 0 || newWords.length === 0) return null;

  // First differing word from start
  let firstDiff = 0;
  while (firstDiff < origWords.length && firstDiff < newWords.length &&
    origWords[firstDiff].word === newWords[firstDiff].word) firstDiff++;

  // All words identical (shouldn't happen since text differs, but guard)
  if (firstDiff === origWords.length && firstDiff === newWords.length) return null;

  // Last differing word from end
  let origEnd = origWords.length - 1;
  let newEnd = newWords.length - 1;
  while (origEnd >= firstDiff && newEnd >= firstDiff &&
    origWords[origEnd].word === newWords[newEnd].word) {
    origEnd--;
    newEnd--;
  }

  // No common words at start or end → full rewrite, skip partial
  if (firstDiff === 0 && origEnd === origWords.length - 1 && newEnd === newWords.length - 1) return null;

  // Raw character offsets from first/last changed words
  let origFrom = firstDiff < origWords.length ? origWords[firstDiff].start : origText.length;
  let origTo = origEnd >= firstDiff && origEnd < origWords.length ? origWords[origEnd].end : origFrom;
  let newFrom = firstDiff < newWords.length ? newWords[firstDiff].start : newText.length;
  let newTo = newEnd >= firstDiff && newEnd < newWords.length ? newWords[newEnd].end : newFrom;

  // Snap start back to previous sentence boundary (after ". " or ".\n")
  const snapBack = (text: string, pos: number): number => {
    let i = pos - 1;
    while (i > 0) {
      if (text[i] === '.' && i + 1 < text.length && (text[i + 1] === ' ' || text[i + 1] === '\n')) return i + 2;
      i--;
    }
    return 0; // No period found → start of text
  };

  // Snap end forward to next sentence boundary (". " or ".\n" or end of text)
  const snapForward = (text: string, pos: number): number => {
    let i = pos;
    while (i < text.length) {
      if (text[i] === '.' && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) return i + 1;
      i++;
    }
    return text.length;
  };

  origFrom = snapBack(origText, origFrom);
  origTo = snapForward(origText, origTo);
  newFrom = snapBack(newText, newFrom);
  newTo = snapForward(newText, newTo);

  // If almost everything changed, full-node decoration
  if ((origTo - origFrom + newTo - newFrom) >= (origText.length + newText.length) * 0.8) return null;

  return {
    selectionFrom: newFrom,
    selectionTo: newTo,
    originalFrom: origFrom,
    originalTo: origTo,
  };
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
  const idSet = new Set(ids);
  function scan(nodes: any[]) {
    if (!nodes) return;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.attrs?.id && idSet.has(node.attrs.id)) {
        result.push(node);
        // Preserve horizontalRule separators between matched nodes (thread structure)
        if (i + 1 < nodes.length && nodes[i + 1].type === 'horizontalRule') {
          result.push(nodes[i + 1]);
        }
      }
      if (node.content) scan(node.content);
    }
  }
  scan(state.document.content);
  // Remove trailing horizontalRule (don't end with separator)
  if (result.length > 0 && result[result.length - 1].type === 'horizontalRule') {
    result.pop();
  }
  return result;
}

/** Pure version of getNodesByIds — takes content array instead of reading state. */
export function findNodesByIds(docContent: any[], ids: string[]): any[] {
  const result: any[] = [];
  const idSet = new Set(ids);
  function scan(nodes: any[]) {
    if (!nodes) return;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.attrs?.id && idSet.has(node.attrs.id)) {
        result.push(node);
        if (i + 1 < nodes.length && nodes[i + 1].type === 'horizontalRule') {
          result.push(nodes[i + 1]);
        }
      }
      if (node.content) scan(node.content);
    }
  }
  scan(docContent);
  if (result.length > 0 && result[result.length - 1].type === 'horizontalRule') {
    result.pop();
  }
  return result;
}

export function getMetadata(): Record<string, any> {
  return state.metadata;
}

/**
 * Apply contamination guards + deep-merge context keys. Pure function.
 * Returns the merged metadata object, or null if all updates were filtered out.
 */
export function mergeMetadataUpdates(existing: Record<string, any>, updates: Record<string, any>): Record<string, any> | null {
  // Clone so we don't mutate the caller's object
  updates = { ...updates };

  // Prevent blogContext contamination
  if (updates.blogContext && !updates.blogContext.active && !existing?.blogContext?.active) {
    delete updates.blogContext;
    if (Object.keys(updates).length === 0) return null;
  }
  // Same guard for newsletterContext
  if (updates.newsletterContext && !updates.newsletterContext.active && !existing?.newsletterContext?.active) {
    delete updates.newsletterContext;
    if (Object.keys(updates).length === 0) return null;
  }

  // Deep-merge known context objects
  const CONTEXT_KEYS = ['blogContext', 'newsletterContext', 'articleContext', 'tweetContext', 'linkedinContext', 'manuscriptContext'];
  for (const key of CONTEXT_KEYS) {
    if (updates[key] && typeof updates[key] === 'object' && existing?.[key] && typeof existing[key] === 'object') {
      updates[key] = { ...existing[key], ...updates[key] };
    }
  }

  return { ...existing, ...updates };
}

export function setMetadata(updates: Record<string, any>): void {
  const merged = mergeMetadataUpdates(state.metadata, updates);
  if (!merged) return;

  state.metadata = merged;
  if (updates.title) state.title = updates.title;

  // Same contract as updateDocument: any path that mutates persistent state
  // MUST bump docVersion, otherwise writeToDisk's no-op gate
  // (docVersion === lastSavedDocVersion) silently drops the write and the
  // mutation never reaches disk. Metadata-only changes (mark-sent tweetUrl,
  // schedule edits, autoAccept toggle) all flow through here.
  // adr: adr/pending-overlay-model.md
  bumpDocVersion();

  // Auto-tag based on context metadata
  const filename = state.filePath
    ? (isExternalDoc(state.filePath) ? state.filePath : state.filePath.split(/[/\\]/).pop() || '')
    : '';
  if (filename) {
    // tweetContext / articleContext → "x" + mode tag
    for (const key of ['tweetContext', 'articleContext'] as const) {
      if (key in updates) {
        if (updates[key]) {
          addDocTag(filename, 'x');
          const mode = updates[key]?.mode || (key === 'articleContext' ? 'article' : undefined);
          if (mode) addDocTag(filename, mode);
        } else {
          removeDocTag(filename, 'x');
        }
      }
    }
    // blogContext / linkedinContext / newsletterContext → single tag
    const contextTags: Record<string, string> = {
      blogContext: 'blog',
      linkedinContext: 'linkedin',
      newsletterContext: 'newsletter',
    };
    for (const [key, tag] of Object.entries(contextTags)) {
      if (key in updates) {
        if (updates[key]) addDocTag(filename, tag);
        else removeDocTag(filename, tag);
      }
    }
  }
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
  // Browser-write fidelity: refuse a clobbering body-collapse. A compose
  // surface that mounted empty (wrong view) or parsed the body through a
  // narrower schema can otherwise overwrite a populated body with near-
  // nothing. Checkpoint the good on-disk body first, then refuse.
  // adr: adr/browser-write-fidelity.md
  if (wouldCollapseBody(state.document, doc)) {
    checkpointActiveBody();
    console.error(`[State] REFUSED body-collapse in updateDocument: ${doc?.content?.length ?? 0} nodes would replace ${state.document?.content?.length ?? 0} nodes (checkpointed, write refused)`);
    return;
  }

  // Trust the browser-sent doc as authoritative. The WebSocket handler's
  // version gate (isVersionCurrent) already routed stale browser submissions
  // through syncBrowserDocUpdate (the merge path); by the time we land here,
  // the browser saw the same view of pending state the server has. An
  // incoming doc with pending markers cleared is by definition an intentional
  // accept — never an attrs-lost-in-transit error. The older safety net
  // (transferPendingAttrs re-stamping server's pending onto the incoming doc)
  // worked under the pre-fb666e6 model where state.document was authoritative,
  // but under the canonical+overlay split model it actively reverted user
  // accepts: re-stamped 'insert' markers got filtered out of canonical by
  // stripPendingFromDoc, and the just-accepted body disappeared from disk.
  // adr: adr/pending-overlay-model.md
  setPrimaryFromMerged(doc);
  state.lastModified = new Date();

  // Bump docVersion so the writeToDisk no-op gate (which compares
  // docVersion to lastSavedDocVersion) sees this mutation. Browser
  // doc-updates flow through here, and without the bump the subsequent
  // debouncedSave would short-circuit and the user's edits would never
  // hit disk. The canonical contract: any path that mutates
  // state.document MUST bump docVersion. applyChanges does the same.
  // adr: adr/pending-overlay-model.md
  bumpDocVersion();
}

/**
 * Transfer pending attrs from source doc to target doc by matching node IDs.
 * Copies all pending-related attrs: status, original content, group ID,
 * selection ranges, and text edits.
 */
function transferPendingAttrs(source: PadDocument, target: PadDocument): void {
  // Build a map of nodeId → all pending attrs from source
  const pendingMap = new Map<string, Record<string, any>>();
  function collectPending(nodes: any[]) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.attrs?.pendingStatus && node.attrs?.id) {
        const entry: Record<string, any> = {
          pendingStatus: node.attrs.pendingStatus,
        };
        // Copy all pending-related attrs if present
        if (node.attrs.pendingOriginalContent != null) entry.pendingOriginalContent = node.attrs.pendingOriginalContent;
        if (node.attrs.pendingTextEdits != null) entry.pendingTextEdits = node.attrs.pendingTextEdits;
        if (node.attrs.pendingGroupId != null) entry.pendingGroupId = node.attrs.pendingGroupId;
        if (node.attrs.pendingSelectionFrom != null) entry.pendingSelectionFrom = node.attrs.pendingSelectionFrom;
        if (node.attrs.pendingSelectionTo != null) entry.pendingSelectionTo = node.attrs.pendingSelectionTo;
        if (node.attrs.pendingOriginalFrom != null) entry.pendingOriginalFrom = node.attrs.pendingOriginalFrom;
        if (node.attrs.pendingOriginalTo != null) entry.pendingOriginalTo = node.attrs.pendingOriginalTo;
        pendingMap.set(node.attrs.id, entry);
      }
      if (node.content) collectPending(node.content);
    }
  }
  collectPending(source.content);

  if (pendingMap.size === 0) return;

  // Apply pending attrs to matching nodes in target
  let transferred = 0;
  function applyPending(nodes: any[]) {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.attrs?.id && pendingMap.has(node.attrs.id)) {
        const p = pendingMap.get(node.attrs.id)!;
        Object.assign(node.attrs, p);
        transferred++;
      }
      if (node.content) applyPending(node.content);
    }
  }
  applyPending(target.content);

  if (transferred < pendingMap.size) {
    console.warn(`[State] transferPendingAttrs: ${transferred}/${pendingMap.size} nodes matched — ${pendingMap.size - transferred} pending nodes missing in target doc`);
  }
}

// ============================================================================
// AGENT WRITE LOCK
// ============================================================================
// adr: adr/agent-lock-per-doc.md

const AGENT_LOCK_MS = 3000; // Block browser doc-updates for 3s after agent write
const lockExpiry = new Map<string, number>();
let globalLockExpiry = 0;

/** Derive the identifier used for locking the active doc. Mirrors
 *  documents.ts:getActiveFilename without importing it (circular dep). */
function activeDocLockKey(): string {
  const fp = state.filePath;
  if (!fp) return '';
  if (isExternalDoc(fp)) return canonicalizeIdentifier(fp);
  return fp.split(/[/\\]/).pop() || '';
}

/** Set the agent write lock for a specific document. */
export function setAgentLock(filename: string): void {
  if (!filename) {
    // Defensive: empty filename means we don't know what to lock — lock global.
    setAgentLockGlobal();
    return;
  }
  const key = canonicalizeIdentifier(filename);
  const wasActive = (lockExpiry.get(key) ?? 0) > Date.now();
  lockExpiry.set(key, Date.now() + AGENT_LOCK_MS);
  diagLog(`[Lock] SET filename=${key} ttl=${AGENT_LOCK_MS}ms${wasActive ? ' (extends active lock)' : ''}`);
}

/** Lock the currently active document. Convenience for callers that mutate
 *  via state.filePath rather than an explicit filename. */
export function setAgentLockActive(): void {
  setAgentLock(activeDocLockKey());
}

/** Lock every document briefly. Used at server init so reconnecting browsers
 *  can't push stale state from before the restart. */
export function setAgentLockGlobal(): void {
  globalLockExpiry = Date.now() + AGENT_LOCK_MS;
  diagLog(`[Lock] SET global ttl=${AGENT_LOCK_MS}ms`);
}

/** Check if the agent write lock is active for a given document. */
export function isAgentLocked(filename: string): boolean {
  const now = Date.now();
  if (globalLockExpiry > now) return true;
  if (!filename) return false;
  const key = canonicalizeIdentifier(filename);
  const expiry = lockExpiry.get(key);
  if (expiry === undefined) return false;
  if (expiry > now) return true;
  lockExpiry.delete(key);
  return false;
}

// ---- Document version counter: prevents stale browser doc-updates ----
let docVersion = 0;
// Counterpart to docVersion: the docVersion at which we last confirmed
// in-memory state matches disk. save()/writeToDisk() is a strict no-op when
// these are equal (and a file exists on disk). This is the server-side
// counterpart to the client diff-gate in App.tsx — it makes doc-switches
// between unchanged docs free (no serialize, no sidecar write, no snapshot,
// no mtime bump that would invalidate the doc cache).
// adr: adr/pending-overlay-model.md
let lastSavedDocVersion = 0;

/** Increment version after agent writes. Returns the new version. */
export function bumpDocVersion(): number {
  return ++docVersion;
}

/** Get current document version. */
export function getDocVersion(): number {
  return docVersion;
}

/** Check if a browser doc-update version is current. */
export function isVersionCurrent(browserVersion: number): boolean {
  return browserVersion >= docVersion;
}

/** Reset version on document switch (new document = new version lineage).
 *  Both counters move together: the new doc was just loaded from disk (or
 *  cache, which mtime-validates against disk), so in-memory matches disk
 *  by definition. */
export function resetDocVersion(): void {
  docVersion = 0;
  lastSavedDocVersion = 0;
}

// ---- Debounced save: coalesces rapid agent writes into a single disk write ----
//
// Single timer for the entire process. Both state.ts (MCP write paths, applyChanges,
// updateDocument) and ws.ts (browser doc-update, pending-resolved) call into this.
// Previously each module had its own timer (state.ts 500ms, ws.ts 2s) which meant
// a save could be armed by one path, reset by another, and fire on a delay that
// matched neither documented value. One timer, one TTL — predictable.
// adr: adr/pending-overlay-model.md
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

// The actor whose edits are sitting in the current debounce window. Set at
// schedule time (NOT flush time) so attribution can't bleed across actors.
// adr: adr/document-history-attribution.md (invariant 3 — no module-global shim;
// this is save-scoped: it tracks the SCHEDULER of the pending batch and is
// cleared the moment that batch flushes).
let pendingSaveActor: Actor | null = null;

export function debouncedSave(actor: Actor = 'human'): void {
  // If a save is already pending under a DIFFERENT actor, flush that batch now
  // under ITS actor before this actor's edits join the window — otherwise the
  // single coalesced flush would attribute both actors' new sentences to one.
  if (saveTimer && pendingSaveActor && pendingSaveActor !== actor) {
    clearTimeout(saveTimer);
    saveTimer = null;
    save(pendingSaveActor);
  }
  pendingSaveActor = actor;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const a = pendingSaveActor ?? 'human';
    pendingSaveActor = null;
    save(a);
  }, SAVE_DEBOUNCE_MS);
}

/** Cancel any pending debounced save. Call before doc switch (which does its own save). */
export function cancelDebouncedSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSaveActor = null;
}

export function applyChanges(changes: NodeChange[]): { count: number; lastNodeId: string | null } {
  // Bump version BEFORE applying so new overlay entries created by
  // applyChangesToDocument's setPrimaryFromMerged → setOverlayFromEntries
  // pass are stamped with the post-bump version (the version we're about
  // to broadcast), not the pre-bump version. Without this, a stale
  // browser doc-update arriving with browserVersion == preBump satisfies
  // syncBrowserDocUpdate's `addedAtVersion > browserVersion` filter as
  // FALSE for entries just added by this call — preservedServerEntries
  // becomes 0, the overlay is wiped, and the agent's write silently
  // vanishes despite a success response. adr: adr/pending-overlay-model.md
  const version = bumpDocVersion();
  setAgentLockActive();

  // Apply to server-side document (source of truth)
  const processed = applyChangesToDocument(changes);

  // Broadcast processed changes (with server-assigned IDs + version) to browser clients
  for (const listener of listeners) {
    listener(processed, version);
  }

  // Debounced save — coalesces rapid agent writes into a single disk write.
  // applyChanges is an AGENT door (MCP write tools land here); tag the batch
  // so the flush attributes its new content to the agent.
  debouncedSave('agent');

  // Update pending doc cache for the active document
  updatePendingCacheForActiveDoc();

  // Find the last created node ID for chaining inserts
  let lastNodeId: string | null = null;
  for (let i = processed.length - 1; i >= 0; i--) {
    const change = processed[i];
    if (change.content) {
      const contentArr = Array.isArray(change.content) ? change.content : [change.content];
      const lastNode = contentArr[contentArr.length - 1];
      if (lastNode?.attrs?.id) {
        lastNodeId = lastNode.attrs.id;
        break;
      }
    }
  }

  return { count: processed.length, lastNodeId };
}

export function onIdRewrites(listener: IdRewriteListener): () => void {
  idRewriteListeners.add(listener);
  return () => idRewriteListeners.delete(listener);
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
 * Containers whose internals are NOT addressable via MCP. `findNode` must not
 * descend into these — their child IDs are ephemeral (regenerated every
 * `markdownToTiptap` parse, untracked by the matcher) and never exposed via
 * `compactNodes`, so any agent-provided ID that happens to match a node inside
 * one is a collision, not a legitimate target.
 *
 * Before this guard existed, a `write_to_pad` rewrite could silently corrupt a
 * table cell: an agent ID collision with a freshly-minted table-internal node
 * routed the splice into the table instead of the intended top-level
 * paragraph. Reported as success, observable as stray paragraphs / mangled
 * rows in the saved markdown.
 *
 * Mirrors `node-blocks.ts`'s walker, which already treats tables as opaque.
 *
 * adr: adr/node-identity-matcher.md
 */
const OPAQUE_CONTAINER_TYPES = new Set(['table', 'tableRow', 'tableCell', 'tableHeader']);

/**
 * Find a node by ID in any document tree.
 * topLevel is used to resolve the "end" sentinel.
 */
function findNode(nodes: any[], id: string, topLevel: any[]): { parent: any[]; index: number } | null {
  if (id === 'end') {
    if (topLevel && topLevel.length > 0) {
      return { parent: topLevel, index: topLevel.length - 1 };
    }
    return null;
  }
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].attrs?.id === id) {
      return { parent: nodes, index: i };
    }
    // Don't descend into table internals (table, tableRow, tableCell, tableHeader).
    // Their IDs aren't addressable via MCP and they regenerate on every parse,
    // so any match inside is a collision that would silently corrupt the table.
    if (OPAQUE_CONTAINER_TYPES.has(nodes[i].type)) continue;
    if (nodes[i].content && Array.isArray(nodes[i].content)) {
      const result = findNode(nodes[i].content, id, topLevel);
      if (result) return result;
    }
  }
  return null;
}

/** Find a node in the active document. */
function findNodeInDoc(nodes: any[], id: string): { parent: any[]; index: number } | null {
  return findNode(nodes, id, state.document.content);
}

/**
 * Core change application logic — operates on any document object.
 * Mutates doc in place and returns processed changes with server-assigned IDs.
 *
 * When `autoAccept` is true, changes commit directly: no pendingStatus tagging,
 * no pendingOriginalContent baseline, and deletes hard-remove from the array
 * (rather than tagging for review). Processed changes carry autoAccept: true
 * so the client knows to apply them as committed edits, not pending review.
 */
function applyChangesToDoc(doc: PadDocument, changes: NodeChange[], autoAccept: boolean = false): NodeChange[] {
  const processed: NodeChange[] = [];

  // Track last insert anchor → last inserted node ID, so consecutive inserts
  // with the same afterNodeId chain naturally (array order = document order).
  let lastInsertAnchor: string | null = null;
  let lastInsertedId: string | null = null;

  for (const change of changes) {
    if (change.operation === 'rewrite' && change.nodeId && change.content) {
      const found = findNode(doc.content, change.nodeId, doc.content);
      if (!found) continue;

      let contentArray = Array.isArray(change.content) ? change.content : [change.content];
      const originalNode = structuredClone(found.parent[found.index]);

      // Preserve target node type when plain text would otherwise demote it.
      // Markdown-it parses plain text as a paragraph, so rewriting a heading or
      // list item with plain prose silently changes the type. Two adaptations:
      //   - Block wrappers (listItem, blockquote) wrap the parsed paragraph as
      //     their child, keeping the wrapper's type and attrs.
      //   - Inline-content leaves (heading, codeBlock) take the paragraph's
      //     inline text and host it inside the original type, preserving level
      //     and other attrs.
      // Explicit markdown (e.g. "## Foo", "- bar") still wins because the
      // parser produces a matching node type before we get here.
      const targetType = originalNode.type;
      const parsedType = contentArray[0]?.type;
      const BLOCK_WRAPPERS = new Set(['listItem', 'blockquote']);
      const INLINE_LEAVES = new Set(['heading', 'codeBlock']);

      let isWrappedRewrite = false;
      if (parsedType === 'paragraph' && targetType !== 'paragraph') {
        if (BLOCK_WRAPPERS.has(targetType)) {
          contentArray = [{
            type: targetType,
            attrs: { ...originalNode.attrs },
            content: contentArray,
          }];
          isWrappedRewrite = true;
        } else if (INLINE_LEAVES.has(targetType)) {
          // Standard stamping handles the leaf case — heading/codeBlock are
          // themselves the decoration target, so no special branch needed below.
          contentArray = [{
            type: targetType,
            attrs: { ...originalNode.attrs },
            content: contentArray[0].content || [],
          }];
        }
      }

      // Empty node rewrite → treat as insert (green, not blue)
      const originalText = extractText(originalNode.content || []);
      const isEmptyNode = !originalText.trim();

      // Only store original on first rewrite (preserve baseline for reject)
      const existingOriginal = found.parent[found.index].attrs?.pendingOriginalContent;

      // Detect partial change: if only a sub-range of the node text changed,
      // attach selection range attrs so the frontend decorates only that part.
      // For wrapped rewrites (listItem), compare paragraph content against the
      // listItem's inner paragraph so offsets align with what the user sees.
      let partialRange: ReturnType<typeof computePartialRange> = null;
      if (!isEmptyNode && contentArray.length === 1 && !autoAccept) {
        const baseContent = isWrappedRewrite
          ? (existingOriginal?.content?.[0]?.content || originalNode.content?.[0]?.content || [])
          : (existingOriginal?.content || originalNode.content || []);
        const newContent = isWrappedRewrite
          ? (contentArray[0].content?.[0]?.content || [])
          : (contentArray[0].content || []);
        partialRange = computePartialRange(baseContent, newContent);
      }

      // Build first node. For wrapped rewrites, pendingStatus and related attrs
      // belong on the inner leaf (paragraph) so the decoration renderer — which
      // keys off LEAF_BLOCK_TYPES — picks them up. The wrapper keeps the original
      // node's id/attrs so subsequent calls can still target it.
      let firstNode: any;
      if (isWrappedRewrite && !autoAccept) {
        const innerLeaf = contentArray[0].content?.[0] || { type: 'paragraph', content: [] };
        const innerWithPending = {
          ...innerLeaf,
          attrs: {
            ...innerLeaf.attrs,
            id: innerLeaf.attrs?.id || generateNodeId(),
            pendingStatus: isEmptyNode ? 'insert' : 'rewrite',
            ...(isEmptyNode ? {} : { pendingOriginalContent: existingOriginal || originalNode }),
            ...(partialRange ? {
              pendingSelectionFrom: partialRange.selectionFrom,
              pendingSelectionTo: partialRange.selectionTo,
              pendingOriginalFrom: partialRange.originalFrom,
              pendingOriginalTo: partialRange.originalTo,
            } : {}),
          },
        };
        firstNode = {
          type: 'listItem',
          attrs: { ...contentArray[0].attrs, id: change.nodeId },
          content: [innerWithPending, ...contentArray[0].content.slice(1)],
        };
      } else {
        firstNode = {
          ...contentArray[0],
          attrs: autoAccept ? {
            ...contentArray[0].attrs,
            id: change.nodeId,
          } : {
            ...contentArray[0].attrs,
            id: change.nodeId,
            pendingStatus: isEmptyNode ? 'insert' : 'rewrite',
            ...(isEmptyNode ? {} : { pendingOriginalContent: existingOriginal || originalNode }),
            ...(partialRange ? {
              pendingSelectionFrom: partialRange.selectionFrom,
              pendingSelectionTo: partialRange.selectionTo,
              pendingOriginalFrom: partialRange.originalFrom,
              pendingOriginalTo: partialRange.originalTo,
            } : {}),
          },
        };
      }

      // Additional nodes get inserted after — as pending inserts in normal mode,
      // as plain blocks in autoAccept mode.
      const extraNodes = contentArray.slice(1).map((node: any) => ({
        ...node,
        attrs: {
          ...node.attrs,
          id: node.attrs?.id || generateNodeId(),
        },
      }));
      if (!autoAccept) markLeafBlocksAsPending(extraNodes, 'insert');

      found.parent.splice(found.index, 1, firstNode, ...extraNodes);

      processed.push({
        ...change,
        content: [firstNode, ...extraNodes],
        ...(autoAccept ? { autoAccept: true } : {}),
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
        },
      }));
      // Mark leaf blocks as pending (not containers) — skipped in autoAccept mode
      // so inserts commit as plain content without decoration.
      if (!autoAccept) markLeafBlocksAsPending(contentWithIds, 'insert');

      let resolvedAfterId: string | undefined;

      // Auto-chain: if this insert targets the same anchor as the previous insert,
      // redirect it to insert after the last inserted node instead (preserves array order).
      let effectiveAfterId = change.afterNodeId;
      if (effectiveAfterId && effectiveAfterId === lastInsertAnchor && lastInsertedId) {
        effectiveAfterId = lastInsertedId;
      }

      if (change.nodeId && !change.afterNodeId) {
        // Replace empty node
        const found = findNode(doc.content, change.nodeId, doc.content);
        if (!found) continue;
        found.parent.splice(found.index, 1, ...contentWithIds);
      } else if (effectiveAfterId) {
        const found = findNode(doc.content, effectiveAfterId, doc.content);
        if (!found) continue;
        // Resolve "end" sentinel to actual node ID so browser can find it
        resolvedAfterId = found.parent[found.index]?.attrs?.id;
        found.parent.splice(found.index + 1, 0, ...contentWithIds);
      } else {
        continue;
      }

      // Track for auto-chaining: remember original anchor + last inserted ID
      const newLastId = contentWithIds[contentWithIds.length - 1]?.attrs?.id;
      if (change.afterNodeId && newLastId) {
        if (change.afterNodeId !== lastInsertAnchor) {
          // New anchor — start fresh chain
          lastInsertAnchor = change.afterNodeId;
        }
        lastInsertedId = newLastId;
      }

      // Broadcast with server-assigned IDs and resolved anchor so browser inserts at the correct position
      processed.push({
        ...change,
        afterNodeId: resolvedAfterId && change.afterNodeId === 'end'
          ? resolvedAfterId
          : effectiveAfterId ?? change.afterNodeId,
        content: contentWithIds.length === 1 ? contentWithIds[0] : contentWithIds,
        ...(autoAccept ? { autoAccept: true } : {}),
      });
    }

    else if (change.operation === 'delete' && change.nodeId) {
      const found = findNode(doc.content, change.nodeId, doc.content);
      if (!found) continue;

      // Tweet thread: hard-delete paragraphs + adjacent HR immediately.
      // Tweet compose view can't handle pending deletes near HRs — hard-delete and resync.
      const delNode = found.parent[found.index];
      const hardDeleteTypes = ['paragraph', 'image', 'imageLoading'];
      if (hardDeleteTypes.includes(delNode.type) && state.metadata?.tweetContext) {
        const idx = found.index;
        if (idx > 0 && found.parent[idx - 1].type === 'horizontalRule') {
          found.parent.splice(idx, 1);
          found.parent.splice(idx - 1, 1);
        } else if (idx + 1 < found.parent.length && found.parent[idx + 1].type === 'horizontalRule') {
          found.parent.splice(idx + 1, 1);
          found.parent.splice(idx, 1);
        } else {
          found.parent.splice(idx, 1);
        }
        // Push a synthetic HR change so ws.ts detects it and sends document-switched
        processed.push({ operation: 'delete' as const, nodeId: change.nodeId, content: [{ type: 'horizontalRule' }] });
        continue;
      }

      if (autoAccept) {
        // Hard-delete: remove the node entirely from its parent array.
        found.parent.splice(found.index, 1);
        processed.push({ ...change, autoAccept: true });
      } else {
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
  }

  return processed;
}

/**
 * Effective auto-accept for a doc: true if the doc's own frontmatter has it,
 * OR if any workspace/container ancestor in the workspace tree has it on.
 */
export function isAutoAcceptActive(filename: string, metadata?: Record<string, any>): boolean {
  if (metadata?.autoAccept === true) return true;
  if (metadata?.autoAccept === false) return false; // explicit doc-level override of inheritance
  if (!filename) return false;
  return isAutoAcceptInheritedForDoc(filename);
}

/** Apply changes to the active document singleton.
 *
 *  The applyChangesToDoc engine mutates the merged view (state.document) —
 *  it's where the pending-status stamping logic lives. After the mutation,
 *  re-split state.document back into primary state (canonical + overlay) so
 *  the cache + matcher + save paths see consistent primary state. The
 *  re-split is the bridge between the legacy "mutate merged in place" engine
 *  and the new "primary state is canonical + overlay" model. */
function applyChangesToDocument(changes: NodeChange[]): NodeChange[] {
  const autoAccept = isAutoAcceptActive(activeDocFilename(), state.metadata);
  const processed = applyChangesToDoc(state.document, changes, autoAccept);
  if (processed.length > 0) {
    state.lastModified = new Date();
    // Re-sync primary state from the now-mutated merged view. Idempotent:
    // splitMergedDoc + applyOverlayPure round-trip leaves state.document
    // structurally equivalent to itself.
    setPrimaryFromMerged(state.document);
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
  if (!result) {
    // Surface a slice of the actual node text alongside the searched `find`
    // strings so the agent can diff for unicode/whitespace mismatches
    // (em-dash vs hyphen-minus, NBSP vs space, smart quotes, etc.). Without
    // this the failure is opaque and the agent has to guess.
    const nodeText = extractText(originalNode.content || []);
    const truncated = nodeText.length > 240 ? nodeText.slice(0, 240) + '…' : nodeText;
    const searched = edits.map((e) => JSON.stringify(e.find)).join(', ');
    return { success: false, error: `No edits matched in node ${nodeId}. Searched: ${searched}. Node text starts: ${JSON.stringify(truncated)}` };
  }

  // Inline edit decoration only matters when there's a review surface — skip in autoAccept.
  if (!isAutoAcceptActive(activeDocFilename(), state.metadata)) {
    result.node.attrs = {
      ...result.node.attrs,
      pendingTextEdits: result.textEdits,
    };
  }

  // Route through applyChanges as a rewrite so it goes through the normal pipeline
  applyChanges([{
    operation: 'rewrite',
    nodeId,
    content: result.node,
  }]);

  return { success: true };
}

/** Set the active document state. Used by documents.ts for multi-doc operations.
 *
 *  Identity tracking is NOT cached on PadState — the save-time matcher reads
 *  previousNodes + graveyard directly from disk frontmatter every write
 *  (Option B in adr/node-identity-matcher.md). Markdown is the source of
 *  truth; memory is an ephemeral working copy. */
export function setActiveDocument(
  doc: PadDocument, title: string, filePath: string, isTemp: boolean,
  lastModified?: Date, metadata?: Record<string, any>, originalFrontmatter?: string | null,
): void {
  // Route the incoming doc through the primary-state setter — splits into
  // canonical + overlay (handles legacy in-frontmatter pending if present)
  // and recomputes the merged view.
  setPrimaryFromMerged(doc);
  state.title = title;
  state.metadata = metadata || { title };
  // Legacy: strip any pre-architectural-fix `agentCreated` field that
  // arrived in metadata (e.g. from a re-parse of an old on-disk file).
  // The in-memory agentStubFilenames Set is the only authority for stub
  // status — disk frontmatter must not carry stub state.
  stripLegacyAgentCreated(state.metadata);
  // Canonicalize at the identity boundary: same physical file via any
  // spelling (forward/back slash, drive-letter case, symlink) lands the
  // same string in state.filePath, which is the cache key for the doc
  // cache and the subscription path for the fs watcher.
  // adr: adr/path-canonicalization.md
  state.filePath = filePath ? canonicalizePath(filePath) : '';
  state.isTemp = isTemp;
  state.lastModified = lastModified || new Date();
  state.docId = ensureDocId(state.metadata);
  state.originalFrontmatter = originalFrontmatter ?? null;
  // Snapshot the on-disk mtime so writeToDisk can detect external writes
  // that land while this doc is active. 0 = no file on disk yet (new doc).
  try {
    state.loadedMtime = filePath && existsSync(filePath) ? statSync(filePath).mtimeMs : 0;
  } catch { state.loadedMtime = 0; }

  // Pending overlay rehydration. See mergeOverlayOnLoad for the three cases
  // (sidecar present, legacy migration, no pending).
  mergeOverlayOnLoad();

  // Pending metadata rehydration. Read the sidecar's `metadata:` slot so a
  // staged title rename survives doc-switch and restart. adr: adr/pending-overlay-model.md
  state.pendingMetadata = state.docId ? loadPendingMetadata(state.docId) : null;

  // Subscribe the fs watcher to this doc so external writes (Edit tool,
  // VSCode, scripts) trigger a unified reload + version bump + broadcast.
  // adr: adr/active-doc-watcher.md
  startActiveDocWatcher();
}

// ============================================================================
// PENDING DOCUMENT CACHE (avoids disk scans on every broadcast)
// ============================================================================

/** In-memory cache: filename → pending change count. Populated on load(), updated incrementally. */
const pendingDocCache = new Map<string, number>();

/** Get the active doc's filename identifier (mirrors getActiveFilename in documents.ts). */
function activeDocFilename(): string {
  return state.filePath
    ? (isExternalDoc(state.filePath) ? state.filePath : state.filePath.split(/[/\\]/).pop() || '')
    : '';
}

/** Update the pending cache for the active document from in-memory state. */
export function updatePendingCacheForActiveDoc(): void {
  const filename = activeDocFilename();
  if (!filename) return;
  const count = getPendingChangeCount();
  if (count > 0) {
    pendingDocCache.set(filename, count);
  } else {
    pendingDocCache.delete(filename);
  }
}

/** Remove a filename from the pending cache (after pending attrs are stripped). */
export function removePendingCacheEntry(filename: string): void {
  pendingDocCache.delete(filename);
}

/** Set the pending cache entry for a specific filename (for non-active doc population). */
export function setPendingCacheEntry(filename: string, count: number): void {
  if (count > 0) {
    pendingDocCache.set(filename, count);
  } else {
    pendingDocCache.delete(filename);
  }
}

/** Pending count for one doc: sidecar entries + staged title rename (the
 *  sidecar is authoritative since the overlay migration; legacy in-frontmatter
 *  `pending:` is the fallback for docs that predate it).
 *  adr: adr/pending-overlay-model.md */
function pendingCountForDoc(docId: string | undefined, legacyPending: any): number {
  let count = 0;
  if (docId) {
    count += loadOverlay(docId).length;
    if (loadPendingMetadata(docId)) count += 1;
  }
  if (count === 0 && legacyPending && Object.keys(legacyPending).length > 0) {
    count = Object.keys(legacyPending).length;
  }
  return count;
}

/** Populate the pending cache from a full disk scan. Called once on startup.
 *  Reads the `_pending/{docId}.json` sidecars (the authoritative store) —
 *  scanning only legacy frontmatter here made every restart look like a
 *  profile-wide accept-all, because the sidebar/review pending list came back
 *  empty even though all sidecars survived on disk. */
function populatePendingCache(): void {
  pendingDocCache.clear();
  try {
    const files = readdirSync(getDataDir()).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      try {
        const raw = readFileSync(join(getDataDir(), f), 'utf-8');
        const { data } = matter(raw);
        const count = pendingCountForDoc(data.docId, data.pending);
        if (count > 0) pendingDocCache.set(f, count);
      } catch { /* skip unreadable files */ }
    }
  } catch { /* ignore */ }
  // Scan external docs
  for (const extPath of externalDocs) {
    try {
      if (!existsSync(extPath)) continue;
      const raw = readFileSync(extPath, 'utf-8');
      const { data } = matter(raw);
      const count = pendingCountForDoc(data.docId, data.pending);
      if (count > 0) pendingDocCache.set(extPath, count);
    } catch { /* skip unreadable files */ }
  }
}

// ============================================================================
// IN-MEMORY DOCUMENT CACHE (preserves TipTap JSON + node IDs across switches)
// ============================================================================

interface CachedDoc {
  // Cached state is canonical + overlay, not the merged view. Storing merged
  // was the root of the duplicate-insert bug — switch-back re-applied overlay
  // onto an already-merged doc and double-inserted.
  // adr: adr/pending-overlay-model.md
  canonical: PadDocument;
  overlayEntries: PendingEntry[];
  // `document` retained as a convenience view for external consumers
  // (getCachedDocument call sites that haven't been migrated to canonical+overlay).
  // Always derived from canonical + overlayEntries via applyOverlayPure at cache time.
  document: PadDocument;
  metadata: Record<string, any>;
  title: string;
  isTemp: boolean;
  lastModified: Date;
  docId: string;
  fileMtime: number; // file mtime when cached, for external-change detection
  originalFrontmatter: string | null;
}
/** Keyed by canonical path. Two spellings of the same physical file
 *  (forward/back slash, drive-letter case) collapse to one cache entry —
 *  preventing parallel state where the same disk file lives in two
 *  cache slots.
 *  adr: adr/path-canonicalization.md */
const docCache = new Map<CanonPath, CachedDoc>();

/** Cache the active document's full state, keyed by filePath. Call after save().
 *
 *  Identity (nodes + graveyard) is NOT cached — the save-time matcher reads
 *  it from disk frontmatter each write, so the cache stays a pure content
 *  snapshot. */
export function cacheActiveDocument(): void {
  if (!state.filePath) return;
  let fileMtime = 0;
  try {
    fileMtime = statSync(state.filePath).mtimeMs;
  } catch { /* file may not exist yet */ }
  // Split the live merged document into canonical + overlay AT cache time —
  // this is what protects against the duplicate-insert bug. Storing merged
  // and re-applying overlay later was the broken pattern.
  const split = splitMergedDoc(state.document);
  docCache.set(canonicalizePath(state.filePath), {
    canonical: split.canonical,
    overlayEntries: split.overlayEntries,
    document: applyOverlayPure(split.canonical, split.overlayEntries),
    metadata: structuredClone(state.metadata),
    title: state.title,
    isTemp: state.isTemp,
    lastModified: state.lastModified,
    docId: state.docId,
    fileMtime,
    originalFrontmatter: state.originalFrontmatter,
  });
}

/** Get a cached document if the file hasn't been modified externally. Returns null on miss or stale. */
export function getCachedDocument(filePath: string): CachedDoc | null {
  const key = canonicalizePath(filePath);
  const cached = docCache.get(key);
  if (!cached) return null;
  try {
    const currentMtime = statSync(filePath).mtimeMs;
    if (currentMtime !== cached.fileMtime) {
      // File changed on disk — invalidate cache
      docCache.delete(key);
      return null;
    }
  } catch {
    // File doesn't exist or can't be read — invalidate
    docCache.delete(key);
    return null;
  }
  return cached;
}

/** Remove a specific file from the document cache. */
export function invalidateDocCache(filePath: string): void {
  docCache.delete(canonicalizePath(filePath));
}

/** Update the cache entry for a file after writing changes (without cloning the active state). */
export function updateCacheEntry(filePath: string, doc: PadDocument, title: string, metadata: Record<string, any>, isTemp: boolean, docId: string): void {
  let fileMtime = 0;
  try {
    fileMtime = statSync(filePath).mtimeMs;
  } catch { /* best-effort */ }
  const key = canonicalizePath(filePath);
  // Preserve originalFrontmatter from existing cache entry (if any)
  const existing = docCache.get(key);
  // Split the incoming doc into canonical + overlay before caching so the
  // cache stores canonical-only and the duplicate-insert chain is broken.
  const split = splitMergedDoc(doc);
  const overlayEntries = split.overlayEntries;
  const canonicalClone = split.canonical;
  docCache.set(key, {
    canonical: canonicalClone,
    overlayEntries,
    document: applyOverlayPure(canonicalClone, overlayEntries),
    metadata: structuredClone(metadata),
    title,
    isTemp,
    lastModified: new Date(),
    docId,
    fileMtime,
    originalFrontmatter: existing?.originalFrontmatter ?? null,
  });
}

/** Reset all in-memory caches. Called on profile switch. */
export function clearAllCaches(): void {
  // Tear down the active-doc watcher before swapping state — leaving it
  // alive would point at a path the new profile doesn't own.
  stopActiveDocWatcher();
  docCache.clear();
  pendingDocCache.clear();
  externalDocs.clear();
  // Activity log keeps an in-memory ring buffer that doesn't auto-reset
  // when getDataDir() flips. Without this, the new profile inherits the
  // previous profile's activity entries on the first client seed.
  // adr: adr/right-rail.md
  clearActivityBuffer();
  // Backlinks cache is module-level state inside backlinks.ts, scanned
  // from getDataDir(). Without this reset the new profile keeps serving
  // the old profile's inverse-references map and the BacklinksTab shows
  // wrong inbounds (or empty when the cache was empty pre-switch).
  invalidateBacklinksCache();
  state = {
    canonical: DEFAULT_DOC,
    overlay: new Map(),
    pendingMetadata: null,
    document: DEFAULT_DOC,
    title: 'Untitled',
    metadata: { title: 'Untitled' },
    filePath: '',
    isTemp: true,
    lastModified: new Date(),
    docId: '',
    originalFrontmatter: null,
    loadedMtime: 0,
  };
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

/** Strip all pending attrs from the current document (after browser resolves all changes).
 *  In the new model this is implemented by clearing the overlay — the merged
 *  view recomputes to canonical (which already has no pending markers). */
export function stripPendingAttrs(): void {
  state.overlay = new Map();
  recomputeMerged();
  removePendingCacheEntry(activeDocFilename());
}

/**
 * Return a deep clone of `doc` with all pending changes reverted, as if the
 * user had rejected every pending decoration:
 *   - pendingStatus=insert   → drop the node
 *   - pendingStatus=rewrite  → replace node with `pendingOriginalContent` (or drop if absent)
 *   - pendingStatus=delete   → keep node, clear pending attrs (the rejection is "no, don't delete")
 *   - no pendingStatus       → keep node, strip any stray pending attrs
 *
 * Used by `restore_version` to write a canonical-only safety checkpoint so
 * the snapshot represents a clean recovery point rather than a flattened
 * pending+canonical hybrid that never actually existed in the user's view.
 *
 * Does NOT mutate the input doc.
 */
/**
 * Reload the active doc from disk. Re-reads the canonical .md file, applies
 * the pending overlay from the sidecar (with orphan + stale-baseline
 * classification), and updates state.document, state.metadata, state.title,
 * and state.loadedMtime in place.
 *
 * Called by:
 *   - chokidar watcher when an external write modifies the active file
 *   - mcp.restore_version after writing the snapshot's content to disk
 *   - mcp.reload_from_disk tool (explicit user-driven reload)
 *   - writeToDisk's mtime-CAS backstop (recover-and-retry path)
 *
 * Returns the reload result so callers can broadcast or react to the
 * orphan / staleBaseline classifications. Returns null if there's no
 * active file path to reload (no-op).
 *
 * adr: adr/pending-overlay-model.md
 */
export function reloadActiveDocFromDisk(): {
  document: PadDocument;
  title: string;
  filename: string;
  orphans: PendingEntry[];
  staleBaseline: PendingEntry[];
} | null {
  if (!state.filePath || !existsSync(state.filePath)) return null;

  const raw = readFileSync(state.filePath, 'utf-8');
  const parsed = markdownToTiptap(raw);

  // Split parsed doc: canonical (clean) + any legacy in-frontmatter pending.
  const { canonical, overlayEntries: legacyOverlay } = splitMergedDoc(parsed.document);
  state.title = parsed.title;
  state.metadata = parsed.metadata;
  stripLegacyAgentCreated(state.metadata);
  state.docId = ensureDocId(state.metadata);
  state.lastModified = new Date(statSync(state.filePath).mtimeMs);
  state.loadedMtime = statSync(state.filePath).mtimeMs;

  // Sidecar is authoritative if present. Otherwise legacy in-doc pending
  // migrates to sidecar (one-time).
  const sidecar = loadOverlay(state.docId);
  let entries: PendingEntry[];
  if (sidecar.length > 0) {
    entries = sidecar;
  } else if (legacyOverlay.length > 0) {
    entries = legacyOverlay;
    saveOverlay(state.docId, legacyOverlay);
  } else {
    entries = [];
  }

  // Set primary state directly — canonical from disk parse, overlay from
  // sidecar (or legacy migration). Recompute merged via the helper.
  state.canonical = canonical;
  setOverlayFromEntries(entries);

  // Pending metadata rehydration — mirror what setActiveDocument does.
  // External-write reloads must keep state.pendingMetadata aligned with the
  // sidecar's metadata: slot, otherwise a staged title rename gets dropped
  // from in-memory state the moment fs.watch fires.
  // adr: adr/pending-overlay-model.md
  state.pendingMetadata = state.docId ? loadPendingMetadata(state.docId) : null;

  // External writes change the body but leave disk frontmatter pointing at
  // the previous save's fingerprints. If the user cuts/deletes a block before
  // the next browser-driven save, the matcher graveyards with that stale
  // fingerprint and a later paste-back can't match by exact fingerprint —
  // graveyard-restore silently misses. Resync disk frontmatter with the
  // reloaded body now: the matcher's edit rule pins IDs and emits fresh
  // per-block fingerprints. fs.watch self-suppression via state.loadedMtime
  // (handleWatcherEvent) prevents a reload→save→reload loop.
  //
  // Bump docVersion BEFORE writeToDisk: serves two purposes at once. (1)
  // Rejects any in-flight stale browser autosaves (the WS handler checks
  // version currency). (2) Forces writeToDisk's no-op gate to see "dirty"
  // state and actually persist the refreshed frontmatter — without the bump,
  // the gate would short-circuit and the stale-fingerprint bug returns.
  // adr: adr/node-identity-matcher.md
  bumpDocVersion();
  try { writeToDisk(); } catch { /* best-effort — reload still useful even if save fails */ }

  return {
    document: state.document,
    title: state.title,
    filename: state.filePath.split(/[/\\]/).pop() || '',
    orphans: [],
    staleBaseline: [],
  };
}

/**
 * Pending overlay rehydration. Runs after a doc loads from disk (load() or
 * setActiveDocument). Three cases:
 *
 *   1. Sidecar has entries: state.document is canonical (parser found no
 *      `meta.pending`). Apply sidecar overlay to layer pending decorations
 *      back onto the canonical tree.
 *
 *   2. Sidecar empty, parser stamped pending attrs from legacy frontmatter:
 *      one-time migration. Extract overlay from state.document, save to
 *      sidecar. State.document already has pending attrs from parse, so
 *      no apply step needed.
 *
 *   3. Sidecar empty, parser stamped nothing: no pending state. No-op.
 *
 * Returns the merged overlay entries for callers that need them.
 * adr: adr/pending-overlay-model.md
 */
function mergeOverlayOnLoad(): PendingEntry[] {
  if (!state.docId) return [];

  // setActiveDocument just populated primary state via setPrimaryFromMerged.
  // If a sidecar exists for this docId, it overrides any legacy in-doc pending
  // that the splitter extracted from the input. If no sidecar exists and the
  // legacy split found entries, persist them as a one-time migration.
  const sidecar = loadOverlay(state.docId);
  const legacy = Array.from(state.overlay.values());

  if (sidecar.length > 0) {
    setOverlayFromEntries(sidecar);
    return sidecar;
  } else if (legacy.length > 0) {
    saveOverlay(state.docId, legacy);
    // overlay already has these entries from setPrimaryFromMerged; no-op
    return legacy;
  }
  return [];
}

/**
 * Apply an oldId → newId translation map to a TipTap doc tree in place.
 * Used by writeToDisk to bring state.document's nodeIds in sync with the
 * matcher's post-pass canonical IDs.
 */
function applyIdTranslationToDoc(doc: PadDocument, translation: Map<string, string>): void {
  if (translation.size === 0) return;
  function walk(nodes: any[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const oldId = node?.attrs?.id;
      if (oldId && translation.has(oldId)) {
        node.attrs.id = translation.get(oldId);
      }
      if (node?.content) walk(node.content);
    }
  }
  walk(doc.content || []);
}

export function cloneWithPendingReverted(doc: PadDocument): PadDocument {
  const PENDING_KEYS = ['pendingStatus', 'pendingOriginalContent', 'pendingGroupId', 'pendingTextEdits', 'pendingSelectionFrom', 'pendingSelectionTo', 'pendingOriginalFrom', 'pendingOriginalTo', 'pendingOrphan', 'pendingStaleBaseline'];
  function clean(node: any): any {
    const clone = JSON.parse(JSON.stringify(node));
    if (clone.attrs) {
      for (const k of PENDING_KEYS) delete clone.attrs[k];
    }
    if (clone.content) clone.content = walk(clone.content);
    return clone;
  }
  function walk(nodes: any[]): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      const status = node.attrs?.pendingStatus;
      if (status === 'insert') continue; // drop fresh agent inserts
      if (status === 'rewrite') {
        const original = node.attrs?.pendingOriginalContent;
        if (original) result.push(clean(original));
        // If no original stashed, drop the node — we have nothing to revert to.
        continue;
      }
      // 'delete' status or no status: keep the node, strip any pending attrs.
      result.push(clean(node));
    }
    return result;
  }
  return { type: 'doc', content: walk(doc.content || []) };
}

/**
 * Does the document have any "accepted" content — i.e. blocks that wouldn't
 * vanish under reject-all? Used to clear the `agentCreated` flag once a stub
 * has graduated into a real document, so a later reject-all on stale pending
 * decorations doesn't accidentally trigger the delete-on-reject cascade.
 *
 * A node counts as accepted if it has no pendingStatus, or has
 * pendingStatus=delete (reject keeps the node), or pendingStatus=rewrite with
 * `pendingOriginalContent` present (reject restores prior content).
 */
export function hasAcceptedContent(doc: PadDocument): boolean {
  function extractTextLocal(nodes: any[]): string {
    let out = '';
    for (const n of nodes) {
      if (typeof n.text === 'string') out += n.text;
      if (n.content) out += extractTextLocal(n.content);
    }
    return out;
  }
  function walk(nodes: any[]): boolean {
    if (!nodes) return false;
    for (const node of nodes) {
      const status = node.attrs?.pendingStatus;
      // Nodes that would NOT survive reject-all: skip entirely, including their
      // children. Otherwise an insert-pending paragraph's text children would be
      // misread as accepted content.
      if (status === 'insert') continue;
      if (status === 'rewrite' && !node.attrs?.pendingOriginalContent) continue;

      // This node survives reject-all (no status, or delete, or rewrite-with-original).
      const surfaceText = node.text || extractTextLocal(node.content || []);
      if (surfaceText && surfaceText.trim().length > 0) return true;
      // Non-text leaf types also count as accepted content
      if (node.type === 'image' || node.type === 'horizontalRule' || node.type === 'table') return true;
      // Recurse into container nodes (lists, blockquotes) only when the
      // container itself isn't a dropped-on-reject node.
      if (node.content && walk(node.content)) return true;
    }
    return false;
  }
  return walk(doc.content || []);
}

/**
 * Mark leaf block nodes as pending within a node array.
 * Only marks text-containing blocks (paragraph, heading, codeBlock, etc.)
 * NOT container nodes (bulletList, orderedList, listItem, blockquote).
 * Used by `applyChangesToDoc` for write_to_pad inserts where containers
 * are handled by the explicit firstNode top-level mark.
 */
function markLeafBlocksAsPending(nodes: any[], status: string): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type && LEAF_BLOCK_TYPES.has(node.type)) {
      node.attrs = { ...node.attrs, pendingStatus: status };
      if (!node.attrs.id) {
        node.attrs.id = generateNodeId();
      }
    } else if (node.content) {
      markLeafBlocksAsPending(node.content, status);
    }
  }
}

/**
 * Block-level container types. Tagged as pending alongside leaves on the
 * populate path so a fresh doc with nested content (lists, blockquotes)
 * records the wrappers as overlay entries, not just the inner paragraphs.
 * Without this, on reload the wrappers are gone (empty containers have no
 * markdown representation) and inner-paragraph entries with parentNodeId
 * pointing at the missing wrapper get classified as orphans.
 *
 * adr: adr/pending-overlay-model.md
 */
const CONTAINER_BLOCK_TYPES = new Set([
  'bulletList', 'orderedList', 'listItem',
  'taskList', 'taskItem',
  'blockquote',
  // Footnote containers — without these, populate_document's
  // markAllNodesAsPending pass skipped the section + definition shells,
  // leaving their pendingStatus unset. The serializer's revert pass then
  // dropped the inner pending paragraphs but kept the empty container
  // shells, producing an on-disk file with `[^N]:` definition headers and
  // no content. Marking them container-level pending makes the entire
  // subtree get dropped together on canonical serialize and carried whole
  // in the pending overlay.
  // adr: adr/footnote-system.md
  'footnoteSection', 'footnoteDefinition',
]);

/**
 * Mark every block node (leaves + containers) as pending. Used by the
 * populate path where the entire doc tree is the agent's proposal — every
 * structural node must become an overlay entry so on reload the leaves'
 * parentNodeId references resolve through entries placed earlier in the
 * same batch.
 */
function markAllBlockNodesAsPending(nodes: any[], status: string): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type && (LEAF_BLOCK_TYPES.has(node.type) || CONTAINER_BLOCK_TYPES.has(node.type))) {
      node.attrs = { ...node.attrs, pendingStatus: status };
      if (!node.attrs.id) {
        node.attrs.id = generateNodeId();
      }
    }
    if (node.content && !LEAF_BLOCK_TYPES.has(node.type)) {
      markAllBlockNodesAsPending(node.content, status);
    }
  }
}

export function markAllNodesAsPending(doc: PadDocument, status: 'insert' | 'rewrite'): void {
  markAllBlockNodesAsPending(doc.content, status);
}

/** Read pending doc info from in-memory cache (O(1) instead of disk scan). */
export function getPendingDocInfo(): { filenames: string[]; counts: Record<string, number> } {
  const filenames: string[] = [];
  const counts: Record<string, number> = {};
  const stale: string[] = [];
  for (const [filename, count] of pendingDocCache) {
    // Validate file still exists on disk (prunes ghost entries after server restart)
    const filePath = isExternalDoc(filename) ? filename : join(getDataDir(), filename);
    if (!existsSync(filePath)) {
      stale.push(filename);
      continue;
    }
    filenames.push(filename);
    counts[filename] = count;
  }
  // Clean up stale entries
  for (const f of stale) pendingDocCache.delete(f);
  return { filenames, counts };
}

// ============================================================================
// PERSISTENCE
// ============================================================================

function writeToDisk(actor: Actor = 'human'): void {
  // No-op gate: when the in-memory document hasn't been mutated since the
  // last successful write (or byte-equality skip), bail before any work.
  // Skips the full serialize + matcher pipeline (~50ms on medium docs), the
  // sidecar overlay write, the snapshot read+write, and the mtime bump that
  // would invalidate the doc cache. The existsSync check ensures first-save
  // of a new file still runs even when version state looks clean.
  // adr: adr/pending-overlay-model.md
  if (state.filePath && existsSync(state.filePath) && docVersion === lastSavedDocVersion) {
    return;
  }

  ensureDataDir();

  // Stub graduation: once the doc contains accepted content, it's no longer
  // a fresh stub. Remove it from the in-memory stub registry so reject-all
  // can never trigger the cleanup-delete on it.
  // adr: adr/agent-stub-model.md
  if (hasAcceptedContent(state.document)) {
    unmarkAgentStub(activeDocFilename());
  }

  // Defensive: never serialize `agentCreated` to disk. The field is dead;
  // any code reading it would be the bug, not the field's presence.
  if (state.metadata) {
    stripLegacyAgentCreated(state.metadata);
    stripLegacyBacklinks(state.metadata);
  }

  let markdown: string;
  if (isExternalDoc(state.filePath)) {
    // External files: preserve original frontmatter verbatim, no OpenWriter metadata injected.
    // External docs don't participate in the pending overlay system (the external editor
    // is the source of truth for the file's structure).
    const body = tiptapToBody(state.document).replace(/(?:\s*<!-- -->\s*)+$/, '\n');
    markdown = state.originalFrontmatter
      ? `---\n${state.originalFrontmatter}\n---\n\n${body}`
      : body;
  } else {
    // Save-time matcher pass + pending overlay split.
    //
    // Architectural model: disk is canonical only. Pending state lives in a
    // sidecar at `_pending/{docId}.json`. We split state.document into:
    //   - canonical: a clone with all pending reverted (matcher operates on this)
    //   - overlay: the extracted pending entries (saved to sidecar)
    //
    // The matcher runs on canonical so the on-disk `nodes:` fingerprints match
    // the on-disk body. Pre-matcher canonical IDs are translated to post-matcher
    // IDs and the same translation is applied to (a) state.document, so the
    // in-memory tree stays consistent with disk, and (b) the overlay entries,
    // so they re-anchor correctly on reload.
    //
    // adr: adr/node-identity-matcher.md · adr: adr/pending-overlay-model.md
    const canonical = cloneWithPendingReverted(state.document);
    const { previousNodes, graveyard } = readPersistedIdentity(state.filePath);
    // previousNodes and graveyard are already in rich Fingerprint form —
    // readPersistedIdentity handles slim-tuple enrichment and legacy
    // re-fingerprinting before returning. Matcher gets a uniform input
    // regardless of what's on disk.
    // adr: adr/node-identity-matcher.md
    //
    // newBlocks is computed once and reused by:
    //   (a) the matcher branch below (when there are previous nodes to match)
    //   (b) the enrichment staleness check (always — even on first save)
    // Hoisted outside the matcher conditional so first-save staleness still
    // gets the current sentence-hash signal.
    const newBlocks = tiptapToBlocks(canonical);
    let nextGraveyard = graveyard;
    const idTranslation = new Map<string, string>();
    if (previousNodes.length > 0) {
      const beforeIds = newBlocks.map((b) => b.id);
      const matchResult = matchNodes(previousNodes, newBlocks, { graveyard: nextGraveyard });
      const pinnedByPosition = new Map<number, string>();
      for (const p of matchResult.pinned) pinnedByPosition.set(p.position, p.id);
      applyIdsToTiptap(canonical, pinnedByPosition);
      nextGraveyard = matchResult.nextGraveyard;

      // Build pre→post id translation (canonical's IDs match state.document's
      // IDs at non-insert positions, since cloneWithPendingReverted preserves
      // IDs on rewrite/delete/passthrough nodes).
      for (let i = 0; i < beforeIds.length; i++) {
        const oldId = beforeIds[i];
        const newId = pinnedByPosition.get(i);
        if (oldId && newId && oldId !== newId) {
          idTranslation.set(oldId, newId);
        }
      }
      // Apply translation to primary state. The matcher renamed IDs on
      // canonical (above); we need state.canonical, state.overlay's entry
      // keys (the nodeId fields), and state.document to all see the new IDs.
      if (idTranslation.size > 0) {
        applyIdTranslationToDoc(state.canonical, idTranslation);
        // Translate overlay entry nodeIds (rewrite/delete entries point at
        // canonical IDs that may have shifted; insert entries have unique
        // IDs not in the translation map and pass through).
        const newOverlay = new Map<string, PendingEntry>();
        for (const [nodeId, entry] of state.overlay) {
          const newNodeId = idTranslation.get(nodeId) ?? nodeId;
          newOverlay.set(newNodeId, { ...entry, nodeId: newNodeId });
        }
        state.overlay = newOverlay;
        recomputeMerged();
      }

      // Broadcast id-rewrites so browser clients converge their TipTap state.
      if (idRewriteListeners.size > 0 && idTranslation.size > 0) {
        const rewrites: IdRewrite[] = Array.from(idTranslation, ([oldId, newId]) => ({ oldId, newId }));
        for (const listener of idRewriteListeners) listener(rewrites);
      }
    }

    // Persist the structured overlay to sidecar. state.overlay IS the overlay
    // in the new model — no extraction needed.
    if (state.docId) {
      saveOverlay(state.docId, Array.from(state.overlay.values()));
    }

    // ENRICHMENT STALENESS — reuses the matcher's sentence-hash machinery.
    // After the matcher pass, harvest current sentence hashes + char count
    // from the same blocks the matcher just operated on; compare against the
    // at-enrichment baseline in frontmatter. Flip enrichmentStale=true when
    // volume or drift thresholds trip. OpenWriter never clears the flag —
    // that's the agent's job via mark_enriched (Phase 4).
    //
    // adr: see brief 2026-05-18-frontmatter-enrichment-system
    try {
      const currentSentences = harvestSentenceHashes(newBlocks);
      const currentChars = harvestCharCount(newBlocks);
      const stale = isEnrichmentStale(currentSentences, currentChars, state.metadata);
      if (stale && state.metadata.enrichmentStale !== true) {
        state.metadata.enrichmentStale = true;
        diagLog(`[Enrichment] stale: ${state.filePath}`);
      }
    } catch (err) {
      // Staleness detection is observational, never load-bearing for the save.
      console.error('[Enrichment] staleness check failed:', err);
    }

    // Pass graveyard through metadata so the serializer can emit it in frontmatter.
    const metaWithGraveyard = nextGraveyard.length > 0
      ? { ...state.metadata, graveyard: nextGraveyard.map((g) => ({ id: g.id, fp: g.fingerprint })) }
      : state.metadata;

    // Checked serializer — operates on canonical (already pending-reverted).
    // The serializer no longer emits `meta.pending` (overlay handles that).
    const result = tiptapToMarkdownChecked(canonical, state.title, metaWithGraveyard);
    markdown = result.markdown;

    // Author attribution (Tier A + Tier B). MUST run here — alongside the
    // overlay save and BEFORE the "content identical" / external-write /
    // destructive-save guards below. An agent that adds ONLY pending content
    // leaves the canonical body byte-identical, so those guards short-circuit
    // the disk write; but the MERGED state (state.document) DID change and was
    // just persisted to the overlay sidecar — so its attribution must be
    // captured too. Capture from the MERGED doc (NOT canonical) so an agent's
    // pending proposals are stamped 'agent' at write time; because blame is
    // anchored to the sentence content hash, a later human ACCEPT leaves the
    // hash unchanged and the agent origin holds (accept never launders).
    // The version binding happens after the body write (a pending-only save
    // produces no new snapshot, which is correct — it isn't a new version).
    // adr: adr/document-history-attribution.md
    if (state.docId) {
      try {
        captureAttribution(state.docId, tiptapToBlocks(state.document), actor, Date.now());
        // Agent-finished commit trigger (debounced, per-doc). Fires from the
        // CAPTURE site — the only place that reliably sees every agent edit tool
        // (write_to_pad/populate/edit_text) with the exact target docId. The
        // spinner broadcast (broadcastWritingFinished) was the wrong hook: not
        // all write tools fire it. adr: adr/document-history-attribution.md
        if (actor === 'agent' && state.filePath) scheduleAgentCommit(state.docId, state.filePath);
      } catch (err) {
        console.error('[Attribution] capture failed:', err);
      }
    }
  }

  if (existsSync(state.filePath)) {
    // Skip write if content is identical (prevents phantom git changes on doc switch)
    try {
      const existing = readFileSync(state.filePath, 'utf-8');
      if (existing === markdown) {
        // Even on a no-op write, refresh our mtime snapshot so we don't
        // misread a stale `loadedMtime` as evidence of an external write.
        try { state.loadedMtime = statSync(state.filePath).mtimeMs; } catch { /* best-effort */ }
        // Mark in-sync at this docVersion so the next save bails at the
        // top-level gate before re-running serialize. Without this, the
        // gate would only kick in after a real disk write.
        lastSavedDocVersion = docVersion;
        return;
      }
    } catch { /* read failed, proceed with write */ }

    // EXTERNAL-WRITE GUARD: if disk mtime is newer than the mtime we stamped
    // at load (or our last successful save), an external writer modified the
    // file out from under us. Blindly writing our in-memory state would
    // clobber their content silently. Block the write, log, and surface via
    // sync-status so the agent/user can resolve via reload_from_disk.
    //
    // Edge cases handled:
    //   - First save of a new doc: loadedMtime=0, so the guard never fires
    //     (every real file's mtime will be > 0).
    //   - Atomic-write race: writeFileSync momentarily mtime-bumps. We re-
    //     stamp loadedMtime AFTER every successful own write so subsequent
    //     guard checks compare against our own write, not a phantom delta.
    //   - Clock drift: we compare exact ms equality (not >); any change at
    //     all is treated as external. Filesystems guarantee monotonic mtime
    //     per file on the same host so this is safe.
    if (state.loadedMtime > 0) {
      try {
        const diskMtime = statSync(state.filePath).mtimeMs;
        if (diskMtime !== state.loadedMtime) {
          console.error(
            `[State] BLOCKED save: external write detected on ${state.filePath} ` +
            `(disk mtime ${new Date(diskMtime).toISOString()} != loaded mtime ${new Date(state.loadedMtime).toISOString()}). ` +
            `Call reload_from_disk to adopt external content, or write_to_pad to re-apply changes on top.`
          );
          notifyExternalWriteConflict(state.filePath, diskMtime, state.loadedMtime);
          return;
        }
      } catch { /* stat failed, proceed with save */ }
    }

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

  atomicWriteFileSync(state.filePath, markdown);
  // Re-stamp loadedMtime so the next save's guard compares against our own
  // most-recent write, not the prior load's mtime.
  try { state.loadedMtime = statSync(state.filePath).mtimeMs; } catch { /* best-effort */ }
  // Record that disk now matches in-memory at this docVersion. Subsequent
  // save() calls without further mutations will bail at the top-level gate.
  lastSavedDocVersion = docVersion;

  // Best-effort version snapshot — never blocks saves. Returns the cut ts
  // (or null if throttled/unchanged) so attribution can bind to this version.
  // Attribution itself was already captured in the else branch above (so a
  // pending-only save, which skips the body write, is still attributed); here
  // we just stamp the blame with the version cut when a real snapshot landed.
  let snapshotTs: number | null = null;
  try { snapshotTs = snapshotIfNeeded(state.docId, state.filePath); } catch { /* ignore */ }
  if (snapshotTs && !isExternalDoc(state.filePath) && state.docId) {
    try { bindBlameToVersion(state.docId, snapshotTs); } catch { /* best-effort */ }
  }

  // Auto-sync references from prose: legacy `doc:` prose links still render
  // (PadLink extension), but the graph/crawl/backlinks-panel read the
  // structural `references:` field. After every save, scan the body for
  // prose links and merge their targets into references — backward compat
  // without forcing rewrites. Then invalidate the live-backlinks cache so
  // the next /api/backlinks/:docId call sees the fresh inverse.
  // Best-effort — never blocks the save it follows.
  if (!isExternalDoc(state.filePath) && state.docId) {
    try {
      const sync = syncReferencesFromProse(state.docId, state.document, state.metadata || {});
      if (sync && state.metadata) {
        state.metadata.references = sync.newReferences;
        // Second tiny write: re-persist frontmatter only (body already on disk).
        const filename = state.filePath.split(/[/\\]/).pop() || '';
        writeFrontmatter(filename, state.metadata);
      }
    } catch (err) {
      console.error('[State] references auto-sync failed:', err);
    }
    invalidateBacklinksCache();
  }
}

export function save(actor?: Actor): void {
  // Resolve the save-scoped actor. Explicit arg wins; else fall back to the
  // actor who scheduled the pending debounce batch this save is flushing; else
  // 'human' (system/user-initiated saves that don't author prose produce no
  // attribution spans anyway). adr: adr/document-history-attribution.md
  // If an explicit actor differs from a pending-batch actor, flush that batch
  // first under its own actor so this save never absorbs another actor's edits.
  if (actor && saveTimer && pendingSaveActor && pendingSaveActor !== actor) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const prior = pendingSaveActor;
    pendingSaveActor = null;
    writeToDisk(prior);
  }
  const resolvedActor: Actor = actor ?? pendingSaveActor ?? 'human';
  pendingSaveActor = null;

  // Auto-title from body content if the title is still default/empty.
  // Runs BEFORE filePath assignment so a brand-new doc lands at its
  // derived-title filename directly (no temp-file detour). For already-
  // saved temp files, the listener (ws.ts) calls promoteTempFile to
  // rename on disk. External docs are skipped — we never rename files
  // the user manages outside the openwriter data dir.
  //
  // `bumpDocVersion()` is required to defeat writeToDisk's no-op gate
  // when only the title changed (no body mutation between saves). Without
  // it, the title update would live in memory only and never reach disk.
  if (!isExternalDoc(state.filePath ?? '') && shouldAutoTitle(state.title)) {
    const derived = titleFromDoc(state.document as any);
    if (derived && derived !== state.title) {
      state.title = derived;
      if (state.metadata) state.metadata.title = derived;
      bumpDocVersion();
      notifyAutoTitleApplied(derived);
    }
  }

  if (!state.filePath) {
    // First save — assign a file path. Canonicalize at this identity
    // boundary so cache lookups and watcher subscriptions key on the
    // same string regardless of how this path was produced.
    // adr: adr/path-canonicalization.md
    ensureDataDir();
    if (state.title === 'Untitled') {
      state.filePath = canonicalizePath(tempFilePath());
      state.isTemp = true;
    } else {
      state.filePath = canonicalizePath(filePathForTitle(state.title));
      state.isTemp = false;
    }
  }
  writeToDisk(resolvedActor);
}

export function load(): void {
  ensureDataDir();

  // One-time sidecar repair MUST run before any doc loads so the file-walk
  // loop reads deduped sidecars, not corrupted ones. adr: adr/pending-overlay-model.md
  repairOverlaysOnStartup();

  // Restore external document registry from disk
  loadExternalDocs();

  // Migrate any .sw.json files to .md
  migrateSwJsonFiles();

  // Clean up empty temp files from previous sessions
  cleanupEmptyTempFiles();

  // Find most recently modified .md file
  const files = readdirSync(getDataDir())
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fullPath = join(getDataDir(), f);
      const stat = statSync(fullPath);
      return { name: f, path: fullPath, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  // Walk sorted files until we find a real document with content.
  // Skip empty temp files so we don't open a blank scratch pad when real docs exist.
  for (const file of files) {
    try {
      const raw = readFileSync(file.path, 'utf-8');
      const parsed = markdownToTiptap(raw);
      const isTemp = file.name.startsWith(TEMP_PREFIX);

      // Skip empty temp files — prefer a real document
      if (isTemp && isDocEmpty(parsed.document)) continue;

      // Route the parsed doc through the primary-state setter — splits into
      // canonical + overlay (handles legacy in-frontmatter pending) and
      // recomputes the merged view via state.document.
      setPrimaryFromMerged(parsed.document);
      state.title = parsed.title;
      state.metadata = parsed.metadata;
      // Legacy: strip any pre-architectural-fix `agentCreated` field that
      // survived on disk. The in-memory stub registry is the only authority.
      stripLegacyAgentCreated(state.metadata);
      state.lastModified = new Date(statSync(file.path).mtimeMs);
      state.filePath = canonicalizePath(file.path);
      state.isTemp = isTemp;
      state.loadedMtime = statSync(file.path).mtimeMs;

      // Lazy docId migration: assign if missing, save to persist
      const hadDocId = !!state.metadata.docId;
      state.docId = ensureDocId(state.metadata);
      if (!hadDocId) {
        const md = tiptapToMarkdown(state.document, state.title, state.metadata);
        atomicWriteFileSync(state.filePath, md);
        try { state.loadedMtime = statSync(state.filePath).mtimeMs; } catch { /* best-effort */ }
      }

      // Pending overlay merge: rehydrate pending decorations from the sidecar.
      // For legacy files (parser stamped pending attrs from old `meta.pending`),
      // capture those into the overlay format and write the sidecar as a one-
      // time migration. For migrated files (parser stamped nothing because
      // `meta.pending` is gone from frontmatter), the sidecar is the only
      // source.
      // adr: adr/pending-overlay-model.md
      mergeOverlayOnLoad();

      // Pending metadata rehydration. Boot path bypasses setActiveDocument,
      // so the per-doc sidecar's `metadata:` slot must be loaded here too.
      // Without this, a server restart drops staged title renames from
      // in-memory state until the user switches docs.
      // adr: adr/pending-overlay-model.md
      state.pendingMetadata = state.docId ? loadPendingMetadata(state.docId) : null;
      break;
    } catch {
      // Corrupt file — try next one
      continue;
    }
  }

  // If nothing loaded (all files were empty temps or corrupt), start fresh
  if (!state.filePath) {
    state.filePath = canonicalizePath(tempFilePath());
    state.isTemp = true;
  }

  // Populate pending doc cache from disk (single scan on startup)
  populatePendingCache();
  // Overlay active doc's in-memory state (may have unsaved pending changes)
  updatePendingCacheForActiveDoc();

  // Subscribe the active-doc watcher so external writes route through the
  // unified reload pathway. adr: adr/active-doc-watcher.md
  startActiveDocWatcher();

  // Startup lock: block browser doc-updates briefly to prevent stale reconnect pushes
  setAgentLockGlobal();
}

/** Migrate legacy .sw.json files to .md format */
function migrateSwJsonFiles(): void {
  try {
    const jsonFiles = readdirSync(getDataDir()).filter((f) => f.endsWith('.sw.json'));
    for (const f of jsonFiles) {
      const jsonPath = join(getDataDir(), f);
      const mdName = f.replace(/\.sw\.json$/, '.md');
      const mdPath = join(getDataDir(), mdName);

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
    const wsDir = join(getDataDir(), '_workspaces');
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
    const files = readdirSync(getDataDir()).filter((f) => f.startsWith(TEMP_PREFIX) && f.endsWith('.md'));
    for (const f of files) {
      // Never delete temp files that are referenced by a workspace
      if (wsRefs.has(f)) continue;
      const fullPath = join(getDataDir(), f);
      try {
        const raw = readFileSync(fullPath, 'utf-8');
        const parsed = markdownToTiptap(raw);
        // Keep temp files that have meaningful metadata (templates, pending changes, tags).
        // Note: `agentCreated` used to be a disk-frontmatter signal here. Stub status is now
        // in-memory only — see agentStubFilenames. An empty temp file with no other meaningful
        // metadata that survived a server restart is by definition no longer a fresh stub and
        // can be cleaned up.
        const meta = parsed.metadata || {};
        const hasMetadata = meta.tweetContext || meta.articleContext || meta.pending
          || (Array.isArray(meta.tags) && meta.tags.length > 0);
        if (isDocEmpty(parsed.document) && !hasMetadata) {
          unlinkSync(fullPath);
        }
      } catch {
        // Corrupt temp file — delete it (but only if not workspace-referenced)
        try { unlinkSync(fullPath); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore errors during cleanup */ }
}


// ============================================================================
// MTIME HELPERS (preserve file modification time for metadata-only writes)
// ============================================================================

function safeGetMtime(filePath: string): Date | null {
  try { return statSync(filePath).mtime; } catch { return null; }
}

function safeRestoreMtime(filePath: string, mtime: Date): void {
  try { utimesSync(filePath, new Date(), mtime); } catch { /* best-effort */ }
}

// ============================================================================
// DOCUMENT-LEVEL TAG OPERATIONS
// ============================================================================

/** Get tags for the active document from its metadata. */
export function getDocTags(): string[] {
  const tags = state.metadata.tags;
  return Array.isArray(tags) ? tags : [];
}

/** Get tags for any document by filename (reads from disk if not active). */
export function getDocTagsByFilename(filename: string): string[] {
  // If it's the active doc, use in-memory state
  const activeFilename = state.filePath
    ? (isExternalDoc(state.filePath) ? state.filePath : state.filePath.split(/[/\\]/).pop() || '')
    : '';
  if (filename === activeFilename) return getDocTags();

  // Otherwise read from disk
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) return [];
  try {
    const raw = readFileSync(targetPath, 'utf-8');
    const { data } = matter(raw);
    return Array.isArray(data.tags) ? data.tags : [];
  } catch { return []; }
}

/** Add a tag to a document. Works on active doc or any file on disk. */
export function addDocTag(filename: string, tag: string): void {
  const activeFilename = state.filePath
    ? (isExternalDoc(state.filePath) ? state.filePath : state.filePath.split(/[/\\]/).pop() || '')
    : '';

  if (filename === activeFilename) {
    // Active doc — update in-memory metadata
    const tags: string[] = Array.isArray(state.metadata.tags) ? [...state.metadata.tags] : [];
    if (!tags.includes(tag)) {
      tags.push(tag);
      state.metadata.tags = tags;
      // Same docVersion contract as setMetadata: tag changes mutate
      // state.metadata, so they must bump or writeToDisk's no-op gate
      // silently drops the write.
      bumpDocVersion();
      // Preserve mtime — tag changes shouldn't affect sidebar sort order.
      // After rolling back disk mtime, we MUST also roll back state.loadedMtime
      // (which writeToDisk just stamped to the post-write disk mtime).
      // The fs.watch self-suppression contract is `diskMtime === loadedMtime`;
      // a divergence here will fire a phantom "external write detected"
      // reload banner when the watcher's debounced handler runs.
      const mtime = state.filePath ? safeGetMtime(state.filePath) : null;
      save();
      if (mtime && state.filePath) {
        safeRestoreMtime(state.filePath, mtime);
        try { state.loadedMtime = statSync(state.filePath).mtimeMs; } catch { /* best-effort */ }
      }
    }
  } else {
    // Non-active doc — read/write disk (skip external files: tags are OpenWriter metadata)
    const targetPath = resolveDocPath(filename);
    if (isExternalDoc(targetPath) || !existsSync(targetPath)) return;
    try {
      const raw = readFileSync(targetPath, 'utf-8');
      const parsed = markdownToTiptap(raw);
      const tags: string[] = Array.isArray(parsed.metadata.tags) ? [...parsed.metadata.tags] : [];
      if (!tags.includes(tag)) {
        tags.push(tag);
        parsed.metadata.tags = tags;
        const mtime = safeGetMtime(targetPath);
        const markdown = tiptapToMarkdown(parsed.document, parsed.title, parsed.metadata);
        atomicWriteFileSync(targetPath, markdown);
        if (mtime) safeRestoreMtime(targetPath, mtime);
      }
    } catch { /* best-effort */ }
  }
}

/** Remove a tag from a document. Works on active doc or any file on disk. */
export function removeDocTag(filename: string, tag: string): void {
  const activeFilename = state.filePath
    ? (isExternalDoc(state.filePath) ? state.filePath : state.filePath.split(/[/\\]/).pop() || '')
    : '';

  if (filename === activeFilename) {
    const tags: string[] = Array.isArray(state.metadata.tags) ? [...state.metadata.tags] : [];
    const idx = tags.indexOf(tag);
    if (idx >= 0) {
      tags.splice(idx, 1);
      state.metadata.tags = tags.length > 0 ? tags : undefined;
      // Same docVersion contract as addDocTag — mutation must bump or
      // writeToDisk's no-op gate silently drops the write.
      bumpDocVersion();
      // Same loadedMtime re-stamp as addDocTag — see comment there.
      const mtime = state.filePath ? safeGetMtime(state.filePath) : null;
      save();
      if (mtime && state.filePath) {
        safeRestoreMtime(state.filePath, mtime);
        try { state.loadedMtime = statSync(state.filePath).mtimeMs; } catch { /* best-effort */ }
      }
    }
  } else {
    // Non-active doc — read/write disk (skip external files: tags are OpenWriter metadata)
    const targetPath = resolveDocPath(filename);
    if (isExternalDoc(targetPath) || !existsSync(targetPath)) return;
    try {
      const raw = readFileSync(targetPath, 'utf-8');
      const parsed = markdownToTiptap(raw);
      const tags: string[] = Array.isArray(parsed.metadata.tags) ? [...parsed.metadata.tags] : [];
      const idx = tags.indexOf(tag);
      if (idx >= 0) {
        tags.splice(idx, 1);
        parsed.metadata.tags = tags.length > 0 ? tags : undefined;
        const mtime = safeGetMtime(targetPath);
        const markdown = tiptapToMarkdown(parsed.document, parsed.title, parsed.metadata);
        atomicWriteFileSync(targetPath, markdown);
        if (mtime) safeRestoreMtime(targetPath, mtime);
      }
    } catch { /* best-effort */ }
  }
}

// ============================================================================
// CROSS-DOCUMENT HELPERS (operate on specific files, not the active singleton)
// ============================================================================

/**
 * Save a browser doc-update to a specific file on disk.
 * Used when the browser sends a doc-update for a non-active document (race condition guard).
 *
 * Disk gets canonical (pending stripped by serialization). Any pending attrs
 * carried on `doc` (transferred from disk) are persisted to the overlay
 * sidecar in the same pass. Without the symmetric overlay save, pending
 * content would vanish silently between the strip-during-serialize and the
 * disk write.
 * adr: adr/pending-overlay-model.md
 */
export function saveDocToFile(filename: string, doc: PadDocument): void {
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) return; // Target doesn't exist, nothing to save to
  try {
    const raw = readFileSync(targetPath, 'utf-8');
    const parsed = markdownToTiptap(raw);
    // Browser-write fidelity: this routes a doc-update to a NON-active file
    // (the server switched away mid-flight). Refuse a clobbering collapse
    // against the target's own on-disk body; checkpoint it first.
    // adr: adr/browser-write-fidelity.md
    if (wouldCollapseBody(parsed.document, doc)) {
      const refuseDocId = (parsed.metadata && typeof parsed.metadata.docId === 'string') ? parsed.metadata.docId : '';
      if (refuseDocId) forceSnapshot(refuseDocId, targetPath);
      console.error(`[State] REFUSED body-collapse in saveDocToFile(${filename}): ${doc?.content?.length ?? 0} nodes would replace ${parsed.document?.content?.length ?? 0} nodes (checkpointed, write refused)`);
      return;
    }
    // Transfer pending attrs from on-disk version to the incoming doc
    if (hasPendingChanges(parsed.document)) {
      transferPendingAttrs(parsed.document, doc);
    }
    let markdown: string;
    if (isExternalDoc(targetPath)) {
      const body = tiptapToBody(doc);
      markdown = parsed.rawFrontmatter
        ? `---\n${parsed.rawFrontmatter}\n---\n\n${body}`
        : body;
    } else {
      markdown = tiptapToMarkdown(doc, parsed.title, parsed.metadata);
    }
    atomicWriteFileSync(targetPath, markdown);
    const docId = (parsed.metadata && typeof parsed.metadata.docId === 'string') ? parsed.metadata.docId : '';
    if (docId) {
      const overlay = extractOverlay(doc);
      saveOverlay(docId, overlay);
      // This routes a BROWSER doc-update to a non-active file — the content is
      // the human's. Snapshot + attribute as 'human'. adr: adr/document-history-attribution.md
      if (!isExternalDoc(targetPath)) {
        let snapshotTs: number | null = null;
        try { snapshotTs = snapshotIfNeeded(docId, targetPath); } catch { /* ignore */ }
        try {
          captureAttribution(docId, tiptapToBlocks(doc), 'human', Date.now());
          if (snapshotTs) bindBlameToVersion(docId, snapshotTs);
        } catch (err) { console.error('[Attribution] saveDocToFile capture failed:', err); }
      }
    }
    // Backlinks cache invalidate — browser sent a doc-update for a non-active
    // doc; the prose-link set on that doc may have changed.
    invalidateBacklinksCache();
  } catch { /* best-effort */ }
}

/**
 * Set or clear the autoAccept flag on a non-active document file on disk.
 * Reads the file, mutates metadata, writes back. Does not touch pending attrs —
 * callers should run stripPendingAttrsFromFile first when enabling.
 */
export function setAutoAcceptOnFile(filename: string, enabled: boolean): void {
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) return;
  try {
    const raw = readFileSync(targetPath, 'utf-8');
    const parsed = markdownToTiptap(raw);
    // Explicit false (not delete) so the user's "off" overrides any workspace inheritance.
    parsed.metadata.autoAccept = enabled;
    let markdown: string;
    if (isExternalDoc(targetPath)) {
      const body = tiptapToBody(parsed.document);
      markdown = parsed.rawFrontmatter
        ? `---\n${parsed.rawFrontmatter}\n---\n\n${body}`
        : body;
    } else {
      markdown = tiptapToMarkdown(parsed.document, parsed.title, parsed.metadata);
    }
    atomicWriteFileSync(targetPath, markdown);
    invalidateDocCache(targetPath);
  } catch { /* best-effort */ }
}

/** Write a sortRequest marker onto a file. Stamps requestedAt; the agent
 *  picks the doc up via list_pending_sorts and writes a proposal back. */
export function setSortRequestOnFile(filename: string): void {
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) return;
  try {
    const raw = readFileSync(targetPath, 'utf-8');
    const parsed = markdownToTiptap(raw);
    parsed.metadata.sortRequest = { requestedAt: new Date().toISOString() };
    let markdown: string;
    if (isExternalDoc(targetPath)) {
      const body = tiptapToBody(parsed.document);
      markdown = parsed.rawFrontmatter
        ? `---\n${parsed.rawFrontmatter}\n---\n\n${body}`
        : body;
    } else {
      markdown = tiptapToMarkdown(parsed.document, parsed.title, parsed.metadata);
    }
    atomicWriteFileSync(targetPath, markdown);
    invalidateDocCache(targetPath);
  } catch { /* best-effort */ }
}

/** Clear sortRequest and stamp lastSortedAt. Used on fulfillment (accept
 *  or reject) — the marker retires the same way enrichmentStale retires
 *  to lastEnrichedAt. */
export function clearSortRequestOnFile(filename: string): void {
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) return;
  try {
    const raw = readFileSync(targetPath, 'utf-8');
    const parsed = markdownToTiptap(raw);
    delete parsed.metadata.sortRequest;
    parsed.metadata.lastSortedAt = new Date().toISOString();
    let markdown: string;
    if (isExternalDoc(targetPath)) {
      const body = tiptapToBody(parsed.document);
      markdown = parsed.rawFrontmatter
        ? `---\n${parsed.rawFrontmatter}\n---\n\n${body}`
        : body;
    } else {
      markdown = tiptapToMarkdown(parsed.document, parsed.title, parsed.metadata);
    }
    atomicWriteFileSync(targetPath, markdown);
    invalidateDocCache(targetPath);
  } catch { /* best-effort */ }
}

/** Stamp a proposal onto an existing sortRequest. Used by the agent after
 *  it has picked a destination — the UI flips the badge to "proposal ready"
 *  and the user accepts/rejects via the in-menu popover. */
export function setSortProposalOnFile(filename: string, proposal: { wsFilename: string; containerId: string | null; reasoning: string }): void {
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) return;
  try {
    const raw = readFileSync(targetPath, 'utf-8');
    const parsed = markdownToTiptap(raw);
    const existing = parsed.metadata.sortRequest;
    if (!existing || typeof existing !== 'object') return; // no request to attach to
    parsed.metadata.sortRequest = { ...existing, proposal };
    let markdown: string;
    if (isExternalDoc(targetPath)) {
      const body = tiptapToBody(parsed.document);
      markdown = parsed.rawFrontmatter
        ? `---\n${parsed.rawFrontmatter}\n---\n\n${body}`
        : body;
    } else {
      markdown = tiptapToMarkdown(parsed.document, parsed.title, parsed.metadata);
    }
    atomicWriteFileSync(targetPath, markdown);
    invalidateDocCache(targetPath);
  } catch { /* best-effort */ }
}

/**
 * Strip pending attrs from a specific file on disk (not the active document).
 *
 * The `_legacyClearAgentCreated` parameter is preserved for callsite-signature
 * stability but no longer does anything meaningful. Stub status is in-memory
 * only — there is no `agentCreated` field to clear on disk. The on-load
 * legacy-strip handles any residual occurrences from pre-architectural-fix
 * files.
 * adr: adr/agent-stub-model.md
 */
export function stripPendingAttrsFromFile(filename: string, _legacyClearAgentCreated?: boolean): void {
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) return;
  try {
    const raw = readFileSync(targetPath, 'utf-8');
    const parsed = markdownToTiptap(raw);
    // Strip pending attrs from the parsed document
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
    strip(parsed.document.content);
    // Belt-and-suspenders: strip any legacy on-disk agentCreated (e.g. an
    // old file that hasn't been re-saved since the migration).
    stripLegacyAgentCreated(parsed.metadata);
    let markdown: string;
    if (isExternalDoc(targetPath)) {
      const body = tiptapToBody(parsed.document);
      markdown = parsed.rawFrontmatter
        ? `---\n${parsed.rawFrontmatter}\n---\n\n${body}`
        : body;
    } else {
      markdown = tiptapToMarkdown(parsed.document, parsed.title, parsed.metadata);
    }
    atomicWriteFileSync(targetPath, markdown);
    // Pending was just cleared on disk; the sidecar overlay must go too,
    // otherwise the next load would re-apply stale pending entries.
    // adr: adr/pending-overlay-model.md
    const docId = (parsed.metadata && typeof parsed.metadata.docId === 'string') ? parsed.metadata.docId : '';
    if (docId) deleteOverlay(docId);
    removePendingCacheEntry(filename);
  } catch { /* best-effort */ }
}

/**
 * Populate a non-active document file with content.
 * Writes directly to disk without touching the active singleton.
 * Returns { title, wordCount, pendingCount } for the response message.
 */
/** Count pending nodes in a document tree. */
export function countPending(nodes: any[]): number {
  let count = 0;
  if (!nodes) return 0;
  for (const node of nodes) {
    if (node.attrs?.pendingStatus) count++;
    if (node.content) count += countPending(node.content);
  }
  return count;
}

/** Write a mutated doc back to disk and update the pending cache. */
/** Write a mutated doc back to disk and update the pending cache.
 *
 *  Disk gets canonical (pending stripped by `tiptapToMarkdown`). The
 *  overlay sidecar gets the extracted pending entries — without this,
 *  any pending content on `doc` vanishes between strip and disk write.
 *  This mirrors writeToDisk's active-doc path; the foundation commit
 *  established the contract there but missed this non-active-doc
 *  callsite. Without symmetric overlay save, populate_document /
 *  write_to_pad on a non-active doc silently dropped pending content.
 *  adr: adr/pending-overlay-model.md */
function flushDocToFile(filename: string, doc: PadDocument, title: string, metadata: Record<string, any>): void {
  const targetPath = resolveDocPath(filename);

  // Enrichment staleness — same signal as writeToDisk, but flushDocToFile
  // bypasses the matcher entirely so we harvest sentence hashes directly.
  // Measure the canonical (pending-reverted) view since that's what lands on
  // disk; pending overlay content rides in the sidecar and isn't part of the
  // doc's "published" content for enrichment purposes. External docs skip —
  // they don't participate in the enrichment graph.
  // adr: see brief 2026-05-18-frontmatter-enrichment-system
  if (!isExternalDoc(targetPath)) {
    try {
      const canonical = cloneWithPendingReverted(doc);
      const blocks = tiptapToBlocks(canonical);
      const currentSentences = harvestSentenceHashes(blocks);
      const currentChars = harvestCharCount(blocks);
      const stale = isEnrichmentStale(currentSentences, currentChars, metadata);
      if (stale && metadata.enrichmentStale !== true) {
        metadata.enrichmentStale = true;
      }
    } catch (err) {
      console.error('[Enrichment] staleness check (flush) failed:', err);
    }
  }

  const markdown = tiptapToMarkdown(doc, title, metadata);
  atomicWriteFileSync(targetPath, markdown);
  const docId = (metadata && typeof metadata.docId === 'string') ? metadata.docId : '';
  if (docId) {
    const overlay = extractOverlay(doc);
    saveOverlay(docId, overlay);

    // Door 3: non-active agent writes (populate_document / write_to_pad /
    // edit_text targeting a non-active doc). This path bypasses writeToDisk
    // and historically produced NO snapshot — so it had neither a restore
    // floor nor attribution. Add both. This door is ALWAYS the agent (humans
    // only edit the active doc in the browser), so actor is 'agent'.
    // adr: adr/document-history-attribution.md
    if (!isExternalDoc(targetPath)) {
      let snapshotTs: number | null = null;
      try { snapshotTs = snapshotIfNeeded(docId, targetPath); } catch { /* ignore */ }
      try {
        captureAttribution(docId, tiptapToBlocks(doc), 'agent', Date.now());
        if (snapshotTs) bindBlameToVersion(docId, snapshotTs);
        // Door 3 is always an agent write (non-active). Schedule its commit.
        scheduleAgentCommit(docId, targetPath);
      } catch (err) {
        console.error('[Attribution] door-3 capture failed:', err);
      }
    }
  }
  setPendingCacheEntry(filename, countPending(doc.content));
  // Backlinks cache invalidation — non-active write paths (populate_document on
  // a fresh doc, applyChangesToFile, applyTextEditsToFile) all funnel through
  // here. Any of them can change references: or the prose-link set, so the
  // computed inverse cache must drop. Mirrors the active-doc invalidate at the
  // tail of writeToDisk.
  invalidateBacklinksCache();
}

export function populateDocumentFile(filename: string, doc: PadDocument): { title: string; wordCount: number; pendingCount: number } {
  // Read the existing doc as the user-visible MERGED view — canonical body
  // plus any pre-existing sidecar overlay. Using the bare markdownToTiptap
  // here would silently drop pre-existing pending entries (the file's
  // sidecar lives outside the .md body), so a re-populate or a populate on
  // a doc with prior pending state would clobber the overlay on the
  // subsequent flushDocToFile. adr: adr/pending-overlay-model.md
  const loaded = loadDocFromDisk(filename);

  // Skip pending tagging when the target doc effectively has autoAccept on —
  // content commits directly as accepted.
  if (!isAutoAcceptActive(filename, loaded.metadata)) {
    markAllNodesAsPending(doc, 'insert');
  }

  // Preserve any pre-existing real content (pending nodes from a prior
  // populate or write) that isn't in the incoming set — so a re-populate or
  // populate-on-top doesn't clobber prior agent proposals. flushDocToFile
  // writes `doc` directly and extracts its overlay wholesale, so what isn't
  // in `doc.content` after this step disappears from the next save.
  //
  // Empty paragraphs are explicitly NOT preserved. createDocumentFile mints
  // a trailing empty paragraph as a TipTap "doc must have at least one
  // node" stub; that stub is obsolete the moment populate provides real
  // content, and preserving it leaves a phantom empty paragraph at the end
  // of every populated doc forever. Mirrors the active-doc preserve in
  // mcp.ts:populate_document. adr: adr/pending-overlay-model.md
  if (loaded.document?.content?.length) {
    const incomingIds = new Set(
      doc.content
        .map((n: any) => n?.attrs?.id)
        .filter((id: any) => typeof id === 'string'),
    );
    const preserved = loaded.document.content.filter((n: any) => {
      const id = n?.attrs?.id;
      if (!id || incomingIds.has(id)) return false;
      const isEmptyParagraph = n.type === 'paragraph' && (!n.content || n.content.length === 0);
      return !isEmptyParagraph;
    });
    if (preserved.length > 0) {
      doc.content = [...doc.content, ...preserved];
    }
  }

  flushDocToFile(filename, doc, loaded.title, loaded.metadata);

  const pendingCount = countPending(doc.content);
  const text = extractText(doc.content);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return { title: loaded.title, wordCount, pendingCount };
}

/**
 * Apply node changes to a non-active document file on disk.
 * Same logic as applyChanges but without touching the active singleton or broadcasting to browser.
 */
export function applyChangesToFile(filename: string, changes: NodeChange[]): { count: number; lastNodeId: string | null } {
  const targetPath = resolveDocPath(filename);

  // Try cache first — preserves stable node IDs
  const cached = getCachedDocument(targetPath);
  let doc: PadDocument;
  let title: string;
  let metadata: Record<string, any>;
  let docId: string;
  let isTemp: boolean;

  if (cached) {
    doc = structuredClone(cached.document);
    title = cached.title;
    metadata = cached.metadata;
    docId = cached.docId;
    isTemp = cached.isTemp;
  } else {
    // Cache miss — load the MERGED view (canonical + sidecar overlay). The
    // bare markdownToTiptap would give canonical-only, so pre-existing pending
    // entries would not be in `doc` when we apply the new changes. The
    // subsequent flushDocToFile then extracts the overlay from `doc` and
    // overwrites the sidecar — silently dropping every prior pending entry.
    // adr: adr/pending-overlay-model.md
    const loaded = loadDocFromDisk(filename);
    doc = loaded.document;
    title = loaded.title;
    metadata = loaded.metadata;
    docId = loaded.docId;
    isTemp = false;
  }

  const autoAccept = isAutoAcceptActive(filename, metadata);
  const processed = applyChangesToDoc(doc, changes, autoAccept);
  if (processed.length > 0) {
    flushDocToFile(filename, doc, title, metadata);
    updateCacheEntry(targetPath, doc, title, metadata, isTemp, docId);
  }

  // Find the last created node ID for chaining inserts
  let lastNodeId: string | null = null;
  for (let i = processed.length - 1; i >= 0; i--) {
    const change = processed[i];
    if (change.content) {
      const contentArr = Array.isArray(change.content) ? change.content : [change.content];
      const lastNode = contentArr[contentArr.length - 1];
      if (lastNode?.attrs?.id) {
        lastNodeId = lastNode.attrs.id;
        break;
      }
    }
  }

  return { count: processed.length, lastNodeId };
}

/**
 * Apply fine-grained text edits to a node in a non-active document file on disk.
 */
export function applyTextEditsToFile(filename: string, nodeId: string, edits: TextEdit[]): { success: boolean; error?: string } {
  const targetPath = resolveDocPath(filename);

  // Try cache first — preserves stable node IDs
  const cached = getCachedDocument(targetPath);
  let doc: PadDocument;
  let title: string;
  let metadata: Record<string, any>;
  let docId: string;
  let isTemp: boolean;

  if (cached) {
    doc = structuredClone(cached.document);
    title = cached.title;
    metadata = cached.metadata;
    docId = cached.docId;
    isTemp = cached.isTemp;
  } else {
    // Cache miss — load the merged view so a target node living in the
    // sidecar overlay (a pending insert the agent is now text-editing) is
    // findable. Bare markdownToTiptap would only show canonical, and the
    // findNode call below would fail. adr: adr/pending-overlay-model.md
    const loaded = loadDocFromDisk(filename);
    doc = loaded.document;
    title = loaded.title;
    metadata = loaded.metadata;
    docId = loaded.docId;
    isTemp = false;
  }

  const found = findNode(doc.content, nodeId, doc.content);
  if (!found) return { success: false, error: `Node ${nodeId} not found` };

  const originalNode = found.parent[found.index];
  const result = applyTextEditsToNode(originalNode, edits);
  if (!result) {
    const nodeText = extractText(originalNode.content || []);
    const truncated = nodeText.length > 240 ? nodeText.slice(0, 240) + '…' : nodeText;
    const searched = edits.map((e) => JSON.stringify(e.find)).join(', ');
    return { success: false, error: `No edits matched in node ${nodeId}. Searched: ${searched}. Node text starts: ${JSON.stringify(truncated)}` };
  }

  const autoAccept = isAutoAcceptActive(filename, metadata);
  // pendingTextEdits is the fine-grained inline-edit decoration — skip in autoAccept
  // since the change commits directly.
  if (!autoAccept) {
    result.node.attrs = {
      ...result.node.attrs,
      pendingTextEdits: result.textEdits,
    };
  }

  // Apply as a rewrite to the doc
  const processed = applyChangesToDoc(doc, [{
    operation: 'rewrite',
    nodeId,
    content: result.node,
  }], autoAccept);

  if (processed.length > 0) {
    flushDocToFile(filename, doc, title, metadata);
    updateCacheEntry(targetPath, doc, title, metadata, isTemp, docId);
  }

  return { success: true };
}
