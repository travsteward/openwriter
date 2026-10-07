/**
 * Connections engine (v0.20.0): doc-to-doc connections are structural data,
 * stored as `references: [docId, ...]` arrays in each source's frontmatter.
 * The inbound list on any target is computed live as the inverse of every
 * doc's references — there is no stored derived field on disk.
 *
 * Design:
 *   - `references:` in frontmatter = source of truth (this doc connects to these).
 *   - Backlinks = computed live (scan all docs' references, return those listing
 *     us). Cached in memory for query-time speed; invalidated on any references
 *     write. A rebuild re-stats every file but re-parses only the ones whose
 *     mtime or size changed (sourceLinksCache), sharing the doc listing's read.
 *   - Legacy `doc:` prose links in body keep rendering (TipTap PadLink) AND
 *     auto-populate `references` on save — backward compat.
 *   - Legacy stored `backlinks:` frontmatter field is dropped on any save
 *     (lazy migration). One-off `rebuildAllReferences()` does the bulk migrate.
 *
 * The pre-v0.20 incremental backlinks pipeline (updateBacklinksForSource) is
 * gone — it had a race that meant on-save updates didn't fire reliably (the
 * test session that motivated this refactor caught it). Computing live
 * removes the entire class of incremental-update bugs.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { getDataDir, atomicWriteFileSync, resolveDocPath, isExternalDoc } from './helpers.js';
import { filenameByDocId, readListingParse } from './documents.js';
import { markdownToTiptap } from './markdown-parse.js';

const HEX8 = /^[a-f0-9]{8}$/;
const ANCHOR_TEXT_MAX = 80; // truncate long anchor text in backlinks frontmatter

export interface ForwardLink {
  text: string;           // anchor text (truncated)
  from_doc: string;       // source docId
  from_node: string;      // source nodeId (the block containing the link mark)
  to_doc: string;         // target docId
  to_node?: string;       // target nodeId (optional, only when href is doc:DOCID#NODEID)
}

/**
 * Backlink: one inbound connection from a source doc that references this one.
 * v0.20.0 dropped the node-level granularity (from_node, to_node) and the
 * anchor `text` — connections are doc-to-doc, not paragraph-to-paragraph.
 * Legacy stored backlinks may include those fields when reading old frontmatter
 * during migration; they're ignored.
 */
export interface Backlink {
  from_doc: string;
  /** @deprecated v0.20 — kept optional only for migration reads. */
  text?: string;
  /** @deprecated v0.20 — kept optional only for migration reads. */
  from_node?: string;
  /** @deprecated v0.20 — kept optional only for migration reads. */
  to_node?: string;
}

/** Parse the post-`doc:` portion of an href into {docId, nodeId}. Mirrors src/editor/link-href.ts. */
function parseDocHref(href: string): { docId: string | null; nodeId: string | null } {
  if (!href.startsWith('doc:')) return { docId: null, nodeId: null };
  let body = href.slice(4);
  // Strip query string (?q=...) — only needed for client-side scroll
  const qIdx = body.indexOf('?q=');
  if (qIdx >= 0) body = body.slice(0, qIdx);
  // Split fragment
  let target = body, nodeId: string | null = null;
  const hashIdx = body.indexOf('#');
  if (hashIdx >= 0) {
    const frag = body.slice(hashIdx + 1);
    nodeId = HEX8.test(frag) ? frag : null;
    target = body.slice(0, hashIdx);
  }
  return {
    docId: HEX8.test(target) ? target : null,
    nodeId,
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/**
 * Walk a TipTap doc, return every `doc:` link found.
 * Each entry includes the enclosing block's nodeId (from_node) and the
 * anchor text (the text wrapped by the link mark).
 */
export function extractForwardLinks(doc: any, sourceDocId: string): ForwardLink[] {
  const links: ForwardLink[] = [];

  function walkBlock(block: any): void {
    if (!block) return;
    const blockId: string | undefined = block.attrs?.id;
    if (Array.isArray(block.content)) {
      // Inline pass: collect contiguous text runs with same link mark
      // (a mark may span multiple text nodes if other marks toggle inside)
      let currentHref: string | null = null;
      let currentText: string[] = [];
      const flush = () => {
        if (currentHref && currentText.length > 0 && blockId) {
          const parsed = parseDocHref(currentHref);
          if (parsed.docId) {
            links.push({
              text: truncate(currentText.join(''), ANCHOR_TEXT_MAX),
              from_doc: sourceDocId,
              from_node: blockId,
              to_doc: parsed.docId,
              ...(parsed.nodeId ? { to_node: parsed.nodeId } : {}),
            });
          }
        }
        currentText = [];
      };

      for (const child of block.content) {
        if (child.type === 'text') {
          const linkMark = (child.marks || []).find((m: any) => m.type === 'link');
          const href: string | null = linkMark?.attrs?.href || null;
          if (href !== currentHref) {
            flush();
            currentHref = href;
          }
          if (href && child.text) currentText.push(child.text);
        } else {
          flush();
          currentHref = null;
          // Recurse into nested block-level content (e.g., listItem -> paragraph)
          walkBlock(child);
        }
      }
      flush();

      // Also recurse for blocks whose content is sub-blocks (list, blockquote)
      for (const child of block.content) {
        if (child.type && child.type !== 'text' && Array.isArray(child.content)) {
          // Already handled above via flush() recursion guard — skip duplicate
          // (We need to recurse into blocks that contain block-level content,
          //  but not the text children we already iterated.)
        }
      }
    }
  }

  if (doc?.content) {
    for (const node of doc.content) walkBlock(node);
  }
  return links;
}

/**
 * Read a doc's frontmatter from disk and parse it.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function readFrontmatter(filename: string): { data: Record<string, any>; content: string; rawMatter: string } | null {
  try {
    const filePath = resolveDocPath(filename);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    return { data: parsed.data, content: parsed.content, rawMatter: parsed.matter };
  } catch {
    return null;
  }
}

/**
 * Write a doc's file with updated frontmatter (preserves body verbatim).
 * Only touches the frontmatter — does NOT re-serialize the body, which would
 * lose nodeIds and reformat. This is safe to call on non-active docs.
 */
export function writeFrontmatter(filename: string, newData: Record<string, any>): void {
  const filePath = resolveDocPath(filename);
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = matter(raw);

  // Clean up: drop null/undefined fields
  for (const key of Object.keys(newData)) {
    if (newData[key] === undefined || newData[key] === null) delete newData[key];
    else if (Array.isArray(newData[key]) && newData[key].length === 0) delete newData[key];
  }

  // Match the project convention: JSON-encoded YAML frontmatter
  const newFrontmatter = `---\n${JSON.stringify(newData)}\n---\n\n${parsed.content.trimStart()}`;
  // Avoid no-op writes
  if (newFrontmatter === raw) return;
  atomicWriteFileSync(filePath, newFrontmatter);
}

// ============================================================================
// COMPUTE-LIVE BACKLINKS — the v0.20 surface, extended in v0.21
// ============================================================================
//
// `computeBacklinksFor(targetDocId)` returns every inbound edge pointing at
// targetDocId. Two sources contribute:
//
//   1. Doc-level edges from `references:` frontmatter arrays (v0.20 model —
//      structural, no node granularity). Entry: `{ from_doc }`.
//   2. Paragraph-anchored edges from prose `[text](doc:DOCID#NODEID)` link
//      marks in the body (v0.21 — restores per-paragraph backlinks for the
//      dotted-underline + "See connections" UI). Entry: `{ from_doc, from_node,
//      to_node, text }`.
//
// Cached in memory; any write that touches references or body invalidates
// (state.ts:writeToDisk after every save). Cache rebuilds lazily on next read.

/** Inverse index: target docId → list of inbound edges. */
let backlinksCache: Map<string, Backlink[]> | null = null;

/** What one source file contributes, reused until its mtime or size changes.
 *  The full TipTap parse is the expensive part (seconds across a few hundred
 *  docs), so a rebuild after a save re-parses only the files that changed, and
 *  a body with no `doc:` link skips the parse entirely. Frontmatter comes from
 *  the doc listing's cached read, so the two share one read of each file. The
 *  disk stays the only source of truth: every rebuild re-stats each file. */
interface SourceLinks { mtimeMs: number; size: number; data: Record<string, any>; proseLinks: ForwardLink[] }
const sourceLinksCache = new Map<string, SourceLinks>();

function readSourceLinks(fullPath: string): SourceLinks {
  const { mtimeMs, size, data, content } = readListingParse(fullPath);
  const cached = sourceLinksCache.get(fullPath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached;
  const docId = data?.docId;
  let proseLinks: ForwardLink[] = [];
  if (typeof docId === 'string' && content.includes('doc:')) {
    // markdownToTiptap can throw on malformed bodies — best-effort skip
    try { proseLinks = extractForwardLinks(markdownToTiptap(readFileSync(fullPath, 'utf-8')).document, docId); } catch { /* no prose links */ }
  }
  const entry = { mtimeMs, size, data: data ?? {}, proseLinks };
  sourceLinksCache.set(fullPath, entry);
  return entry;
}

/** Every data-dir doc's contribution, dropping cached entries for files that are gone. */
function readAllSourceLinks(): Array<{ filename: string } & SourceLinks> {
  let files: string[] = [];
  try {
    files = readdirSync(getDataDir()).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out: Array<{ filename: string } & SourceLinks> = [];
  const live = new Set<string>();
  for (const f of files) {
    const fullPath = join(getDataDir(), f);
    live.add(fullPath);
    try { out.push({ filename: f, ...readSourceLinks(fullPath) }); } catch { /* skip unreadable */ }
  }
  for (const p of sourceLinksCache.keys()) if (!live.has(p)) sourceLinksCache.delete(p);
  return out;
}

/** Build (or rebuild) the entire inverse index from every .md in the data
 *  dir: frontmatter references plus paragraph-anchored prose links. */
function buildBacklinksCache(): Map<string, Backlink[]> {
  const cache = new Map<string, Backlink[]>();

  /** Dedup keys per target: source docs with no `to_node` collapse to one
   *  doc-level entry; paragraph-anchored entries dedup per (from_doc, to_node)
   *  pair so multi-link-same-anchor in a single source counts once. */
  const seen = new Map<string, Set<string>>();
  function push(targetDocId: string, entry: Backlink): void {
    const key = entry.to_node ? `${entry.from_doc}#${entry.to_node}` : entry.from_doc;
    let seenForTarget = seen.get(targetDocId);
    if (!seenForTarget) {
      seenForTarget = new Set();
      seen.set(targetDocId, seenForTarget);
    }
    if (seenForTarget.has(key)) return;
    seenForTarget.add(key);
    if (!cache.has(targetDocId)) cache.set(targetDocId, []);
    cache.get(targetDocId)!.push(entry);
  }

  for (const { data, proseLinks } of readAllSourceLinks()) {
    const sourceDocId = data.docId;
    if (!sourceDocId || typeof sourceDocId !== 'string') continue;

    // Pass 1: structural references (frontmatter). Doc-level only.
    const refs = data.references;
    if (Array.isArray(refs)) {
      for (const targetDocId of refs) {
        if (typeof targetDocId !== 'string') continue;
        push(targetDocId, { from_doc: sourceDocId });
      }
    }

    // Pass 2: paragraph-anchored prose links. Only entries with a #NODEID
    // anchor in the href contribute — doc-level prose links are already
    // captured by Pass 1 via the references-auto-sync at save time.
    for (const link of proseLinks) {
      if (!link.to_node) continue; // doc-level — Pass 1 handles it
      push(link.to_doc, {
        from_doc: link.from_doc,
        from_node: link.from_node,
        to_node: link.to_node,
        text: link.text,
      });
    }
  }
  return cache;
}

/** Drop the in-memory cache. Next read rebuilds from disk. Called from
 *  state.ts:writeToDisk after a save that may have changed references OR the
 *  body's prose link set. */
export function invalidateBacklinksCache(): void {
  backlinksCache = null;
}

/**
 * Return every inbound edge pointing at targetDocId — both doc-level (from
 * `references:` frontmatter) and paragraph-anchored (from prose
 * `[text](doc:DOCID#NODEID)` links). Cached in memory.
 *
 * Entries with `to_node` populated are paragraph-anchored: the backlinks
 * decoration plugin paints a dotted underline on the matching target
 * paragraph, and the context menu surfaces "See connections" listing the
 * sources. Entries without `to_node` are doc-level and intended for
 * doc-scope UI (e.g. "N sources link to this doc").
 */
export function computeBacklinksFor(targetDocId: string): Backlink[] {
  if (!backlinksCache) backlinksCache = buildBacklinksCache();
  const entries = backlinksCache.get(targetDocId);
  if (!entries) return [];
  // Stable sort: paragraph-anchored entries first (so per-paragraph UI gets
  // them ordered consistently), then doc-level, both by from_doc.
  return [...entries].sort((a, b) => {
    const aAnchored = a.to_node ? 0 : 1;
    const bAnchored = b.to_node ? 0 : 1;
    if (aAnchored !== bAnchored) return aAnchored - bAnchored;
    if (a.from_doc !== b.from_doc) return a.from_doc < b.from_doc ? -1 : 1;
    if ((a.to_node ?? '') !== (b.to_node ?? '')) return (a.to_node ?? '') < (b.to_node ?? '') ? -1 : 1;
    return 0;
  });
}

// ============================================================================
// PROSE-LINK AUTO-SYNC — backward compat for legacy [text](doc:id) prose links
// ============================================================================

/**
 * Scan a TipTap doc for prose `doc:` links and merge their target docIds
 * into the source's `references:` frontmatter. Idempotent — only writes
 * when there are new docIds to add.
 *
 * Called from state.ts:writeToDisk after the markdown body is persisted, so
 * existing prose links (which still render as click-through internal links
 * via the PadLink TipTap extension) automatically appear in `references:`
 * for graph/crawl/backlinks-panel consumption.
 */
export function syncReferencesFromProse(
  sourceDocId: string,
  sourceDoc: any,
  currentMetadata: Record<string, any>,
): { added: string[]; newReferences: string[] } | null {
  const links = extractForwardLinks(sourceDoc, sourceDocId);
  if (links.length === 0) return null;
  const proseTargets = new Set<string>();
  for (const l of links) proseTargets.add(l.to_doc);
  const existing: string[] = Array.isArray(currentMetadata.references) ? currentMetadata.references : [];
  const merged = new Set<string>(existing);
  const added: string[] = [];
  for (const t of proseTargets) {
    if (!merged.has(t)) {
      merged.add(t);
      added.push(t);
    }
  }
  if (added.length === 0) return null;
  return { added, newReferences: Array.from(merged) };
}

// ============================================================================
// MIGRATION — bulk backfill from prose links + strip stored backlinks
// ============================================================================

/**
 * Full rescan: for every doc, extract prose `doc:` links from body and merge
 * their targets into `references:` frontmatter. Also strip any legacy
 * `backlinks:` field. Idempotent — re-running produces no changes if the
 * corpus is already migrated.
 *
 * Replaces the v0.19 `rebuildAllBacklinks` which built the (now-removed)
 * derived backlinks projection. The new rescue path is `/api/rebuild-references`
 * (with `/api/rebuild-backlinks` kept as a 308 redirect for one release cycle).
 */
export function rebuildAllReferences(): { scanned: number; updated: number } {
  // Shares the backlinks index's per-file parse, so a boot heal leaves that
  // index warm instead of making the first backlinks request parse every doc.
  const allDocs = readAllSourceLinks().filter((d) => typeof d.data.docId === 'string' && d.data.docId);
  let updated = 0;

  for (const d of allDocs) {
    const fm = d;

    // Prose links → docIds
    const proseTargets = new Set(d.proseLinks.map((l) => l.to_doc));

    // Merge with existing references (dedup)
    const existing: string[] = Array.isArray(fm.data.references) ? fm.data.references : [];
    const merged = Array.from(new Set([...existing, ...proseTargets])).sort();

    // Decide whether anything changed
    const referencesChanged = JSON.stringify(existing.slice().sort()) !== JSON.stringify(merged);
    const hadLegacyBacklinks = 'backlinks' in fm.data;
    if (!referencesChanged && !hadLegacyBacklinks) continue;

    const newData = { ...fm.data };
    if (merged.length > 0) newData.references = merged;
    else delete newData.references;
    delete newData.backlinks; // lazy migration

    try {
      writeFrontmatter(d.filename, newData);
      updated++;
    } catch {
      // skip
    }
  }

  invalidateBacklinksCache();
  return { scanned: allDocs.length, updated };
}

/**
 * @deprecated v0.20 — kept as a no-op shim so any caller imports still work.
 * The incremental backlinks pipeline is gone; backlinks compute live. State's
 * writeToDisk no longer calls this.
 */
export function updateBacklinksForSource(): { touched: string[] } {
  return { touched: [] };
}

/**
 * Read previously-saved markdown from disk for a given source filename
 * and extract its forward links. Used by the save hook to compute the
 * "old" link set before the new write lands.
 */
export function extractForwardLinksFromDisk(filename: string, sourceDocId: string): ForwardLink[] {
  try {
    const filePath = resolveDocPath(filename);
    if (isExternalDoc(filename) || !existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = markdownToTiptap(raw);
    return extractForwardLinks(parsed.document, sourceDocId);
  } catch {
    return [];
  }
}
