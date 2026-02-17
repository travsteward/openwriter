/**
 * Compact wire format for MCP tool communication.
 * Tagged-line representation: ~10x token reduction vs pretty JSON.
 *
 * Format:
 *   title: My Document
 *   words: 1,247
 *   pending: 0
 *   ---
 *   [h1:abc12345] Chapter One
 *   [p:def45678] The quick brown fox.
 *   [ul:ghi78901]
 *     [li:jkl01234] First bullet
 */

import { markdownToNodes } from './markdown.js';

// ============================================================================
// TipTap JSON -> Compact tagged-line format
// ============================================================================

const TYPE_MAP: Record<string, string> = {
  heading: 'h',
  paragraph: 'p',
  blockquote: 'bq',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  codeBlock: 'cb',
  horizontalRule: 'hr',
  table: 'tbl',
  tableRow: 'tr',
  tableHeader: 'th',
  tableCell: 'td',
  taskList: 'tasks',
  taskItem: 'task',
  image: 'img',
};

function nodeId(id: string | undefined): string {
  return id || '________';
}

function compactType(node: any): string {
  if (node.type === 'heading') {
    const level = node.attrs?.level || 1;
    return `h${level}`;
  }
  return TYPE_MAP[node.type] || node.type;
}

function inlineToCompact(nodes: any[]): string {
  if (!nodes) return '';
  return nodes.map((node) => {
    if (node.type === 'hardBreak') return '\n';
    if (node.type !== 'text') return '';

    let text = node.text || '';
    if (!node.marks) return text;

    // Apply marks as markdown syntax
    for (const mark of [...node.marks].reverse()) {
      switch (mark.type) {
        case 'bold': text = `**${text}**`; break;
        case 'italic': text = `*${text}*`; break;
        case 'code': text = `\`${text}\``; break;
        case 'strike': text = `~~${text}~~`; break;
        case 'underline': text = `++${text}++`; break;
        case 'highlight': text = `==${text}==`; break;
        case 'subscript': text = `~${text}~`; break;
        case 'superscript': text = `^${text}^`; break;
        case 'link': text = `[${text}](${mark.attrs?.href || ''})`; break;
      }
    }
    return text;
  }).join('');
}

function nodeToCompactLines(node: any, indent: string): string[] {
  const lines: string[] = [];
  const tag = `[${compactType(node)}:${nodeId(node.attrs?.id)}]`;

  if (node.type === 'horizontalRule') {
    lines.push(`${indent}${tag}`);
    return lines;
  }

  if (node.type === 'codeBlock') {
    const lang = node.attrs?.language || '';
    const text = (node.content || []).map((n: any) => n.text || '').join('');
    lines.push(`${indent}${tag} \`\`\`${lang}`);
    for (const codeLine of text.split('\n')) {
      lines.push(`${indent}  ${codeLine}`);
    }
    lines.push(`${indent}  \`\`\``);
    return lines;
  }

  // Table: render as container with rows, cells show inline content
  if (node.type === 'table') {
    lines.push(`${indent}${tag}`);
    for (const row of node.content || []) {
      const rowTag = `[${compactType(row)}:${nodeId(row.attrs?.id)}]`;
      const cellTexts = (row.content || []).map((cell: any) => {
        const para = cell.content?.[0];
        return para ? inlineToCompact(para.content) : '';
      });
      lines.push(`${indent}  ${rowTag} | ${cellTexts.join(' | ')} |`);
    }
    return lines;
  }

  // Image: inline representation
  if (node.type === 'image') {
    const src = node.attrs?.src || '';
    const alt = node.attrs?.alt || '';
    lines.push(`${indent}${tag} ![${alt}](${src})`);
    return lines;
  }

  // Container nodes (lists, blockquotes, taskLists)
  if (['bulletList', 'orderedList', 'blockquote', 'taskList'].includes(node.type)) {
    lines.push(`${indent}${tag}`);
    for (const child of node.content || []) {
      lines.push(...nodeToCompactLines(child, indent + '  '));
    }
    return lines;
  }

  // Task items — checkbox prefix + first paragraph inline
  if (node.type === 'taskItem') {
    const checked = node.attrs?.checked ? '[x]' : '[ ]';
    const children = node.content || [];
    if (children.length > 0 && children[0].type === 'paragraph') {
      const text = inlineToCompact(children[0].content);
      lines.push(`${indent}${tag} ${checked} ${text}`);
      for (let i = 1; i < children.length; i++) {
        lines.push(...nodeToCompactLines(children[i], indent + '  '));
      }
    } else {
      lines.push(`${indent}${tag} ${checked}`);
      for (const child of children) {
        lines.push(...nodeToCompactLines(child, indent + '  '));
      }
    }
    return lines;
  }

  // List items — show first paragraph inline, nest rest
  if (node.type === 'listItem') {
    const children = node.content || [];
    if (children.length > 0 && children[0].type === 'paragraph') {
      const text = inlineToCompact(children[0].content);
      lines.push(`${indent}${tag} ${text}`);
      for (let i = 1; i < children.length; i++) {
        lines.push(...nodeToCompactLines(children[i], indent + '  '));
      }
    } else {
      lines.push(`${indent}${tag}`);
      for (const child of children) {
        lines.push(...nodeToCompactLines(child, indent + '  '));
      }
    }
    return lines;
  }

  // Leaf nodes (heading, paragraph) — inline content on same line
  const text = inlineToCompact(node.content);
  lines.push(`${indent}${tag} ${text}`);
  return lines;
}

export function toCompactFormat(
  doc: any,
  title: string,
  wordCount: number,
  pendingCount: number,
): string {
  const header = [
    `title: ${title}`,
    `words: ${wordCount.toLocaleString()}`,
    `pending: ${pendingCount}`,
    '---',
  ];

  const body: string[] = [];
  for (const node of doc.content || []) {
    body.push(...nodeToCompactLines(node, ''));
  }

  return [...header, ...body].join('\n');
}

/**
 * Convert an array of TipTap nodes to compact tagged-line format.
 * Used by get_nodes tool.
 */
export function compactNodes(nodes: any[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    lines.push(...nodeToCompactLines(node, ''));
  }
  return lines.join('\n');
}

// ============================================================================
// Markdown string -> TipTap JSONContent (for write_to_pad)
// ============================================================================

/**
 * Parse a markdown string into TipTap node(s).
 * Single paragraph -> single node. Multiple blocks -> array.
 * Used when agents send markdown strings as content in write_to_pad.
 */
export function parseMarkdownContent(content: string): any {
  const nodes = markdownToNodes(content);
  return nodes.length === 1 ? nodes[0] : nodes;
}
