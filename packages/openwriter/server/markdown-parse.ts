/**
 * Markdown -> TipTap JSON parsing.
 * Parses markdown (with optional YAML frontmatter) into TipTap document JSON.
 */

import MarkdownIt from 'markdown-it';
import matter from 'gray-matter';
import type Token from 'markdown-it/lib/token.mjs';
import markdownItIns from 'markdown-it-ins';
import markdownItMark from 'markdown-it-mark';
import markdownItSub from 'markdown-it-sub';
import markdownItSup from 'markdown-it-sup';
import { generateNodeId, LEAF_BLOCK_TYPES } from './helpers.js';
import { nodeText } from './markdown-serialize.js';

// ============================================================================
// Markdown -> TipTap
// ============================================================================

const md = new MarkdownIt({ linkify: false, html: true });
md.enable('strikethrough');
md.use(markdownItIns);
md.use(markdownItMark);
md.use(markdownItSub);
md.use(markdownItSup);

export interface ParsedMarkdown {
  title: string;
  metadata: Record<string, any>;
  document: { type: 'doc'; content: any[] };
}

export function markdownToTiptap(markdown: string): ParsedMarkdown {
  const { data, content } = matter(markdown);
  const title = (data.title as string) || 'Untitled';

  const tokens = md.parse(content, {});
  const docContent = tokensToTiptap(tokens);

  const doc = {
    type: 'doc' as const,
    content: docContent.length > 0 ? docContent : [{ type: 'paragraph', attrs: { id: generateNodeId() }, content: [] }],
  };

  // Rehydrate pending state from frontmatter into node attrs
  if (data.pending) {
    rehydratePendingState(doc, data.pending);
  }

  // Strip pending from returned metadata (consumed into node attrs)
  const metadata = { ...data };
  delete metadata.pending;

  return { title, metadata, document: doc };
}

/**
 * Rehydrate pending state from frontmatter into leaf block node attrs.
 * Uses text fingerprint matching to survive position shifts caused by
 * empty paragraphs disappearing during markdown round-trips.
 */
function rehydratePendingState(doc: { content: any[] }, pending: Record<string, any>): void {
  // Build ordered list of leaf blocks with text fingerprints
  const leaves: { node: any; text: string }[] = [];
  function collect(nodes: any[]): void {
    if (!nodes) return;
    for (const node of nodes) {
      if (LEAF_BLOCK_TYPES.has(node.type)) {
        leaves.push({ node, text: nodeText(node) });
      } else if (node.content) {
        collect(node.content);
      }
    }
  }
  collect(doc.content);

  const used = new Set<number>();

  for (const [posStr, entry] of Object.entries(pending)) {
    const pos = parseInt(posStr, 10);
    let target: any = null;

    // 1. Try position match (with text verification if fingerprint exists)
    if (pos < leaves.length && !used.has(pos)) {
      if (!entry.t || leaves[pos].text === entry.t) {
        target = leaves[pos].node;
        used.add(pos);
      }
    }

    // 2. Fallback: search by text fingerprint
    if (!target && entry.t) {
      for (let i = 0; i < leaves.length; i++) {
        if (!used.has(i) && leaves[i].text === entry.t) {
          target = leaves[i].node;
          used.add(i);
          break;
        }
      }
    }

    if (target) {
      target.attrs = target.attrs || {};
      target.attrs.pendingStatus = entry.s;
      if (entry.o) {
        target.attrs.pendingOriginalContent = entry.o;
      }
    }
  }
}

/** Parse a markdown string into TipTap block nodes (no frontmatter). */
export function markdownToNodes(markdown: string): any[] {
  const tokens = md.parse(markdown, {});
  const nodes = tokensToTiptap(tokens);
  return nodes.length > 0 ? nodes : [{ type: 'paragraph', attrs: { id: generateNodeId() }, content: [] }];
}

// ---- Token tree walker ----

function tokensToTiptap(tokens: Token[]): any[] {
  const nodes: any[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === 'heading_open') {
      const level = parseInt(token.tag.slice(1));
      const inlineToken = tokens[i + 1];
      const content = inlineToken?.children ? inlineTokensToTiptap(inlineToken.children) : [];
      nodes.push({ type: 'heading', attrs: { id: generateNodeId(), level }, content });
      i += 3;
    } else if (token.type === 'paragraph_open') {
      const inlineToken = tokens[i + 1];
      const content = inlineToken?.children ? inlineTokensToTiptap(inlineToken.children) : [];
      // Check for solo image — promote to block-level image node
      if (content.length === 1 && content[0].type === 'image') {
        nodes.push(content[0]);
      } else {
        nodes.push({ type: 'paragraph', attrs: { id: generateNodeId() }, content });
      }
      i += 3;
    } else if (token.type === 'bullet_list_open') {
      const end = findClosingToken(tokens, i, 'bullet_list');
      const items = parseListItems(tokens.slice(i + 1, end));
      const listNode = { type: 'bulletList', attrs: { id: generateNodeId() }, content: items };
      // Try converting to taskList if all items start with checkboxes
      const taskNode = tryConvertToTaskList(listNode);
      nodes.push(taskNode || listNode);
      i = end + 1;
    } else if (token.type === 'ordered_list_open') {
      const end = findClosingToken(tokens, i, 'ordered_list');
      const items = parseListItems(tokens.slice(i + 1, end));
      nodes.push({ type: 'orderedList', attrs: { id: generateNodeId() }, content: items });
      i = end + 1;
    } else if (token.type === 'blockquote_open') {
      const end = findClosingToken(tokens, i, 'blockquote');
      const inner = tokensToTiptap(tokens.slice(i + 1, end));
      nodes.push({ type: 'blockquote', attrs: { id: generateNodeId() }, content: inner });
      i = end + 1;
    } else if (token.type === 'fence') {
      const lang = token.info?.trim() || '';
      const text = token.content.replace(/\n$/, '');
      const content = text ? [{ type: 'text', text }] : [];
      const attrs: any = { id: generateNodeId() };
      if (lang) attrs.language = lang;
      nodes.push({ type: 'codeBlock', attrs, content });
      i += 1;
    } else if (token.type === 'hr') {
      nodes.push({ type: 'horizontalRule', attrs: { id: generateNodeId() } });
      i += 1;
    } else if (token.type === 'html_block') {
      // <!-- --> is our sentinel for empty paragraphs
      if (token.content.trim() === '<!-- -->') {
        nodes.push({ type: 'paragraph', attrs: { id: generateNodeId() }, content: [] });
      }
      i += 1;
    } else if (token.type === 'table_open') {
      const end = findClosingToken(tokens, i, 'table');
      const tableNode = parseTableTokens(tokens.slice(i + 1, end));
      nodes.push(tableNode);
      i = end + 1;
    } else {
      i += 1;
    }
  }

  return nodes;
}

function findClosingToken(tokens: Token[], startIndex: number, type: string): number {
  let depth = 0;
  for (let i = startIndex; i < tokens.length; i++) {
    if (tokens[i].type === `${type}_open`) depth++;
    if (tokens[i].type === `${type}_close`) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

function parseListItems(tokens: Token[]): any[] {
  const items: any[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (tokens[i].type === 'list_item_open') {
      const end = findClosingToken(tokens, i, 'list_item');
      const inner = tokensToTiptap(tokens.slice(i + 1, end));
      items.push({ type: 'listItem', attrs: { id: generateNodeId() }, content: inner });
      i = end + 1;
    } else {
      i++;
    }
  }

  return items;
}

/**
 * Post-process a bulletList: if every listItem starts with [ ] or [x],
 * convert to taskList/taskItem nodes and strip the checkbox prefix.
 */
function tryConvertToTaskList(bulletList: any): any | null {
  const items = bulletList.content;
  if (!items || items.length === 0) return null;

  const checkboxRe = /^\[([ xX])\]\s?/;
  const taskItems: any[] = [];

  for (const item of items) {
    const firstChild = item.content?.[0];
    if (!firstChild || firstChild.type !== 'paragraph') return null;
    const firstText = firstChild.content?.[0];
    if (!firstText || firstText.type !== 'text') return null;

    const match = checkboxRe.exec(firstText.text);
    if (!match) return null;

    const checked = match[1] !== ' ';
    // Strip checkbox prefix from text
    const remaining = firstText.text.slice(match[0].length);
    const newContent = [...firstChild.content];
    if (remaining) {
      newContent[0] = { ...firstText, text: remaining };
    } else {
      newContent.shift();
    }
    const newParagraph = { ...firstChild, content: newContent };
    const restChildren = item.content.slice(1);

    taskItems.push({
      type: 'taskItem',
      attrs: { id: generateNodeId(), checked },
      content: [newParagraph, ...restChildren],
    });
  }

  return {
    type: 'taskList',
    attrs: { id: generateNodeId() },
    content: taskItems,
  };
}

function parseTableTokens(tokens: Token[]): any {
  const rows: any[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === 'thead_open' || token.type === 'tbody_open') {
      i++; // skip section open, process rows inside
      continue;
    }
    if (token.type === 'thead_close' || token.type === 'tbody_close') {
      i++;
      continue;
    }

    if (token.type === 'tr_open') {
      const trEnd = findClosingToken(tokens, i, 'tr');
      const cells: any[] = [];
      let j = i + 1;

      while (j < trEnd) {
        const cellToken = tokens[j];
        if (cellToken.type === 'th_open' || cellToken.type === 'td_open') {
          const cellType = cellToken.type === 'th_open' ? 'tableHeader' : 'tableCell';
          const cellEnd = findClosingToken(tokens, j, cellToken.type === 'th_open' ? 'th' : 'td');
          // Inline content is between open and close
          let content: any[] = [];
          if (j + 1 < cellEnd && tokens[j + 1].type === 'inline') {
            content = tokens[j + 1].children ? inlineTokensToTiptap(tokens[j + 1].children!) : [];
          }
          cells.push({
            type: cellType,
            attrs: { id: generateNodeId() },
            content: [{
              type: 'paragraph',
              attrs: { id: generateNodeId() },
              content,
            }],
          });
          j = cellEnd + 1;
        } else {
          j++;
        }
      }

      rows.push({
        type: 'tableRow',
        attrs: { id: generateNodeId() },
        content: cells,
      });
      i = trEnd + 1;
    } else {
      i++;
    }
  }

  return {
    type: 'table',
    attrs: { id: generateNodeId() },
    content: rows,
  };
}

function inlineTokensToTiptap(tokens: Token[]): any[] {
  const nodes: any[] = [];
  const markStack: any[] = [];

  for (const token of tokens) {
    if (token.type === 'text') {
      if (!token.content) continue; // ProseMirror rejects empty text nodes
      const textNode: any = { type: 'text', text: token.content };
      if (markStack.length > 0) {
        textNode.marks = deduplicateMarks(markStack);
      }
      nodes.push(textNode);
    } else if (token.type === 'code_inline') {
      if (!token.content) continue;
      const marks = deduplicateMarks([...markStack, { type: 'code' }]);
      nodes.push({ type: 'text', text: token.content, marks });
    } else if (token.type === 'strong_open') {
      markStack.push({ type: 'bold' });
    } else if (token.type === 'strong_close') {
      popMarkByType(markStack, 'bold');
    } else if (token.type === 'em_open') {
      markStack.push({ type: 'italic' });
    } else if (token.type === 'em_close') {
      popMarkByType(markStack, 'italic');
    } else if (token.type === 's_open') {
      markStack.push({ type: 'strike' });
    } else if (token.type === 's_close') {
      popMarkByType(markStack, 'strike');
    } else if (token.type === 'ins_open') {
      markStack.push({ type: 'underline' });
    } else if (token.type === 'ins_close') {
      popMarkByType(markStack, 'underline');
    } else if (token.type === 'mark_open') {
      markStack.push({ type: 'highlight' });
    } else if (token.type === 'mark_close') {
      popMarkByType(markStack, 'highlight');
    } else if (token.type === 'sub_open') {
      markStack.push({ type: 'subscript' });
    } else if (token.type === 'sub_close') {
      popMarkByType(markStack, 'subscript');
    } else if (token.type === 'sup_open') {
      markStack.push({ type: 'superscript' });
    } else if (token.type === 'sup_close') {
      popMarkByType(markStack, 'superscript');
    } else if (token.type === 'link_open') {
      const rawHref = token.attrGet('href') || '';
      const href = decodeURI(rawHref);
      markStack.push({ type: 'link', attrs: { href } });
    } else if (token.type === 'link_close') {
      popMarkByType(markStack, 'link');
    } else if (token.type === 'image') {
      const src = token.attrGet('src') || '';
      const alt = token.content || token.attrGet('alt') || '';
      nodes.push({
        type: 'image',
        attrs: { id: generateNodeId(), src, alt },
      });
    } else if (token.type === 'html_inline') {
      // <br> is our serialized form of hardBreak
      if (/^<br\s*\/?>$/i.test(token.content.trim())) {
        nodes.push({ type: 'hardBreak' });
      }
    } else if (token.type === 'hardbreak') {
      nodes.push({ type: 'hardBreak' });
    } else if (token.type === 'softbreak') {
      nodes.push({ type: 'text', text: ' ' });
    }
  }

  return nodes;
}

/** Remove duplicate mark types (e.g. nested **bold** producing two bold marks). */
function deduplicateMarks(marks: any[]): any[] {
  const seen = new Set<string>();
  return marks.filter((m) => {
    const key = m.type === 'link' ? `link:${m.attrs?.href}` : m.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function popMarkByType(stack: any[], type: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].type === type) {
      stack.splice(i, 1);
      return;
    }
  }
}
