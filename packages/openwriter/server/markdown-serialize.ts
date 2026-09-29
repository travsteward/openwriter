/**
 * TipTap JSON -> Markdown serialization.
 * Converts TipTap document to markdown with YAML frontmatter.
 *
 * Node identity persistence:
 *   - Frontmatter `nodes` array carries the (id, fingerprint) pair for every
 *     block in the document. On load, markdown-parse.ts runs the matcher
 *     against this array to reassign IDs to surviving blocks.
 *   - Markdown body is COMPLETELY UNDISTURBED — no anchors, no comment
 *     sentinels (except the legacy `<!-- -->` empty-paragraph marker which
 *     has no semantic ID attached anymore).
 *   - Legacy `^id` caret anchors are no longer emitted. Old docs that still
 *     contain them are migrated transparently on the next save: parse reads
 *     the anchors, matcher pins them, serialize emits the new `nodes`
 *     frontmatter and a clean body.
 *
 * adr: adr/node-identity-matcher.md
 */

import { generateNodeId, LEAF_BLOCK_TYPES } from './helpers.js';
import { tiptapToBlocks } from './node-blocks.js';
import { fingerprintAll, slimEntry, slimEntries, type SlimEntry } from './node-fingerprint.js';

// ============================================================================
// TipTap -> Markdown
// ============================================================================

/** Extract plain text from a TipTap node's inline content. */
export function nodeText(node: any): string {
  if (!node.content) return '';
  return node.content.map((c: any) => c.text || '').join('');
}

/**
 * Collect pending state from leaf blocks into a position-indexed map.
 * Each entry includes a text fingerprint (`t`) for robust matching
 * across markdown round-trips where empty paragraphs may disappear.
 */
function collectPendingState(doc: any): Record<string, any> | undefined {
  const pending: Record<string, any> = {};
  let index = 0;

  function walk(nodes: any[]): void {
    if (!nodes) return;
    for (const node of nodes) {
      if (LEAF_BLOCK_TYPES.has(node.type)) {
        if (node.attrs?.pendingStatus) {
          const entry: any = { s: node.attrs.pendingStatus };
          if (node.attrs.pendingOriginalContent) {
            entry.o = node.attrs.pendingOriginalContent;
          }
          if (node.attrs.pendingGroupId) {
            entry.g = node.attrs.pendingGroupId;
          }
          if (node.attrs.pendingFeedback) entry.f = node.attrs.pendingFeedback;
          // Selection range attrs (sub-paragraph enhance)
          if (node.attrs.pendingSelectionFrom != null) entry.sf = node.attrs.pendingSelectionFrom;
          if (node.attrs.pendingSelectionTo != null) entry.st = node.attrs.pendingSelectionTo;
          if (node.attrs.pendingOriginalFrom != null) entry.of = node.attrs.pendingOriginalFrom;
          if (node.attrs.pendingOriginalTo != null) entry.ot = node.attrs.pendingOriginalTo;
          const t = nodeText(node);
          if (t) entry.t = t;
          pending[String(index)] = entry;
        }
        index++;
      } else if (node.content) {
        walk(node.content);
      }
    }
  }

  walk(doc.content || []);
  return Object.keys(pending).length > 0 ? pending : undefined;
}

/**
 * Build the `nodes` frontmatter entry — one slim tuple per block in
 * pre-order traversal of the TipTap tree.
 *
 * Disk shape is the ultra-lean tuple form from node-fingerprint.ts. Derived
 * fields (position, parent indices, neighbor types, char/word counts) are
 * recomputed at load time from the block tree itself — they don't go to disk.
 */
function collectNodesFrontmatter(doc: any): SlimEntry[] {
  const blocks = tiptapToBlocks(doc);
  const fingerprints = fingerprintAll(blocks);
  const ids = collectBlockIds(doc);
  const out: SlimEntry[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const id = ids[i] || generateNodeId();
    out.push(slimEntry(id, fingerprints[i]));
  }
  return out;
}

/**
 * Cap graveyard size to avoid frontmatter bloat on docs with many edits.
 * Newest entries (highest position) win — the ones most likely to be
 * paste-back targets. Older entries expire silently.
 */
const GRAVEYARD_MAX = 50;

/** Walk the TipTap tree in the SAME pre-order as tiptapToBlocks, collect IDs. */
function collectBlockIds(doc: any): string[] {
  const ids: string[] = [];
  const blockTypes = new Set([
    'heading', 'paragraph', 'bulletList', 'orderedList', 'taskList',
    'listItem', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule',
    'table', 'image', 'tableRow', 'tableCell', 'tableHeader',
    'footnoteSection', 'footnoteDefinition',
  ]);
  const containerTypes = new Set([
    'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote',
    'footnoteSection', 'footnoteDefinition',
  ]);
  function walk(nodes: any[]): void {
    if (!nodes) return;
    for (const node of nodes) {
      if (blockTypes.has(node.type)) {
        ids.push(node.attrs?.id || '');
        if (containerTypes.has(node.type) && node.content) walk(node.content);
      } else if (node.content) {
        walk(node.content);
      }
    }
  }
  walk(doc.content || []);
  return ids;
}

/**
 * Convert TipTap document to markdown with JSON frontmatter.
 * Metadata stored as minified JSON between --- delimiters (valid YAML).
 * Editor never sees frontmatter — it's stripped on load, regenerated on save.
 * Pending state is persisted in frontmatter `pending` key.
 * Node identity persisted in frontmatter `nodes` key (id + fingerprint per block).
 */
export function tiptapToMarkdown(doc: any, title: string, metadata?: Record<string, any>): string {
  const meta: Record<string, any> = { ...metadata, title };

  // Disk is canonical only — never emit `pending:` frontmatter. Pending
  // state lives in the sidecar at `_pending/{docId}.json`, separated from
  // the .md file so external markdown editors see clean canonical content.
  //
  // If the caller passed a doc that still has in-memory pending attrs,
  // serialize from a reverted clone so the body is canonical. Callers
  // that have already done the split (writeToDisk's overlay path) pass
  // an already-canonical doc; this revert is a no-op for them.
  // adr: adr/pending-overlay-model.md
  delete meta.pending;
  const canonicalDoc = revertPendingForSerialization(doc);

  // Collect node identity graph (id + fingerprint per block) for next-load matcher
  const nodes = collectNodesFrontmatter(canonicalDoc);
  if (nodes.length > 0) {
    meta.nodes = nodes;
  } else {
    delete meta.nodes;
  }

  // Graveyard: recently-orphaned entries kept across saves so paste-back/undo
  // can restore the original ID via exact fingerprint match. Caller passes
  // `{id, fingerprint}` objects (matcher output); we cap, slim, and emit.
  if (Array.isArray(meta.graveyard) && meta.graveyard.length > 0) {
    const capped = meta.graveyard.slice(0, GRAVEYARD_MAX);
    meta.graveyard = capped.map((g: any) =>
      Array.isArray(g) ? g : slimEntry(g.id, g.fingerprint || g.fp),
    );
  } else {
    delete meta.graveyard;
  }

  // Strip undefined/null values
  for (const key of Object.keys(meta)) {
    if (meta[key] === undefined || meta[key] === null) delete meta[key];
  }
  const frontmatter = `---\n${JSON.stringify(meta)}\n---\n\n`;
  // Serialize the body from the canonical (reverted) clone — never from the
  // pending-modified live doc, otherwise the on-disk body would contain
  // rewritten prose without the original anywhere to revert to.
  const body = nodesToMarkdown(canonicalDoc.content || []);
  return frontmatter + body;
}

/** Convert TipTap document to markdown body only (no frontmatter).
 *  Like tiptapToMarkdown, the body is canonical (pending reverted). */
export function tiptapToBody(doc: any): string {
  const canonicalDoc = revertPendingForSerialization(doc);
  return nodesToMarkdown(canonicalDoc.content || []);
}

/**
 * Deep clone of `doc` with pending decorations reverted, used by the
 * markdown serializer to ensure disk content is canonical. Mirrors
 * state.cloneWithPendingReverted but is local to the serializer to
 * avoid a state.ts → markdown-serialize.ts cycle.
 *
 * - status='insert' → drop the node
 * - status='rewrite' → restore from pendingOriginalContent (or drop if absent)
 * - status='delete' → keep but clear pending attrs
 * - no status → keep, strip stray pending attrs
 */
const PENDING_KEYS = ['pendingStatus', 'pendingOriginalContent', 'pendingGroupId', 'pendingFeedback', 'pendingTextEdits', 'pendingSelectionFrom', 'pendingSelectionTo', 'pendingOriginalFrom', 'pendingOriginalTo', 'pendingOrphan', 'pendingStaleBaseline'];
function revertPendingForSerialization(doc: any): any {
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
    for (const node of nodes || []) {
      const status = node?.attrs?.pendingStatus;
      if (status === 'insert') continue;
      if (status === 'rewrite') {
        const original = node.attrs?.pendingOriginalContent;
        if (original) result.push(clean(original));
        continue;
      }
      result.push(clean(node));
    }
    return result;
  }
  return { type: 'doc', content: walk(doc?.content || []) };
}

function nodesToMarkdown(nodes: any[]): string {
  // Constrained model: `footnoteSection` is always emitted last, regardless of
  // its position in the tree. Authors / agents / editor drag operations may
  // place it anywhere; the serializer normalizes. Parse accepts flexibly;
  // serialize produces strictly. First save of any non-canonical file becomes
  // the one-time migration.
  //
  // Trailing-empty-paragraph stripping: TipTap inserts an empty paragraph at
  // end-of-doc as a cursor-landing artifact. It serializes to a stray
  // `<!-- -->` marker — visual cruft with no semantic value, and the next
  // load just re-creates the cursor-landing paragraph anyway. Drop trailing
  // empty paragraphs unconditionally (whether or not a footnoteSection is
  // present): they're editor state, not on-disk content.
  //
  // Empty paragraphs in the MIDDLE of the doc are preserved — those are
  // authored blank lines between sections and carry intent. Only the trailing
  // run of empties at end-of-body gets stripped.
  //
  // adr: adr/footnote-system.md
  let deferredSection: any | null = null;
  const body: any[] = [];
  for (const node of nodes) {
    if (node.type === 'footnoteSection') {
      deferredSection = node;
      continue;
    }
    body.push(node);
  }
  while (body.length > 0) {
    const last = body[body.length - 1];
    if (last.type === 'paragraph' && (!last.content || last.content.length === 0)) {
      body.pop();
    } else {
      break;
    }
  }
  let result = '';
  for (const node of body) {
    result += nodeToMarkdown(node, '');
  }
  if (deferredSection) {
    result += footnoteSectionToMarkdown(deferredSection);
  }
  return result;
}

/**
 * Serialize the footnoteSection block. Each definition emits as
 * `[^label]: first-paragraph-content` with continuation paragraphs indented
 * 4 spaces (Pandoc continuation convention). Empty section emits nothing.
 *
 * Definitions with no content still emit a `[^label]:` line so the reference
 * doesn't dangle on round-trip.
 *
 * adr: adr/footnote-system.md
 */
function footnoteSectionToMarkdown(section: any): string {
  const definitions = (section.content || []).filter((d: any) => d.type === 'footnoteDefinition');
  if (definitions.length === 0) return '';

  const lines: string[] = [];
  for (const def of definitions) {
    const label = def.attrs?.label || '';
    const paragraphs = (def.content || []).filter((c: any) => c.type === 'paragraph');
    if (paragraphs.length === 0) {
      lines.push(`[^${label}]: `);
      continue;
    }
    const firstText = inlineToMarkdown(paragraphs[0].content || []);
    lines.push(`[^${label}]: ${firstText}`);
    // Continuation paragraphs: 4-space indent per Pandoc convention.
    for (let i = 1; i < paragraphs.length; i++) {
      const text = inlineToMarkdown(paragraphs[i].content || []);
      lines.push('');
      lines.push(`    ${text}`);
    }
  }
  return lines.join('\n') + '\n';
}

function nodeToMarkdown(node: any, indent: string): string {
  switch (node.type) {
    case 'heading': {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level);
      // Body stays undisturbed — node ID is persisted in frontmatter `nodes`, not as a trailing anchor.
      return `${prefix} ${inlineToMarkdown(node.content)}\n\n`;
    }
    case 'paragraph': {
      const text = inlineToMarkdown(node.content);
      if (text) {
        return `${indent}${text}\n\n`;
      }
      // Empty paragraph: use plain sentinel (frontmatter `nodes` carries the ID).
      return `${indent}<!-- -->\n\n`;
    }
    case 'bulletList':
      return listToMarkdown(node.content, '- ', indent);
    case 'orderedList':
      return listToMarkdown(node.content, null, indent);
    case 'taskList':
      return taskListToMarkdown(node.content, indent);
    case 'blockquote': {
      const inner = nodesToMarkdown(node.content || []);
      return inner
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n') + '\n';
    }
    case 'codeBlock': {
      const lang = node.attrs?.language || '';
      const text = extractPlainText(node.content);
      return `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }
    case 'horizontalRule':
      return '---\n\n';
    case 'image': {
      const src = node.attrs?.src || '';
      const alt = node.attrs?.alt || '';
      return `![${alt}](${src})\n\n`;
    }
    case 'table':
      return tableToMarkdown(node);
    default:
      if (node.content) return nodesToMarkdown(node.content);
      if (node.text) return node.text;
      return '';
  }
}

function listToMarkdown(items: any[], bullet: string | null, indent: string): string {
  if (!items) return '';
  let result = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prefix = bullet || `${i + 1}. `;
    const content = item.content || [];
    for (let j = 0; j < content.length; j++) {
      const child = content[j];
      if (j === 0) {
        const text = child.type === 'paragraph' ? inlineToMarkdown(child.content) : nodeToMarkdown(child, '');
        result += `${indent}${prefix}${text.trimEnd()}\n`;
      } else {
        result += nodeToMarkdown(child, indent + '  ');
      }
    }
  }
  return result + '\n';
}

function taskListToMarkdown(items: any[], indent: string): string {
  if (!items) return '';
  let result = '';
  for (const item of items) {
    const checked = item.attrs?.checked ? 'x' : ' ';
    const content = item.content || [];
    for (let j = 0; j < content.length; j++) {
      const child = content[j];
      if (j === 0) {
        const text = child.type === 'paragraph' ? inlineToMarkdown(child.content) : nodeToMarkdown(child, '');
        result += `${indent}- [${checked}] ${text.trimEnd()}\n`;
      } else {
        result += nodeToMarkdown(child, indent + '  ');
      }
    }
  }
  return result + '\n';
}

/**
 * Serialize a TipTap table node to GFM markdown.
 *
 * Critical invariants (each one's absence causes silent table → paragraph
 * loss on round-trip — observed live as `sync-check FAIL: expected table,
 * got paragraph` on the Beat Sheet doc):
 *
 *   1. ALWAYS emit the header-separator row `| --- | --- |` after the first
 *      row, regardless of whether any cell is a `tableHeader`. GFM table
 *      recognition requires the delimiter row — without it, markdown-it
 *      parses each `| ... |` line as a paragraph and the entire table is
 *      dropped. (One-time consequence: a header-less table's first row
 *      becomes `tableHeader` cells after the first round-trip. Stable
 *      thereafter.)
 *
 *   2. Escape `|` inside cell text as `\|` so it doesn't terminate the cell
 *      column.
 *
 *   3. Collapse multi-paragraph cells with `<br>` joiners. The inline
 *      cell format can't represent multiple block paragraphs; without
 *      collapsing, only the first paragraph round-trips and the rest are
 *      silently lost.
 *
 *   4. Ensure a blank line precedes the table block (caller does `\n\n`
 *      tailing on prior nodes; we keep the leading newline minimal).
 */
function tableToMarkdown(node: any): string {
  const rows = node.content || [];
  if (rows.length === 0) return '';

  function cellContentToText(cell: any): string {
    const content = cell.content || [];
    if (content.length === 0) return '';
    // Each cell typically holds one paragraph, but a TipTap table can carry
    // multi-paragraph cells (and arbitrary blocks). Concatenate paragraphs
    // with <br> so no inline content is dropped.
    const parts: string[] = [];
    for (const child of content) {
      if (child.type === 'paragraph') {
        parts.push(inlineToMarkdown(child.content));
      } else if (child.content) {
        // Non-paragraph block (rare in tables) — fall through to inline.
        parts.push(inlineToMarkdown(child.content));
      }
    }
    // Escape pipes and replace newlines with <br>.
    return parts.join('<br>').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  }

  const lines: string[] = [];
  const firstRowCells = rows[0]?.content || [];
  const columnCount = firstRowCells.length;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cells = row.content || [];
    const cellTexts = cells.map(cellContentToText);
    // Pad short rows so the markdown table has consistent column count.
    while (cellTexts.length < columnCount) cellTexts.push('');
    lines.push(`| ${cellTexts.join(' | ')} |`);

    if (r === 0) {
      // ALWAYS emit the separator — GFM parsing requires it for table
      // recognition. This is the load-bearing invariant.
      lines.push(`| ${Array(columnCount).fill('---').join(' | ')} |`);
    }
  }

  // Leading blank line ensures we're not glued to the prior block (which
  // would cause the table to be consumed as a paragraph continuation).
  return '\n' + lines.join('\n') + '\n\n';
}

// ---- Inline mark serialization ----

const SERIALIZED_MARKS = ['bold', 'italic', 'code', 'strike', 'underline', 'highlight', 'subscript', 'superscript', 'link'];

export function inlineToMarkdown(nodes: any[]): string {
  if (!nodes) return '';

  let result = '';
  let openMarks: any[] = [];

  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      result += closeAllMarks(openMarks);
      openMarks = [];
      result += '<br>';
      continue;
    }
    if (node.type === 'footnoteReference') {
      // Close any open marks so `[^N]` lands at the prose level, not inside
      // a bold/italic span. Footnote references are visually distinct chips;
      // wrapping them in bold or italic doesn't make sense.
      // adr: adr/footnote-system.md
      result += closeAllMarks(openMarks);
      openMarks = [];
      const label = node.attrs?.label || '';
      result += `[^${label}]`;
      continue;
    }
    if (node.type !== 'text') continue;

    const targetMarks = (node.marks || [])
      .filter((m: any) => SERIALIZED_MARKS.includes(m.type))
      .sort((a: any, b: any) => SERIALIZED_MARKS.indexOf(a.type) - SERIALIZED_MARKS.indexOf(b.type));

    // Find common prefix of marks between open and target
    let commonLen = 0;
    while (commonLen < openMarks.length && commonLen < targetMarks.length) {
      if (!marksEqual(openMarks[commonLen], targetMarks[commonLen])) break;
      commonLen++;
    }

    // Close marks that are no longer needed (reverse order)
    for (let i = openMarks.length - 1; i >= commonLen; i--) {
      result += markSyntax(openMarks[i], false);
    }

    // Open new marks
    for (let i = commonLen; i < targetMarks.length; i++) {
      result += markSyntax(targetMarks[i], true);
    }

    // Skip HTML escape for text inside inline code — CommonMark treats
    // backtick spans as verbatim, so `&lt;` would render literally.
    const hasCodeMark = (node.marks || []).some((m: any) => m.type === 'code');
    result += hasCodeMark ? (node.text || '') : escapeInlineHtml(node.text || '');
    openMarks = [...targetMarks];
  }

  // Close remaining marks
  for (let i = openMarks.length - 1; i >= 0; i--) {
    result += markSyntax(openMarks[i], false);
  }

  return result;
}

function markSyntax(mark: any, isOpen: boolean): string {
  switch (mark.type) {
    case 'bold': return '**';
    case 'italic': return '*';
    case 'code': return '`';
    case 'strike': return '~~';
    case 'underline': return '++';
    case 'highlight': return '==';
    case 'subscript': return '~';
    case 'superscript': return '^';
    case 'link': return isOpen ? '[' : `](<${mark.attrs?.href || ''}>)`;
    default: return '';
  }
}

function marksEqual(a: any, b: any): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'link') return a.attrs?.href === b.attrs?.href;
  return true;
}

function closeAllMarks(marks: any[]): string {
  let result = '';
  for (let i = marks.length - 1; i >= 0; i--) {
    result += markSyntax(marks[i], false);
  }
  return result;
}

/** Escape `<` in inline text so MarkdownIt (html:true) won't parse user text as HTML. */
function escapeInlineHtml(text: string): string {
  return text.replace(/</g, '&lt;');
}

function extractPlainText(nodes: any[]): string {
  if (!nodes) return '';
  return nodes.map((n) => n.text || '').join('');
}
