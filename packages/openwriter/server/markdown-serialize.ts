/**
 * TipTap JSON -> Markdown serialization.
 * Converts TipTap document to markdown with YAML frontmatter.
 */

import { generateNodeId, LEAF_BLOCK_TYPES } from './helpers.js';

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
 * Convert TipTap document to markdown with JSON frontmatter.
 * Metadata stored as minified JSON between --- delimiters (valid YAML).
 * Editor never sees frontmatter — it's stripped on load, regenerated on save.
 * Pending state is persisted in frontmatter `pending` key.
 */
export function tiptapToMarkdown(doc: any, title: string, metadata?: Record<string, any>): string {
  const meta: Record<string, any> = { ...metadata, title };

  // Collect pending state from node attrs into frontmatter
  const pendingState = collectPendingState(doc);
  if (pendingState) {
    meta.pending = pendingState;
  } else {
    delete meta.pending;
  }

  // Strip undefined/null values
  for (const key of Object.keys(meta)) {
    if (meta[key] === undefined || meta[key] === null) delete meta[key];
  }
  const frontmatter = `---\n${JSON.stringify(meta)}\n---\n\n`;
  const body = nodesToMarkdown(doc.content || []);
  return frontmatter + body;
}

function nodesToMarkdown(nodes: any[]): string {
  let result = '';
  for (const node of nodes) {
    result += nodeToMarkdown(node, '');
  }
  return result;
}

function nodeToMarkdown(node: any, indent: string): string {
  switch (node.type) {
    case 'heading': {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level);
      return `${prefix} ${inlineToMarkdown(node.content)}\n\n`;
    }
    case 'paragraph': {
      const text = inlineToMarkdown(node.content);
      // Empty paragraphs use an HTML comment marker to survive markdown round-trips.
      // MarkdownIt collapses bare blank lines, so <!-- --> preserves intentional spacing.
      return text ? `${indent}${text}\n\n` : `${indent}<!-- -->\n\n`;
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

function tableToMarkdown(node: any): string {
  const rows = node.content || [];
  if (rows.length === 0) return '';

  const lines: string[] = [];
  let isFirstRow = true;

  for (const row of rows) {
    const cells = row.content || [];
    const cellTexts = cells.map((cell: any) => {
      const para = cell.content?.[0];
      return para ? inlineToMarkdown(para.content) : '';
    });
    lines.push(`| ${cellTexts.join(' | ')} |`);

    if (isFirstRow) {
      const hasHeaders = cells.some((c: any) => c.type === 'tableHeader');
      if (hasHeaders) {
        lines.push(`| ${cellTexts.map(() => '---').join(' | ')} |`);
      }
      isFirstRow = false;
    }
  }

  return lines.join('\n') + '\n\n';
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
      result += '\n';
      continue;
    }
    if (node.type !== 'text') continue;

    const targetMarks = (node.marks || []).filter((m: any) =>
      SERIALIZED_MARKS.includes(m.type)
    );

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

    result += node.text || '';
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

function extractPlainText(nodes: any[]): string {
  if (!nodes) return '';
  return nodes.map((n) => n.text || '').join('');
}
