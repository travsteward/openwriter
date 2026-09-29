/**
 * Pending overlay — the in-memory + sidecar layer that holds proposed
 * changes to a document. The disk `.md` file is canonical only; the
 * overlay is the agent's proposed mutations that the user hasn't
 * accepted or rejected yet.
 *
 * Architectural model:
 *   - Disk = canonical content. Clean markdown. External editors see
 *     what the user sees as "the doc," no pending decoration metadata.
 *   - Overlay = in-memory `Map<docId, PendingEntry[]>` mirrored to a
 *     sidecar JSON at `_pending/{docId}.json` so pending state survives
 *     graceful restarts. Sidecar is keyed by docId because filenames
 *     can change (renames) but docIds are stable.
 *   - Live state = canonical merged with overlay. Browser and MCP see
 *     this merged view — TipTap nodes with `pendingStatus` attrs.
 *
 * Pending entries are keyed by `nodeId` (the stable per-block ID the
 * matcher maintains). This is the load-bearing decision — position
 * keying fails when canonical content shifts (external edit,
 * restore_version), node IDs survive content changes by design.
 *
 * Reload flow:
 *   1. Canonical reloaded from disk.
 *   2. Matcher pairs old in-memory nodes to new canonical nodes via
 *      fingerprint, returning nodeId continuity.
 *   3. Overlay re-applied to new canonical by nodeId. Entries whose
 *      anchor nodeId no longer exists become "orphan" (rewrite→insert,
 *      delete→discarded). Entries whose target node exists but the
 *      content drifted from `originalBaseline` become "staleBaseline"
 *      (surfaced for review).
 *
 * adr: adr/pending-overlay-model.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { getDataDir, atomicWriteFileSync, resolveDocPath } from './helpers.js';
import { markdownToTiptap } from './markdown-parse.js';

// ============================================================================
// TYPES
// ============================================================================

export type PendingStatus = 'insert' | 'rewrite' | 'delete';

export interface PendingEntry {
  /** Stable per-block ID, set by the matcher. The key under which the
   *  overlay attaches to the canonical doc. For inserts, this is the
   *  nodeId of the inserted node itself (does not exist in canonical). */
  nodeId: string;
  status: PendingStatus;

  // ---- Anchor info (inserts only) ----
  /** The nodeId of the sibling immediately before this insert in
   *  canonical, or null if the insert goes at the start of its parent. */
  afterNodeId?: string | null;
  /** The nodeId of the parent in canonical (listItem, blockquote, etc.),
   *  or null if the insert goes at the document root. */
  parentNodeId?: string | null;

  // ---- Proposed content (inserts and rewrites) ----
  /** The new TipTap node the agent proposed. For inserts this is the
   *  node to add; for rewrites this is what the node becomes. */
  newContent?: any;

  // ---- Stale-baseline detection (rewrites only) ----
  /** Snapshot of the canonical node's content at the time the rewrite
   *  was proposed. On reload, if canonical's current node content
   *  differs from this baseline, the rewrite is `staleBaseline` —
   *  someone else edited the very thing the agent was trying to rewrite. */
  originalBaseline?: any;

  // ---- Sub-paragraph enhance fields ----
  pendingGroupId?: string;
  pendingTextEdits?: any;
  pendingSelectionFrom?: number;
  pendingSelectionTo?: number;
  pendingOriginalFrom?: number;
  pendingOriginalTo?: number;

  // ---- Concurrency tracking ----
  /** Server doc-version at which this entry was added or last updated by the
   *  agent. Used by the sync router to decide which entries survive a
   *  stale-version browser doc-update: entries with addedAtVersion higher
   *  than the browser's submitted version are agent additions the browser
   *  hasn't seen yet and must be preserved.
   *  Optional for backward compatibility with sidecars written before this
   *  field existed. */
  addedAtVersion?: number;
}

/** Result of applying an overlay to a canonical doc. */
export interface ApplyResult {
  /** Entries whose anchor nodeId no longer exists in canonical. Rewrites
   *  in this list have been auto-converted to inserts (creative content
   *  preserved). Deletes have been discarded. Inserts are still inserts
   *  (their afterNodeId/parentNodeId is gone, so they land at end of
   *  doc or last-known parent). */
  orphans: PendingEntry[];
  /** Rewrite entries whose target node exists but whose content has
   *  drifted from `originalBaseline`. The pending still applies (visible
   *  in the doc with pendingStatus='rewrite') but is flagged via
   *  `pendingStaleBaseline: true` on the node attrs. */
  staleBaseline: PendingEntry[];
}

// ============================================================================
// DIAGNOSTIC HELPERS — node-text preview + entry summary for log readability
// ============================================================================

// The diagLog function moved to `./logger.ts` (structured logger). Imported
// + re-exported here as a shim so existing import sites keep working; new
// code should call `logger.{level}(category, event, ...)` directly.
// adr: adr/logging-system.md
import { diagLog, logger, redactText } from './logger.js';
export { diagLog };

/** Extract a short text preview from a TipTap node for log readability.
 *  Returns the first ~60 chars of concatenated text content, or the node type
 *  if there's no text. Routes through `redactText` so document content is
 *  redacted when the log config has `includeText: false` (default for public
 *  installs — privacy by default). adr: adr/logging-system.md */
export function nodeTextPreview(node: any, limit = 60): string {
  if (!node) return '<null>';
  let text = '';
  function walk(n: any): void {
    if (!n) return;
    if (typeof n.text === 'string') { text += n.text; return; }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(node);
  if (!text) return `<${node.type || 'unknown'}>`;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const truncated = collapsed.length > limit ? collapsed.slice(0, limit) + '…' : collapsed;
  return redactText(truncated);
}

/** One-line summary of a pending entry for log readability. */
export function entrySummary(e: PendingEntry): string {
  const newPrev = nodeTextPreview(e.newContent);
  const origPrev = e.originalBaseline ? nodeTextPreview(e.originalBaseline) : '<none>';
  const identity = (e.status === 'rewrite' && e.newContent && e.originalBaseline && newPrev === origPrev)
    ? ' IDENTITY-WARNING(new===orig)'
    : '';
  return `${e.nodeId}/${e.status} new="${newPrev}" orig="${origPrev}"${identity}`;
}

// ============================================================================
// SIDECAR I/O
// ============================================================================

function getPendingDir(): string { return join(getDataDir(), '_pending'); }

function getSidecarPath(docId: string): string {
  return join(getPendingDir(), `${docId}.json`);
}

function ensurePendingDir(): void {
  const dir = getPendingDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadOverlay(docId: string): PendingEntry[] {
  if (!docId) return [];
  const path = getSidecarPath(docId);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data?.entries)) return data.entries;
    return [];
  } catch { return []; }
}

/**
 * Read the entire sidecar JSON object (raw). Used by pending-metadata.ts so
 * it can read the `metadata:` slot without re-implementing file I/O. Returns
 * null when the sidecar is missing or unreadable.
 */
export function readSidecarRaw(docId: string): any | null {
  if (!docId) return null;
  const path = getSidecarPath(docId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

/**
 * Atomically write the sidecar with the full JSON object. Both pending-overlay
 * (entries) and pending-metadata (metadata slot) share this single file, so
 * each must preserve the other's slot on every write. This is the low-level
 * primitive both use.
 *
 * If the resulting object has no entries AND no metadata, the sidecar is
 * deleted (absence = "nothing pending for this doc").
 */
export function writeSidecarRaw(docId: string, payload: { entries?: PendingEntry[]; metadata?: any }): void {
  if (!docId) return;
  const hasEntries = Array.isArray(payload.entries) && payload.entries.length > 0;
  const hasMeta = !!payload.metadata && Object.keys(payload.metadata).length > 0;
  if (!hasEntries && !hasMeta) {
    deleteOverlay(docId);
    return;
  }
  ensurePendingDir();
  const path = getSidecarPath(docId);
  const out: any = { version: 1 };
  if (hasEntries) out.entries = payload.entries;
  if (hasMeta) out.metadata = payload.metadata;
  atomicWriteFileSync(path, JSON.stringify(out, null, 2));
}

export function saveOverlay(docId: string, entries: PendingEntry[]): void {
  if (!docId) return;
  // Read previous on-disk sidecar BEFORE we overwrite, so we can log the diff.
  // adr: adr/pending-overlay-model.md
  const prevEntries = loadOverlay(docId);
  const prevById = new Map(prevEntries.map((e) => [e.nodeId, e]));
  // Deduplicate incoming entries by nodeId. The Map collapse enforces the
  // invariant "each nodeId appears at most once in the sidecar."
  //
  // TRIPWIRE — post-fix expectation: this dedup should never drop anything.
  // The historical generator (non-idempotent applyOverlay) is gone; the
  // splitMergedDoc path is now symmetric with the serializer; the read-side
  // paths route through applyOverlayPure which is idempotent by construction.
  // If `droppedDuplicates > 0` after those fixes landed, something
  // regressed — file a bug. The dedup itself stays as cheap defense, but
  // any non-zero drop count is a signal, not normal operation.
  // adr: adr/pending-overlay-model.md
  const dedupedMap = new Map<string, PendingEntry>();
  let droppedDuplicates = 0;
  for (const e of entries) {
    if (dedupedMap.has(e.nodeId)) {
      droppedDuplicates++;
      continue;
    }
    dedupedMap.set(e.nodeId, e);
  }
  if (droppedDuplicates > 0) {
    diagLog(`[Overlay] TRIPWIRE docId=${docId} dropped ${droppedDuplicates} duplicate entries by nodeId — generator regressed, investigate`);
  }
  const dedupedEntries = Array.from(dedupedMap.values());
  const newById = dedupedMap;
  const changes: string[] = [];
  for (const e of dedupedEntries) {
    const prev = prevById.get(e.nodeId);
    if (!prev) {
      changes.push(`+${entrySummary(e)}`);
    } else {
      const prevSig = entrySummary(prev);
      const newSig = entrySummary(e);
      if (prevSig !== newSig) changes.push(`~${e.nodeId} BEFORE="${nodeTextPreview(prev.newContent)}" AFTER="${nodeTextPreview(e.newContent)}"`);
    }
  }
  for (const e of prevEntries) {
    if (!newById.has(e.nodeId)) changes.push(`-${entrySummary(e)}`);
  }
  // Preserve the sidecar's `metadata` slot (used by pending-metadata.ts) across
  // entries-only writes. Without this read-modify-write, saving entries would
  // clobber any pending title-rename staged for the same doc.
  // adr: adr/pending-overlay-model.md
  const prevRaw = readSidecarRaw(docId);
  const prevMetadata = prevRaw?.metadata && Object.keys(prevRaw.metadata).length > 0 ? prevRaw.metadata : null;

  if (dedupedEntries.length === 0) {
    if (prevMetadata) {
      // Entries empty but metadata still pending — keep the sidecar alive with
      // metadata only.
      writeSidecarRaw(docId, { metadata: prevMetadata });
      if (prevEntries.length > 0) {
        diagLog(`[Overlay] SAVE docId=${docId} entries=0 (was ${prevEntries.length}) metadata preserved`);
      }
      return;
    }
    if (prevEntries.length > 0) {
      diagLog(`[Overlay] SAVE docId=${docId} → DELETE (was ${prevEntries.length} entries)`);
    }
    deleteOverlay(docId);
    return;
  }
  ensurePendingDir();
  const path = getSidecarPath(docId);
  const out: any = { version: 1, entries: dedupedEntries };
  if (prevMetadata) out.metadata = prevMetadata;
  atomicWriteFileSync(path, JSON.stringify(out, null, 2));
  if (changes.length > 0) {
    diagLog(`[Overlay] SAVE docId=${docId} entries=${dedupedEntries.length} changes=[${changes.join(' | ')}]`);
  }
  // TRIPWIRE — identity-rewrite detection. A rewrite where new===orig is a
  // degenerate state: nothing to review, the entry shouldn't exist.
  //
  // Post-fix expectation: unreachable. The two known generators are closed:
  //   - preview-swap echo (ReviewPanel.tsx togglePreview order flip, ADR
  //     entry 2026-05-17)
  //   - splitMergedDoc canonical-drift (stripPendingFromDoc restoration,
  //     ADR entry 2026-05-18)
  //
  // If this log fires post-fix, a third generator path exists — investigate
  // and shut it at the source rather than papering over via auto-resolve.
  // The earlier "Open follow-up" to refuse-to-persist these at saveOverlay
  // was deliberately NOT shipped: legitimate rewrites can converge to
  // identity via canonical evolution and should clear naturally at next
  // save, not get silently rejected here.
  // adr: adr/pending-overlay-model.md
  for (const e of dedupedEntries) {
    if (e.status === 'rewrite' && e.newContent && e.originalBaseline) {
      const newPrev = nodeTextPreview(e.newContent);
      const origPrev = nodeTextPreview(e.originalBaseline);
      if (newPrev === origPrev) {
        diagLog(`[Overlay] TRIPWIRE docId=${docId} nodeId=${e.nodeId} IDENTITY-REWRITE new===orig text="${newPrev}" — generator regressed, investigate`);
      }
    }
  }
}

/** docId → when its sidecar last changed. Sidecar writes happen only with a
 *  canonical save or a real pending change, so this marks review activity. */
export function listOverlayTimes(): Map<string, Date> {
  const times = new Map<string, Date>();
  const dir = getPendingDir();
  if (!existsSync(dir)) return times;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { times.set(f.slice(0, -5), statSync(join(dir, f)).mtime); } catch { /* removed mid-scan */ }
  }
  return times;
}

export function deleteOverlay(docId: string): void {
  if (!docId) return;
  const path = getSidecarPath(docId);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* best-effort */ }
  }
}

/** Clear every sidecar file. Called on profile switch / clearAllCaches. */
export function clearAllOverlays(): void {
  const dir = getPendingDir();
  if (!existsSync(dir)) return;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/**
 * One-time repair pass: walk every sidecar in _pending/, dedupe entries by
 * nodeId (keep first occurrence so the original anchor wins over the
 * self-referential corrupt anchors that the non-idempotent applyOverlay
 * bug produced), and rewrite the file. Runs once at startup as defense
 * against historical corruption.
 *
 * BACKWARD-COMPAT ONLY post-fix. The generators that produced duplicate
 * entries are architecturally closed (idempotent applyOverlayPure + correct
 * splitMergedDoc). This pass exists to clean up sidecars that were corrupted
 * BEFORE those fixes landed. If `[Overlay] STARTUP-REPAIR` log lines fire
 * on a profile that has been running on post-fix builds, that's a tripwire:
 * a new corruption path leaked through, find and fix it at the source.
 * Once enough time has passed that all production sidecars have been
 * rewritten cleanly through the new save paths, this can be removed.
 * adr: adr/pending-overlay-model.md
 */
export function repairOverlaysOnStartup(): void {
  const dir = getPendingDir();
  if (!existsSync(dir)) return;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch { return; }
  let repaired = 0;
  let totalDropped = 0;
  for (const f of files) {
    const path = join(dir, f);
    try {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.entries)) continue;
      const dedup = new Map<string, PendingEntry>();
      let dropped = 0;
      for (const e of parsed.entries) {
        if (!e?.nodeId) continue;
        if (dedup.has(e.nodeId)) { dropped++; continue; }
        dedup.set(e.nodeId, e);
      }
      if (dropped > 0) {
        const cleaned = Array.from(dedup.values());
        atomicWriteFileSync(path, JSON.stringify({ version: 1, entries: cleaned }, null, 2));
        repaired++;
        totalDropped += dropped;
      }
    } catch { /* skip unreadable sidecar */ }
  }
  if (repaired > 0) {
    diagLog(`[Overlay] TRIPWIRE STARTUP-REPAIR repaired=${repaired} files, dropped=${totalDropped} duplicate entries — should be unreachable post-fix, investigate`);
  }
}

// ============================================================================
// EXTRACT — walk a doc-with-pending-attrs and produce an overlay
// ============================================================================

/**
 * Walk a TipTap doc that has pending attrs on its nodes and extract those
 * attrs into a PendingEntry[] keyed by nodeId. Does NOT mutate the doc.
 *
 * For inserts: captures the previous-sibling nodeId (or null) and the
 * parent nodeId so the entry can be re-anchored on reload even if the
 * doc tree has changed around it.
 *
 * For rewrites: captures the node's `pendingOriginalContent` (if
 * present) as the `originalBaseline` so future reloads can detect
 * baseline drift.
 *
 * Insert-pending nodes are extracted with the `newContent` carrying
 * the node minus the pending attrs (i.e. what to insert).
 */
export function extractOverlay(doc: any): PendingEntry[] {
  const entries: PendingEntry[] = [];

  function walk(nodes: any[], parentNodeId: string | null): void {
    if (!Array.isArray(nodes)) return;
    let prevSiblingId: string | null = null;
    for (const node of nodes) {
      const nodeId: string | undefined = node?.attrs?.id;
      const status: PendingStatus | undefined = node?.attrs?.pendingStatus;

      if (nodeId && status) {
        const entry: PendingEntry = {
          nodeId,
          status,
        };

        if (status === 'insert') {
          entry.afterNodeId = prevSiblingId;
          entry.parentNodeId = parentNodeId;
          // For inserts, the node itself IS the content. Capture it as
          // newContent with pending attrs stripped (the overlay carries
          // them separately).
          entry.newContent = stripPendingAttrs(node);
        } else if (status === 'rewrite') {
          // The node's current content is the agent's proposed prose.
          // pendingOriginalContent (if present) is the snapshot baseline.
          entry.newContent = stripPendingAttrs(node);
          if (node.attrs?.pendingOriginalContent) {
            entry.originalBaseline = node.attrs.pendingOriginalContent;
          }
        }
        // status === 'delete': no newContent, no anchor (node still in canonical)

        // Sub-paragraph enhance fields
        if (node.attrs?.pendingGroupId) entry.pendingGroupId = node.attrs.pendingGroupId;
        if (node.attrs?.pendingTextEdits) entry.pendingTextEdits = node.attrs.pendingTextEdits;
        if (node.attrs?.pendingSelectionFrom != null) entry.pendingSelectionFrom = node.attrs.pendingSelectionFrom;
        if (node.attrs?.pendingSelectionTo != null) entry.pendingSelectionTo = node.attrs.pendingSelectionTo;
        if (node.attrs?.pendingOriginalFrom != null) entry.pendingOriginalFrom = node.attrs.pendingOriginalFrom;
        if (node.attrs?.pendingOriginalTo != null) entry.pendingOriginalTo = node.attrs.pendingOriginalTo;

        entries.push(entry);
      }

      // Track previous sibling for inserts (only at this level; recursion
      // resets prevSiblingId for child arrays).
      if (nodeId) prevSiblingId = nodeId;

      if (node?.content) walk(node.content, nodeId || parentNodeId);
    }
  }

  walk(doc?.content || [], null);
  return entries;
}

const PENDING_ATTR_KEYS = [
  'pendingStatus', 'pendingOriginalContent', 'pendingGroupId',
  'pendingTextEdits', 'pendingSelectionFrom', 'pendingSelectionTo',
  'pendingOriginalFrom', 'pendingOriginalTo', 'pendingOrphan', 'pendingStaleBaseline',
];

function stripPendingAttrs(node: any): any {
  const cloned = JSON.parse(JSON.stringify(node));
  if (cloned.attrs) {
    for (const k of PENDING_ATTR_KEYS) delete cloned.attrs[k];
  }
  if (cloned.content) cloned.content = cloned.content.map((c: any) => stripPendingAttrs(c));
  return cloned;
}

// ============================================================================
// APPLY — merge overlay onto a canonical doc, with orphan + stale-baseline
//          classification
// ============================================================================

/**
 * Mutate `canonical` to layer in the overlay's pending decorations.
 * Returns classification: which entries became orphan (anchor gone) and
 * which became stale-baseline (anchor present but content drifted).
 *
 * Orphan handling:
 *   - `rewrite` orphan → converted to `insert` with `pendingOrphan: true`,
 *     placed at the position of its last-known parent's tail (or end of
 *     doc if parent also gone). The agent's creative content is preserved.
 *   - `insert` orphan → kept as `insert` with `pendingOrphan: true`,
 *     placed via the same fallback positioning.
 *   - `delete` orphan → discarded (the target was already gone, the
 *     delete intent is moot).
 *
 * Stale-baseline detection (rewrites only): compare canonical node's
 * current content to `entry.originalBaseline`. If different, set
 * `pendingStaleBaseline: true` on the merged node.
 */
export function applyOverlay(canonical: any, entries: PendingEntry[]): ApplyResult {
  const orphans: PendingEntry[] = [];
  const staleBaseline: PendingEntry[] = [];

  if (entries.length > 0) {
    diagLog(`[Overlay] APPLY entries=${entries.length}: ${entries.map(entrySummary).join(' | ')}`);
  }

  // Build a nodeId → node map for the canonical doc (read-side lookup).
  const nodeById = new Map<string, any>();
  function indexNodes(nodes: any[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const id = node?.attrs?.id;
      if (id) nodeById.set(id, node);
      if (node?.content) indexNodes(node.content);
    }
  }
  indexNodes(canonical?.content || []);

  // Helper: find the parent array and index for a given nodeId.
  function findNodeWithParent(targetId: string): { parent: any[]; index: number } | null {
    function search(nodes: any[]): { parent: any[]; index: number } | null {
      if (!Array.isArray(nodes)) return null;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]?.attrs?.id === targetId) return { parent: nodes, index: i };
        if (nodes[i]?.content) {
          const r = search(nodes[i].content);
          if (r) return r;
        }
      }
      return null;
    }
    return search(canonical?.content || []);
  }

  // Process deletes and rewrites first (in-place mutations on existing nodes).
  // Then process inserts (which add new nodes that wouldn't affect lookups).
  for (const entry of entries) {
    if (entry.status === 'insert') continue;

    const target = nodeById.get(entry.nodeId);
    if (!target) {
      // Anchor gone. Delete-orphans are discarded. Rewrite-orphans get
      // converted to inserts (handled below).
      if (entry.status === 'delete') {
        // discard silently
      } else {
        orphans.push(entry);
      }
      continue;
    }

    target.attrs = target.attrs || {};
    target.attrs.pendingStatus = entry.status;

    if (entry.status === 'rewrite') {
      // Stale-baseline check: compare canonical content to baseline.
      if (entry.originalBaseline && !sameContent(target, entry.originalBaseline)) {
        target.attrs.pendingStaleBaseline = true;
        staleBaseline.push(entry);
      }
      // Stash original baseline so reject can restore it.
      if (entry.originalBaseline) {
        target.attrs.pendingOriginalContent = entry.originalBaseline;
      } else {
        // No baseline recorded — synthesize from current canonical content
        // (best-effort; reject will restore to "current state").
        target.attrs.pendingOriginalContent = sanitizeNodeForBaseline(target);
      }
      // Replace target's content with the proposed new content.
      if (entry.newContent?.content) {
        target.content = entry.newContent.content;
      }
    }
    // status === 'delete': just the pendingStatus marker; content unchanged.

    // Carry sub-paragraph enhance fields.
    if (entry.pendingGroupId) target.attrs.pendingGroupId = entry.pendingGroupId;
    if (entry.pendingTextEdits) target.attrs.pendingTextEdits = entry.pendingTextEdits;
    if (entry.pendingSelectionFrom != null) target.attrs.pendingSelectionFrom = entry.pendingSelectionFrom;
    if (entry.pendingSelectionTo != null) target.attrs.pendingSelectionTo = entry.pendingSelectionTo;
    if (entry.pendingOriginalFrom != null) target.attrs.pendingOriginalFrom = entry.pendingOriginalFrom;
    if (entry.pendingOriginalTo != null) target.attrs.pendingOriginalTo = entry.pendingOriginalTo;
  }

  // Inserts: find anchor and splice the new node in.
  for (const entry of entries) {
    if (entry.status !== 'insert') continue;
    if (!entry.newContent) continue;

    const newNode = JSON.parse(JSON.stringify(entry.newContent));
    newNode.attrs = newNode.attrs || {};
    newNode.attrs.id = entry.nodeId;
    newNode.attrs.pendingStatus = 'insert';
    if (entry.pendingGroupId) newNode.attrs.pendingGroupId = entry.pendingGroupId;

    // Try anchor: afterNodeId first, then parentNodeId.
    let placed = false;
    if (entry.afterNodeId) {
      const loc = findNodeWithParent(entry.afterNodeId);
      if (loc) {
        loc.parent.splice(loc.index + 1, 0, newNode);
        placed = true;
      }
    }
    if (!placed && entry.parentNodeId) {
      const parentLoc = findNodeWithParent(entry.parentNodeId);
      if (parentLoc) {
        const parent = parentLoc.parent[parentLoc.index];
        parent.content = parent.content || [];
        parent.content.unshift(newNode);
        placed = true;
      }
    }
    if (!placed && entry.afterNodeId === null && entry.parentNodeId === null) {
      // Originally at doc root, no previous sibling — insert at start.
      canonical.content = canonical.content || [];
      canonical.content.unshift(newNode);
      placed = true;
    }

    if (!placed) {
      // Both anchors gone. Mark as orphan and append at end of doc with
      // pendingOrphan: true so the user can see and decide.
      newNode.attrs.pendingOrphan = true;
      canonical.content = canonical.content || [];
      canonical.content.push(newNode);
      orphans.push(entry);
    }
  }

  // Convert rewrite-orphans to orphan-inserts at the end of the doc, with
  // pendingOrphan: true. Preserves the agent's proposed content.
  for (const entry of orphans) {
    if (entry.status === 'rewrite' && entry.newContent) {
      const newNode = JSON.parse(JSON.stringify(entry.newContent));
      newNode.attrs = newNode.attrs || {};
      newNode.attrs.id = entry.nodeId;
      newNode.attrs.pendingStatus = 'insert';
      newNode.attrs.pendingOrphan = true;
      if (entry.pendingGroupId) newNode.attrs.pendingGroupId = entry.pendingGroupId;
      canonical.content = canonical.content || [];
      canonical.content.push(newNode);
    }
  }

  return { orphans, staleBaseline };
}

/**
 * Pure version of applyOverlay. Returns a new merged doc; does NOT mutate
 * the canonical input. Idempotent by construction: if `canonical` already
 * contains a node with an insert entry's nodeId, the entry is skipped
 * (treated as already applied). This is the safe-to-call-anywhere version.
 *
 * The architectural invariant this enforces: applying the same overlay
 * to the same canonical twice produces the same result as applying it
 * once. The pre-existing mutating applyOverlay violated this when fed
 * its own output (the cache-restore + re-apply path), causing the
 * unbounded duplicate-insert bug.
 *
 * adr: adr/pending-overlay-model.md
 */
export function applyOverlayPure(canonical: any, entries: PendingEntry[]): any {
  // Strip the parser-fallback / createDocumentFile-stub empty paragraph
  // before merging. markdownToTiptap mints a placeholder empty paragraph
  // whenever the disk body has no block content (TipTap requires at least
  // one node), and createDocumentFile mints the same shape for fresh empty
  // docs. Both surface as a trailing empty `[p:...]` in the merged view
  // whenever the doc's real content lives only in the overlay. We strip
  // ONLY when canonical is exactly that single empty-paragraph shape AND
  // no overlay entry anchors to it — so steady-state docs with real
  // canonical content (or where an overlay entry references the empty
  // paragraph deliberately, like a pending-delete on a user-emptied node)
  // are untouched. adr: adr/pending-overlay-model.md
  if (entries.length > 0 && isFallbackEmptyCanonical(canonical)) {
    const fallbackId = canonical.content[0]?.attrs?.id;
    const referenced = entries.some((e) =>
      e.nodeId === fallbackId || e.afterNodeId === fallbackId || e.parentNodeId === fallbackId
    );
    if (!referenced) {
      canonical = { ...canonical, content: [] };
    }
  }
  const merged = canonical ? JSON.parse(JSON.stringify(canonical)) : { type: 'doc', content: [] };
  if (entries.length === 0) return merged;

  // Build a nodeId → node map for the merged doc (read-side lookup).
  const nodeById = new Map<string, any>();
  function indexNodes(nodes: any[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const id = node?.attrs?.id;
      if (id) nodeById.set(id, node);
      if (node?.content) indexNodes(node.content);
    }
  }
  indexNodes(merged?.content || []);

  function findNodeWithParent(targetId: string): { parent: any[]; index: number } | null {
    function search(nodes: any[]): { parent: any[]; index: number } | null {
      if (!Array.isArray(nodes)) return null;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]?.attrs?.id === targetId) return { parent: nodes, index: i };
        if (nodes[i]?.content) {
          const r = search(nodes[i].content);
          if (r) return r;
        }
      }
      return null;
    }
    return search(merged?.content || []);
  }

  // Process deletes and rewrites first.
  for (const entry of entries) {
    if (entry.status === 'insert') continue;
    const target = nodeById.get(entry.nodeId);
    if (!target) continue; // Orphan — skipped in pure version. Caller handles classification separately.
    target.attrs = target.attrs || {};
    target.attrs.pendingStatus = entry.status;
    if (entry.status === 'rewrite') {
      if (entry.originalBaseline && !sameContent(target, entry.originalBaseline)) {
        target.attrs.pendingStaleBaseline = true;
      }
      if (entry.originalBaseline) {
        target.attrs.pendingOriginalContent = entry.originalBaseline;
      } else {
        target.attrs.pendingOriginalContent = sanitizeNodeForBaseline(target);
      }
      if (entry.newContent?.content) {
        target.content = entry.newContent.content;
      }
    }
    if (entry.pendingGroupId) target.attrs.pendingGroupId = entry.pendingGroupId;
    if (entry.pendingTextEdits) target.attrs.pendingTextEdits = entry.pendingTextEdits;
    if (entry.pendingSelectionFrom != null) target.attrs.pendingSelectionFrom = entry.pendingSelectionFrom;
    if (entry.pendingSelectionTo != null) target.attrs.pendingSelectionTo = entry.pendingSelectionTo;
    if (entry.pendingOriginalFrom != null) target.attrs.pendingOriginalFrom = entry.pendingOriginalFrom;
    if (entry.pendingOriginalTo != null) target.attrs.pendingOriginalTo = entry.pendingOriginalTo;
  }

  // Inserts: idempotency check FIRST. If a node with this ID already exists,
  // refresh its pending marker but do NOT splice another copy.
  //
  // Idempotency MUST account for descendant IDs too: when a container entry
  // places its newContent (a subtree of listItems/paragraphs/etc.), those
  // descendants land in canonical but aren't in nodeById until we re-index.
  // Without that, the descendants' own entries don't see the existing
  // placement and would splice duplicate copies. adr: adr/pending-overlay-model.md
  function indexSubtree(node: any): void {
    if (!node) return;
    const id = node?.attrs?.id;
    if (id) nodeById.set(id, node);
    if (Array.isArray(node?.content)) {
      for (const child of node.content) indexSubtree(child);
    }
  }

  for (const entry of entries) {
    if (entry.status !== 'insert') continue;
    if (!entry.newContent) continue;

    const existing = nodeById.get(entry.nodeId);
    if (existing) {
      existing.attrs = existing.attrs || {};
      existing.attrs.pendingStatus = 'insert';
      if (entry.pendingGroupId) existing.attrs.pendingGroupId = entry.pendingGroupId;
      continue;
    }

    const newNode = JSON.parse(JSON.stringify(entry.newContent));
    newNode.attrs = newNode.attrs || {};
    newNode.attrs.id = entry.nodeId;
    newNode.attrs.pendingStatus = 'insert';
    if (entry.pendingGroupId) newNode.attrs.pendingGroupId = entry.pendingGroupId;

    let placed = false;
    if (entry.afterNodeId) {
      const loc = findNodeWithParent(entry.afterNodeId);
      if (loc) {
        loc.parent.splice(loc.index + 1, 0, newNode);
        indexSubtree(newNode);
        placed = true;
      }
    }
    if (!placed && entry.parentNodeId) {
      const parentLoc = findNodeWithParent(entry.parentNodeId);
      if (parentLoc) {
        const parent = parentLoc.parent[parentLoc.index];
        parent.content = parent.content || [];
        parent.content.unshift(newNode);
        indexSubtree(newNode);
        placed = true;
      }
    }
    if (!placed && entry.afterNodeId === null && entry.parentNodeId === null) {
      merged.content = merged.content || [];
      merged.content.unshift(newNode);
      indexSubtree(newNode);
      placed = true;
    }
    if (!placed) {
      newNode.attrs.pendingOrphan = true;
      merged.content = merged.content || [];
      merged.content.push(newNode);
      indexSubtree(newNode);
    }
  }

  return merged;
}

/**
 * Split a merged document (one that has pending decorations baked into
 * its node tree) into a clean canonical + structured overlay. The inverse
 * of applyOverlayPure. Used to process inputs that arrive in merged form
 * (browser doc-update messages, legacy on-disk docs with frontmatter pending)
 * and turn them into the canonical + overlay representation the system
 * now operates on.
 *
 * Returns:
 *   canonical — deep clone of merged with:
 *     - All `pendingStatus: 'insert'` nodes removed (they only live in overlay).
 *     - All pending attrs cleared from remaining nodes.
 *   overlayEntries — PendingEntry[] extracted from the original merged tree.
 */
export function splitMergedDoc(merged: any): { canonical: any; overlayEntries: PendingEntry[] } {
  const overlayEntries = extractOverlay(merged);
  const canonical = stripPendingFromDoc(merged);
  return { canonical, overlayEntries };
}

/**
 * Deep clone a doc with all pending content reverted to canonical:
 *   - status='insert' → drop the node (lives only in overlay)
 *   - status='rewrite' → restore node.content from pendingOriginalContent
 *                        (the baseline captured when the rewrite was proposed)
 *   - status='delete'  → keep the node, just strip pending attrs
 *   - no status        → keep, strip stray pending attrs
 *
 * The rewrite-restoration step is load-bearing. Without it, the rewrite TEXT
 * stays in canonical after splitMergedDoc. The next applyOverlayPure compares
 * canonical-as-rewrite to baseline-as-original, sees they differ, and falsely
 * flags `pendingStaleBaseline` — surfacing the dotted-underline indicator
 * even though nothing actually drifted. Mirrors the on-disk serializer's
 * `revertPendingForSerialization` in markdown-serialize.ts; the two were
 * silently divergent and the split path produced corrupt canonical that
 * survived in state.canonical and the cache.
 *
 * adr: adr/pending-overlay-model.md
 */
export function stripPendingFromDoc(doc: any): any {
  if (!doc) return doc;
  const cloned = JSON.parse(JSON.stringify(doc));
  function walk(parent: any): void {
    if (!Array.isArray(parent?.content)) return;
    // Filter out pending-insert nodes (they only live in overlay).
    parent.content = parent.content.filter((n: any) => n?.attrs?.pendingStatus !== 'insert');
    // For surviving nodes: restore canonical content (rewrites only) then
    // strip pending markers. Type and id are preserved from the current node;
    // we only swap node.content back to the baseline. If the baseline is
    // missing (legacy entries pre-baseline-capture), leave content alone —
    // best-effort, the user sees the rewrite as canonical.
    for (const node of parent.content) {
      if (node?.attrs) {
        if (node.attrs.pendingStatus === 'rewrite') {
          const baseline = node.attrs.pendingOriginalContent;
          if (baseline && Array.isArray(baseline.content)) {
            node.content = JSON.parse(JSON.stringify(baseline.content));
          }
        }
        for (const k of PENDING_ATTR_KEYS) delete node.attrs[k];
      }
      walk(node);
    }
  }
  walk(cloned);
  return cloned;
}

function sameContent(a: any, b: any): boolean {
  // Cheap structural equality on the relevant subtree. Stringify is
  // fine for sub-paragraph TipTap nodes; they're typically small.
  const aClean = sanitizeNodeForBaseline(a);
  const bClean = sanitizeNodeForBaseline(b);
  return JSON.stringify(aClean) === JSON.stringify(bClean);
}

/**
 * Repair canonical rewrite nodes that still hold the rewrite's NEW content.
 *
 * `splitMergedDoc` / `stripPendingFromDoc` can only revert a rewrite via the
 * node's own `pendingOriginalContent` attr. When a merged doc arrives from an
 * untrusted source — a browser doc-update (`syncBrowserDocUpdate`) — whose
 * rewrite node dropped or staled that attr, the revert silently fails and the
 * rewrite TEXT lands in canonical. The next `applyOverlayPure` then compares
 * canonical-as-rewrite to the (still-correct) overlay baseline and falsely
 * flags `pendingStaleBaseline` (the amber dotted-underline indicator).
 *
 * The server's overlay entry retains the authoritative `originalBaseline`, so
 * re-assert it here — but ONLY when the canonical node currently equals the
 * entry's `newContent`. That condition means "the revert failed." If canonical
 * holds anything else (a genuine out-of-band edit), it is left untouched so
 * real stale-baseline drift is still surfaced for review.
 *
 * adr: adr/pending-overlay-model.md · adr: adr/tweet-paragraph-convention.md
 */
export function reconcileCanonicalToBaselines(canonical: any, entries: PendingEntry[]): void {
  const byId = new Map<string, PendingEntry>();
  for (const e of entries) {
    if (e.status === 'rewrite' && e.originalBaseline?.content && e.newContent?.content) {
      byId.set(e.nodeId, e);
    }
  }
  if (byId.size === 0) return;
  const key = (content: any) => JSON.stringify(sanitizeNodeForBaseline({ content }));
  function walk(nodes: any[]): void {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      const e = n?.attrs?.id ? byId.get(n.attrs.id) : undefined;
      if (e && key(n.content) === key(e.newContent.content)) {
        // Canonical is holding the rewrite text — the split couldn't revert it.
        // Restore the authoritative baseline.
        n.content = JSON.parse(JSON.stringify(e.originalBaseline.content));
      } else if (n.content) {
        walk(n.content);
      }
    }
  }
  walk(canonical?.content || []);
}

function sanitizeNodeForBaseline(node: any): any {
  // Strip volatile fields (ids, pending attrs) for content comparison.
  const cloned = JSON.parse(JSON.stringify(node));
  function strip(n: any): void {
    if (n?.attrs) {
      const a = { ...n.attrs };
      delete a.id;
      for (const k of PENDING_ATTR_KEYS) delete a[k];
      n.attrs = a;
    }
    if (n?.content) n.content.forEach(strip);
  }
  strip(cloned);
  return cloned;
}

// ============================================================================
// LEGACY MIGRATION — convert frontmatter `pending` (position-keyed) to
//   overlay format (nodeId-keyed) on first load
// ============================================================================

/**
 * Convert legacy position-keyed pending data (from `meta.pending`) into
 * nodeId-keyed PendingEntry[]. Walks the doc in the same pre-order the
 * legacy serializer used (LEAF_BLOCK_TYPES), reads each leaf block's
 * current nodeId, and pairs it with the legacy pending entry at the
 * same position.
 *
 * This runs once when an old file is loaded; the next save writes
 * canonical-only to disk and the sidecar takes over.
 */
const LEAF_BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock', 'horizontalRule']);

export function migrateLegacyPending(doc: any, legacyPending: Record<string, any>): PendingEntry[] {
  const entries: PendingEntry[] = [];
  let index = 0;

  function walk(nodes: any[], parentId: string | null): void {
    if (!Array.isArray(nodes)) return;
    let prevSiblingId: string | null = null;
    for (const node of nodes) {
      if (LEAF_BLOCK_TYPES.has(node.type)) {
        const legacyEntry = legacyPending[String(index)];
        if (legacyEntry && node.attrs?.id) {
          const entry: PendingEntry = {
            nodeId: node.attrs.id,
            status: legacyEntry.s,
          };
          if (legacyEntry.o) {
            // Legacy stored original as full node — use as originalBaseline.
            entry.originalBaseline = legacyEntry.o;
          }
          if (legacyEntry.g) entry.pendingGroupId = legacyEntry.g;
          if (legacyEntry.sf != null) entry.pendingSelectionFrom = legacyEntry.sf;
          if (legacyEntry.st != null) entry.pendingSelectionTo = legacyEntry.st;
          if (legacyEntry.of != null) entry.pendingOriginalFrom = legacyEntry.of;
          if (legacyEntry.ot != null) entry.pendingOriginalTo = legacyEntry.ot;
          // For rewrites: the legacy doc body already contains the new prose
          // (since the body is post-rewrite). We capture it as newContent.
          if (legacyEntry.s === 'rewrite' || legacyEntry.s === 'insert') {
            entry.newContent = stripPendingAttrs(node);
          }
          if (legacyEntry.s === 'insert') {
            entry.afterNodeId = prevSiblingId;
            entry.parentNodeId = parentId;
          }
          entries.push(entry);
        }
        index++;
      } else if (node.content) {
        walk(node.content, node.attrs?.id || parentId);
      }
      if (node.attrs?.id) prevSiblingId = node.attrs.id;
    }
  }

  walk(doc?.content || [], null);
  return entries;
}

// ============================================================================
// MERGED-VIEW DOC LOADER
// ============================================================================

/**
 * Load a doc from disk WITH its sidecar overlay applied — returns the
 * user-visible merged view. This is the canonical reader for any code path
 * that surfaces a non-active doc to the user (MCP read tools, browser HTTP
 * fetches, anything that says "give me the doc").
 *
 * Why this exists. fb666e6 (May 2026) split persistence into two surfaces:
 * the .md body holds canonical content, the per-docId sidecar at
 * `_pending/{docId}.json` holds the pending overlay. Writes were updated
 * to handle both halves symmetrically; reads weren't. The bare
 * `markdownToTiptap` returns canonical-only — anyone calling it directly
 * and treating the result as "the doc" silently drops the user's pending
 * content. This function closes that asymmetry: there is one entry point
 * for "load the doc," and it always materializes the full merged view.
 *
 * Callers that explicitly want canonical-only (the save-time matcher, the
 * on-disk identity persistence path, sync-check roundtripping) continue to
 * call `markdownToTiptap` directly. Those callsites are internal to the
 * persistence layer and deliberately operate on the pre-overlay shape.
 *
 * Throws if the file doesn't exist (matches resolveDocTarget's existing
 * behavior; callers that want soft-failure should check existsSync first).
 *
 * adr: adr/pending-overlay-model.md
 */
export function loadDocFromDisk(filename: string): {
  document: any;
  title: string;
  metadata: Record<string, any>;
  docId: string;
  rawFrontmatter: string | null;
} {
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) {
    throw new Error(`Document file not found: ${filename}`);
  }
  const raw = readFileSync(targetPath, 'utf-8');
  const parsed = markdownToTiptap(raw);
  const docId: string = (parsed.metadata && typeof parsed.metadata.docId === 'string')
    ? parsed.metadata.docId
    : '';
  let document = parsed.document;
  if (docId) {
    const overlayEntries = loadOverlay(docId);
    if (overlayEntries.length > 0) {
      // applyOverlayPure handles the parser-fallback / stub-empty strip
      // itself — see the comment block at its top for why.
      document = applyOverlayPure(parsed.document, overlayEntries);
    }
  }
  return {
    document,
    title: parsed.title,
    metadata: parsed.metadata,
    docId,
    rawFrontmatter: parsed.rawFrontmatter,
  };
}

/** True when a parsed doc's canonical body is `[{ paragraph with no content }]`
 *  — the markdownToTiptap fallback shape that signals "disk body had no
 *  block-level content." Genuine user empty paragraphs in a doc with other
 *  real content don't trip this (length check is strict); only the parser
 *  fallback's single-node case matches. */
function isFallbackEmptyCanonical(canonical: any): boolean {
  if (!canonical?.content || canonical.content.length !== 1) return false;
  const node = canonical.content[0];
  return node?.type === 'paragraph' && (!node.content || node.content.length === 0);
}
