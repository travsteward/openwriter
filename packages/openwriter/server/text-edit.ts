/**
 * Text matching + content manipulation helpers for fine-grained agent edits.
 * Works on TipTap JSON node content arrays (text nodes with marks).
 */

export interface TextEdit {
  find: string;
  replace?: string;
  addMark?: { type: string; attrs?: Record<string, any> };
  removeMark?: string;
}

interface TextMatch {
  startIdx: number;
  startOffset: number;
  endIdx: number;
  endOffset: number;
}

interface InlineTextNode {
  type: 'text';
  text: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

/**
 * Find text within a flat array of TipTap text nodes.
 * Returns the indices and offsets of the matching text nodes.
 */
function findTextInContent(content: InlineTextNode[], searchText: string): TextMatch | null {
  // Build a flat text string from all text nodes
  let flatText = '';
  const offsets: Array<{ idx: number; start: number; end: number }> = [];

  for (let i = 0; i < content.length; i++) {
    const node = content[i];
    if (node.type !== 'text' || !node.text) continue;
    const start = flatText.length;
    flatText += node.text;
    offsets.push({ idx: i, start, end: flatText.length });
  }

  const matchStart = flatText.indexOf(searchText);
  if (matchStart === -1) return null;
  const matchEnd = matchStart + searchText.length;

  let startIdx = -1, startOffset = 0;
  let endIdx = -1, endOffset = 0;

  for (const o of offsets) {
    if (startIdx === -1 && matchStart >= o.start && matchStart < o.end) {
      startIdx = o.idx;
      startOffset = matchStart - o.start;
    }
    if (matchEnd > o.start && matchEnd <= o.end) {
      endIdx = o.idx;
      endOffset = matchEnd - o.start;
      break;
    }
  }

  if (startIdx === -1 || endIdx === -1) return null;
  return { startIdx, startOffset, endIdx, endOffset };
}

/**
 * Deep clone a node.
 */
function cloneNode(node: any): any {
  return JSON.parse(JSON.stringify(node));
}

/**
 * Split a text node at a character offset, returning [before, after].
 * Either may be null if the split is at the boundary.
 */
function splitTextNode(node: InlineTextNode, offset: number): [InlineTextNode | null, InlineTextNode | null] {
  if (offset <= 0) return [null, cloneNode(node)];
  if (offset >= node.text.length) return [cloneNode(node), null];

  const before: InlineTextNode = {
    type: 'text',
    text: node.text.slice(0, offset),
  };
  if (node.marks) before.marks = cloneNode(node.marks);

  const after: InlineTextNode = {
    type: 'text',
    text: node.text.slice(offset),
  };
  if (node.marks) after.marks = cloneNode(node.marks);

  return [before, after];
}

/**
 * Apply a single text edit to a node's content array.
 * Returns the modified content array and the character range of the edit
 * (for inline decoration tracking).
 */
function applySingleEdit(
  content: InlineTextNode[],
  edit: TextEdit,
): { content: InlineTextNode[]; from: number; to: number; type: string } | null {
  const match = findTextInContent(content, edit.find);
  if (!match) return null;

  const { startIdx, startOffset, endIdx, endOffset } = match;

  // Calculate character offsets for the edit range (for inline decorations)
  let charsBefore = 0;
  for (let i = 0; i < startIdx; i++) {
    if (content[i].type === 'text') charsBefore += content[i].text.length;
  }
  const editFrom = charsBefore + startOffset;

  // Build new content array with the edit applied
  const result: InlineTextNode[] = [];

  // Copy nodes before the match
  for (let i = 0; i < startIdx; i++) {
    result.push(cloneNode(content[i]));
  }

  // Handle the matched region
  if (startIdx === endIdx) {
    // Match is within a single text node
    const node = content[startIdx];
    const [beforePart] = splitTextNode(node, startOffset);
    const [, afterPart] = splitTextNode(node, endOffset);

    if (beforePart) result.push(beforePart);

    if (edit.replace !== undefined) {
      // Replace text
      const replaced: InlineTextNode = {
        type: 'text',
        text: edit.replace,
      };
      if (node.marks) replaced.marks = cloneNode(node.marks);
      if (edit.addMark) {
        replaced.marks = replaced.marks || [];
        replaced.marks.push(cloneNode(edit.addMark));
      }
      if (edit.removeMark) {
        replaced.marks = (replaced.marks || []).filter(
          (m: any) => m.type !== edit.removeMark,
        );
      }
      if (replaced.text) result.push(replaced);
    } else {
      // Keep text, modify marks
      const matched: InlineTextNode = {
        type: 'text',
        text: node.text.slice(startOffset, endOffset),
        marks: node.marks ? cloneNode(node.marks) : [],
      };
      if (edit.addMark) {
        matched.marks = matched.marks || [];
        matched.marks.push(cloneNode(edit.addMark));
      }
      if (edit.removeMark) {
        matched.marks = (matched.marks || []).filter(
          (m: any) => m.type !== edit.removeMark,
        );
      }
      result.push(matched);
    }

    if (afterPart) result.push(afterPart);
  } else {
    // Match spans multiple text nodes
    // Start node: text after startOffset
    const startNode = content[startIdx];
    const [beforeStart] = splitTextNode(startNode, startOffset);
    if (beforeStart) result.push(beforeStart);

    if (edit.replace !== undefined) {
      // Replace entire matched span with new text
      const replaced: InlineTextNode = {
        type: 'text',
        text: edit.replace,
      };
      if (startNode.marks) replaced.marks = cloneNode(startNode.marks);
      if (edit.addMark) {
        replaced.marks = replaced.marks || [];
        replaced.marks.push(cloneNode(edit.addMark));
      }
      if (edit.removeMark) {
        replaced.marks = (replaced.marks || []).filter(
          (m: any) => m.type !== edit.removeMark,
        );
      }
      if (replaced.text) result.push(replaced);
    } else {
      // Keep text, modify marks on each matched node
      const startText = startNode.text.slice(startOffset);
      if (startText) {
        const modified: InlineTextNode = {
          type: 'text',
          text: startText,
          marks: startNode.marks ? cloneNode(startNode.marks) : [],
        };
        if (edit.addMark) {
          modified.marks = modified.marks || [];
          modified.marks.push(cloneNode(edit.addMark));
        }
        if (edit.removeMark) {
          modified.marks = (modified.marks || []).filter(
            (m: any) => m.type !== edit.removeMark,
          );
        }
        result.push(modified);
      }

      // Middle nodes: fully inside match
      for (let i = startIdx + 1; i < endIdx; i++) {
        const midNode = cloneNode(content[i]);
        if (edit.addMark) {
          midNode.marks = midNode.marks || [];
          midNode.marks.push(cloneNode(edit.addMark));
        }
        if (edit.removeMark) {
          midNode.marks = (midNode.marks || []).filter(
            (m: any) => m.type !== edit.removeMark,
          );
        }
        result.push(midNode);
      }

      // End node: text before endOffset
      const endNode = content[endIdx];
      const endText = endNode.text.slice(0, endOffset);
      if (endText) {
        const modified: InlineTextNode = {
          type: 'text',
          text: endText,
          marks: endNode.marks ? cloneNode(endNode.marks) : [],
        };
        if (edit.addMark) {
          modified.marks = modified.marks || [];
          modified.marks.push(cloneNode(edit.addMark));
        }
        if (edit.removeMark) {
          modified.marks = (modified.marks || []).filter(
            (m: any) => m.type !== edit.removeMark,
          );
        }
        result.push(modified);
      }
    }

    // End node remainder
    const endNode = content[endIdx];
    const [, afterEnd] = splitTextNode(endNode, endOffset);
    if (afterEnd) result.push(afterEnd);
  }

  // Copy nodes after the match
  for (let i = endIdx + 1; i < content.length; i++) {
    result.push(cloneNode(content[i]));
  }

  // Calculate the edit end position in the new content
  const editTo = editFrom + (edit.replace !== undefined ? edit.replace.length : edit.find.length);
  const editType = edit.replace !== undefined ? 'rewrite' : (edit.addMark ? 'insert' : 'rewrite');

  return { content: result, from: editFrom, to: editTo, type: editType };
}

/**
 * Apply multiple text edits to a TipTap node (block-level node with inline content).
 * Returns the modified node and the array of inline edit ranges for decorations.
 */
export function applyTextEditsToNode(
  node: any,
  edits: TextEdit[],
): { node: any; textEdits: Array<{ from: number; to: number; type: string }> } | null {
  if (!node.content || !Array.isArray(node.content)) return null;

  let currentContent: InlineTextNode[] = node.content.filter(
    (n: any) => n.type === 'text',
  );
  const textEditRanges: Array<{ from: number; to: number; type: string }> = [];

  for (const edit of edits) {
    const result = applySingleEdit(currentContent, edit);
    if (!result) continue;
    currentContent = result.content;
    textEditRanges.push({ from: result.from, to: result.to, type: result.type });
  }

  if (textEditRanges.length === 0) return null;

  const modifiedNode = cloneNode(node);
  modifiedNode.content = currentContent;

  return { node: modifiedNode, textEdits: textEditRanges };
}
