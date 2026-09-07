/**
 * Outline + peek primitives for node-level doc navigation.
 *
 * The "orient by content, pick by node" architectural rule lives here.
 *
 * - outline returns the heading skeleton (and optional drill-down into one
 *   section) so an agent can see what a doc IS without reading bodies.
 * - peek returns a windowed slice of nodes (around an anchor, by range, by
 *   position, by explicit IDs) once the agent has a node ID to orient on.
 *
 * Neither tool initiates by node — node IDs are byproducts of content
 * orientation (search hit, outline pick, deep-link click, prior peek).
 */

import type { PadDocument } from './state.js';

interface TipTapNode {
  type: string;
  attrs?: Record<string, any>;
  content?: TipTapNode[];
  text?: string;
}

// ============================================================================
// OUTLINE
// ============================================================================

export interface OutlineOptions {
  /** Restrict the outline to a single section (the named heading's nodeId
   *  and everything beneath it, up to the next same-or-shallower heading). */
  underHeading?: string;
  /** Cap on heading levels shown. 1 = only h1, 2 = h1+h2, etc. Default 3.
   *  Ignored when underHeading is set (drill-down always shows full content). */
  depth?: number;
  /** Pagination — start index into the rendered line array. Default 0. */
  offset?: number;
  /** Pagination — max lines to return. Default 200. */
  limit?: number;
}

/** Render the outline for a doc.
 *
 *  Default behavior: heading tree only (filtered by depth).
 *  underHeading set: full block list inside that section, with one-line
 *    previews per block (~10–15 tokens each).
 *  No headings present: falls back to top-level block previews.
 */
export function outline(doc: PadDocument, opts: OutlineOptions = {}): string {
  const depth = Math.max(1, Math.min(6, opts.depth ?? 3));
  const content = doc.content || [];
  let lines: string[];

  if (opts.underHeading) {
    lines = renderSection(content, opts.underHeading);
  } else {
    const headings = collectHeadings(content, depth);
    // A sole h1 follows the document-title convention. Multiple h1s are
    // chapter structure: keep every one, including the first chapter.
    const filtered = headings.filter(h => h.level === 1).length === 1 && headings[0].level === 1
      ? headings.slice(1)
      : headings;
    if (filtered.length > 0) {
      lines = filtered.map(renderHeading);
    } else if (headings.length === 0) {
      // Doc has no headings — fall back to block previews so the agent
      // still gets a structural read.
      lines = collectTopLevelPreviews(content);
    } else {
      // Doc has ONLY the title h1 (no body headings). Fall back to
      // top-level block previews so the agent has something to navigate.
      lines = collectTopLevelPreviews(content);
    }
  }

  // Pagination — applied to rendered lines so the agent can walk a
  // huge skeleton incrementally without re-fetching the whole thing.
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.max(1, opts.limit ?? 200);
  const total = lines.length;
  const slice = lines.slice(offset, offset + limit);
  const header = opts.underHeading
    ? `outline (section ${opts.underHeading}):`
    : `outline (depth ${depth}):`;
  const footer = total > offset + limit
    ? `\n[showing ${slice.length} of ${total} lines — call again with offset=${offset + limit} for more]`
    : '';
  return `${header}\n${slice.join('\n')}${footer}`;
}

interface HeadingEntry {
  level: number;
  text: string;
  id?: string;
}

function collectHeadings(content: TipTapNode[], maxDepth: number): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  function walk(nodes: TipTapNode[]): void {
    for (const n of nodes) {
      if (n.type === 'heading') {
        const level = n.attrs?.level ?? 1;
        if (level <= maxDepth) {
          out.push({ level, text: extractText(n), id: n.attrs?.id });
        }
      }
      // Headings can only legally appear at top level in OpenWriter docs,
      // but recurse defensively so we don't miss any author-malformed trees.
      if (n.content) walk(n.content);
    }
  }
  walk(content);
  return out;
}

function renderHeading(h: HeadingEntry): string {
  const indent = '  '.repeat(Math.max(0, h.level - 1));
  const idTag = h.id ? `[h${h.level}:${h.id}] ` : `[h${h.level}] `;
  return `${indent}${idTag}${h.text}`;
}

/** Return preview lines for every top-level block in the doc — used when
 *  there are no headings to anchor an outline on. */
function collectTopLevelPreviews(content: TipTapNode[]): string[] {
  return content.map((node) => previewLine(node));
}

/** Walk the doc and return preview lines for every block from the named
 *  heading up to (but not including) the next heading at the same level
 *  or shallower. */
function renderSection(content: TipTapNode[], headingId: string): string[] {
  // Find the heading at top level
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < content.length; i++) {
    const n = content[i];
    if (n.type === 'heading' && n.attrs?.id === headingId) {
      startIdx = i;
      startLevel = n.attrs?.level ?? 1;
      break;
    }
  }
  if (startIdx === -1) return [`(no heading with id ${headingId} found at top level)`];

  const lines: string[] = [];
  // Include the heading itself first, then walk forward until end-of-section.
  for (let i = startIdx; i < content.length; i++) {
    const n = content[i];
    if (i > startIdx && n.type === 'heading' && (n.attrs?.level ?? 1) <= startLevel) break;
    lines.push(previewLine(n));
  }
  return lines;
}

/** ~10–15 token preview of a top-level block — type tag + nodeId + first
 *  ~80 chars of inner text. Lists collapse to their item-count summary. */
function previewLine(node: TipTapNode): string {
  const id = node.attrs?.id ? `:${node.attrs.id}` : '';
  if (node.type === 'heading') {
    const level = node.attrs?.level ?? 1;
    return `[h${level}${id}] ${extractText(node)}`;
  }
  if (node.type === 'paragraph') {
    const txt = extractText(node);
    return `[p${id}] ${truncate(txt, 80)}`;
  }
  if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
    const count = (node.content ?? []).length;
    const shortType = node.type === 'bulletList' ? 'ul' : node.type === 'orderedList' ? 'ol' : 'tl';
    return `[${shortType}${id}] (${count} item${count === 1 ? '' : 's'})`;
  }
  if (node.type === 'blockquote') {
    return `[bq${id}] ${truncate(firstChildText(node), 80)}`;
  }
  if (node.type === 'codeBlock') {
    const lang = node.attrs?.language || '';
    return `[code${id}${lang ? ' ' + lang : ''}] ${truncate(extractText(node), 60)}`;
  }
  if (node.type === 'horizontalRule') {
    return `[hr${id}] ---`;
  }
  if (node.type === 'table') {
    const rows = (node.content ?? []).length;
    return `[table${id}] (${rows} row${rows === 1 ? '' : 's'})`;
  }
  if (node.type === 'image') {
    return `[img${id}] ${node.attrs?.alt || node.attrs?.src || ''}`;
  }
  if (node.type === 'footnoteSection' || node.type === 'footnoteDefinition') {
    return `[${node.type}${id}] ${truncate(firstChildText(node), 60)}`;
  }
  return `[${node.type}${id}]`;
}

function firstChildText(node: TipTapNode): string {
  if (!node.content) return '';
  for (const c of node.content) {
    const t = extractText(c);
    if (t) return t;
  }
  return '';
}

function extractText(node: TipTapNode): string {
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (!node.content) return '';
  return node.content.map(extractText).join('');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '…';
}

// ============================================================================
// PEEK
// ============================================================================

export type PeekTarget =
  | { node: string }
  | { nodes: string[] }
  | { around: string; before?: number; after?: number }
  | { from: string; to: string }
  | { first: number }
  | { last: number }
  | { position: number; span?: number };

/** Return a windowed slice of TipTap nodes from a doc per the target spec.
 *  The caller renders via compactNodes — this function returns raw nodes
 *  so the rendering pipeline stays uniform with read_pad / get_nodes. */
export function peek(doc: PadDocument, target: PeekTarget): TipTapNode[] {
  const content = doc.content || [];

  if ('node' in target) {
    return findById(content, [target.node]);
  }
  if ('nodes' in target) {
    return findById(content, target.nodes);
  }
  if ('around' in target) {
    const idx = findTopLevelIndex(content, target.around);
    if (idx === -1) return [];
    const before = Math.max(0, target.before ?? 1);
    const after = Math.max(0, target.after ?? 1);
    return content.slice(Math.max(0, idx - before), Math.min(content.length, idx + after + 1));
  }
  if ('from' in target) {
    const a = findTopLevelIndex(content, target.from);
    const b = findTopLevelIndex(content, target.to);
    if (a === -1 || b === -1) return [];
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return content.slice(lo, hi + 1);
  }
  if ('first' in target) {
    return content.slice(0, Math.max(1, target.first));
  }
  if ('last' in target) {
    const n = Math.max(1, target.last);
    return content.slice(Math.max(0, content.length - n));
  }
  if ('position' in target) {
    const pos = Math.max(0, Math.min(1, target.position));
    const span = Math.max(1, target.span ?? 3);
    const idx = Math.min(content.length - 1, Math.floor(content.length * pos));
    return content.slice(idx, Math.min(content.length, idx + span));
  }
  return [];
}

/** Find every node matching one of the given IDs — full-tree walk to support
 *  IDs on nested blocks (list items, table cells, etc.). Same shape as
 *  state.findNodesByIds but lives here to keep peek-outline self-contained. */
function findById(content: TipTapNode[], ids: string[]): TipTapNode[] {
  const set = new Set(ids);
  const out: TipTapNode[] = [];
  function walk(nodes: TipTapNode[]): void {
    for (const n of nodes) {
      if (n.attrs?.id && set.has(n.attrs.id)) out.push(n);
      if (n.content) walk(n.content);
    }
  }
  walk(content);
  return out;
}

/** Return the top-level doc.content index whose subtree contains nodeId.
 *  Handles nested IDs by walking each top-level subtree. */
function findTopLevelIndex(content: TipTapNode[], id: string): number {
  function contains(node: TipTapNode): boolean {
    if (node.attrs?.id === id) return true;
    if (!node.content) return false;
    for (const c of node.content) if (contains(c)) return true;
    return false;
  }
  for (let i = 0; i < content.length; i++) {
    if (contains(content[i])) return i;
  }
  return -1;
}

// ============================================================================
// TRUNCATED READ (read_pad cost cap)
// ============================================================================

/** A fractional region of a doc, expressed as word-count percentiles.
 *  `from` and `to` are floats in [0, 1] with from < to. {from:0, to:0.5}
 *  is the first half by word count; {from:0.25, to:0.75} is the middle half.
 *  Snap-to-node-boundary means the returned slice may extend slightly past
 *  the exact percentiles in either direction — agents get whole blocks,
 *  not mid-sentence fragments. */
export interface ReadSlice {
  from: number;
  to: number;
}

export interface TruncatedReadOptions {
  /** Hard ceiling on returned words. Default 2,000. Ignored when `force` is true. */
  maxWords?: number;
  /** Bypass `maxWords` and return the full requested region. Use for full-doc
   *  audits, rewrites, or any case where the agent has explicitly accepted the cost. */
  force?: boolean;
  /** Read a fraction of the doc rather than the opening. */
  slice?: ReadSlice;
}

export interface TruncatedRead {
  /** Slice of the doc returned (full doc when no truncation and no slice). */
  doc: PadDocument;
  /** True when the returned content is smaller than the requested region. */
  truncated: boolean;
  /** Total words in the original doc. */
  totalWords: number;
  /** Words actually returned. */
  returnedWords: number;
  /** First top-level nodeId in the returned slice (anchor for the chunk before this one). */
  firstNodeId: string | null;
  /** Last top-level nodeId in the returned slice (anchor for `peek_doc({ around })` continuation). */
  lastNodeId: string | null;
  /** Words still unread within the requested region. */
  remaining: number;
  /** Echoed back when the caller supplied a slice; null otherwise. */
  slice: ReadSlice | null;
  /** True when `force: true` was supplied — surfaced so the handler can label the response. */
  forced: boolean;
}

/** Count whitespace-delimited tokens across every text node in `nodes`.
 *  Mirrors the convention used elsewhere in the server (extractText + split). */
export function countWords(nodes: TipTapNode[]): number {
  function collect(node: TipTapNode): string {
    if (node.type === 'text' && typeof node.text === 'string') return node.text;
    if (!node.content) return '';
    return node.content.map(collect).join(' ');
  }
  const text = nodes.map(collect).join(' ').trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

/** Read a region of a doc, truncated at a top-level node boundary so the
 *  returned content doesn't exceed `maxWords` (unless `force` is set).
 *
 *  Three modes:
 *  - **Default** (no slice, no force) — first N words of the doc, capped at
 *    `maxWords`. read_pad's original contract: doc opening + continuation hint.
 *  - **Slice** (`{ from, to }`) — words in the percentile range. Snaps to top-level
 *    node boundaries so blocks aren't split mid-sentence. Still subject to
 *    `maxWords` unless `force` is set; an agent walking 10% chunks of a large
 *    doc gets predictable per-call cost.
 *  - **Force** — bypass the cap. Returns the full requested region (whole doc
 *    if no slice, the whole slice if sliced). Use for full-doc audits and
 *    rewrites where the agent has explicitly accepted the cost.
 *
 *  Node-boundary truncation (never splits a top-level block) keeps the
 *  returned slice structurally valid markdown — list items, blockquotes,
 *  and code blocks stay intact. */
export function truncateRead(doc: PadDocument, options: TruncatedReadOptions = {}): TruncatedRead {
  const maxWords = options.maxWords ?? 2000;
  const force = !!options.force;
  const sliceIn = options.slice ?? null;

  // Clamp/validate slice — clamp to [0,1], silently fix swapped or degenerate inputs.
  let slice: ReadSlice | null = null;
  if (sliceIn) {
    const from = Math.max(0, Math.min(1, sliceIn.from));
    const to = Math.max(0, Math.min(1, sliceIn.to));
    slice = from < to ? { from, to } : { from: 0, to: 1 };
  }

  const content = doc.content || [];
  const totalWords = countWords(content);
  const lastTopId = (n: TipTapNode | undefined): string | null => n?.attrs?.id ?? null;

  // Empty doc — nothing to slice or truncate.
  if (content.length === 0) {
    return {
      doc,
      truncated: false,
      totalWords: 0,
      returnedWords: 0,
      firstNodeId: null,
      lastNodeId: null,
      remaining: 0,
      slice,
      forced: force,
    };
  }

  // Step 1: pick the candidate node range based on slice (or all nodes if no slice).
  // Word-position-based: walk top-level nodes, snap to boundaries that contain
  // the slice's word range. A node is included if any of its words fall inside
  // [fromWord, toWord) — rounds outward, agent always gets whole blocks.
  let candidateStart = 0;
  let candidateEnd = content.length;
  let candidateTotalWords = totalWords;

  if (slice) {
    const fromWord = Math.floor(slice.from * totalWords);
    const toWord = Math.ceil(slice.to * totalWords);
    let cum = 0;
    let startIdx = -1;
    let endIdx = content.length;
    for (let i = 0; i < content.length; i++) {
      const w = countWords([content[i]]);
      const nodeStart = cum;
      const nodeEnd = cum + w;
      // Include node if its word span overlaps [fromWord, toWord).
      if (startIdx === -1 && nodeEnd > fromWord) startIdx = i;
      if (startIdx !== -1 && nodeStart >= toWord) { endIdx = i; break; }
      cum += w;
    }
    if (startIdx === -1) startIdx = content.length - 1;
    candidateStart = startIdx;
    candidateEnd = endIdx;
    candidateTotalWords = countWords(content.slice(candidateStart, candidateEnd));
  }

  // Step 2: apply maxWords cap to the candidate range (unless forced).
  const candidate = content.slice(candidateStart, candidateEnd);
  if (force || candidateTotalWords <= maxWords) {
    const firstNodeId = lastTopId(candidate[0]);
    const lastNodeId = lastTopId(candidate[candidate.length - 1]);
    return {
      doc: { ...doc, content: candidate },
      truncated: false,
      totalWords,
      returnedWords: candidateTotalWords,
      firstNodeId,
      lastNodeId,
      remaining: 0,
      slice,
      forced: force,
    };
  }

  // Step 3: candidate exceeds cap — truncate from the start of the candidate
  // range, including whole top-level blocks until adding the next would exceed
  // the cap. Always include at least one node.
  const included: TipTapNode[] = [];
  let words = 0;
  let lastNodeId: string | null = null;

  for (const n of candidate) {
    const w = countWords([n]);
    if (included.length > 0 && words + w > maxWords) break;
    included.push(n);
    words += w;
    if (n.attrs?.id) lastNodeId = n.attrs.id;
  }

  return {
    doc: { ...doc, content: included },
    truncated: true,
    totalWords,
    returnedWords: words,
    firstNodeId: lastTopId(included[0]),
    lastNodeId,
    remaining: candidateTotalWords - words,
    slice,
    forced: false,
  };
}

// ============================================================================
// SEARCH WITHIN ONE DOC (scoped search_docs)
// ============================================================================

export interface InDocMatch {
  nodeId: string;
  type: string;
  snippet: string;
}

/** Find blocks whose text matches the query inside one doc. Returns up to
 *  `limit` matches with the matched node's ID, type, and a snippet around
 *  the hit. Case-insensitive substring match, same shape as the workspace-
 *  scoped search but scoped to one doc and returning node-level handles.
 *
 *  Only nodes with an addressable `attrs.id` are emitted as matches. The
 *  walker still descends into IDless children (text runs, inline marks) so
 *  block-level matches are found, but it does NOT emit those children as
 *  their own hits — they're already represented by their parent block's
 *  entry, and emitting them duplicates results. */
export function searchInDoc(doc: PadDocument, query: string, limit = 10): InDocMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: InDocMatch[] = [];
  function walk(nodes: TipTapNode[]): void {
    if (out.length >= limit) return;
    for (const n of nodes) {
      if (out.length >= limit) return;
      if (n.attrs?.id) {
        const text = extractText(n);
        if (text) {
          const lower = text.toLowerCase();
          const idx = lower.indexOf(q);
          if (idx !== -1) {
            const start = Math.max(0, idx - 30);
            const end = Math.min(text.length, idx + q.length + 50);
            out.push({
              nodeId: n.attrs.id,
              type: n.type,
              snippet: (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''),
            });
          }
        }
      }
      if (n.content) walk(n.content);
    }
  }
  walk(doc.content || []);
  return out;
}
