/**
 * Google Doc → OpenWriter import.
 * Accepts raw Google Doc JSON, converts to markdown.
 * Single-section docs → one .md file.
 * Multi-section docs (multiple HEADING_1) → chapter files + book manifest.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR, ensureDataDir, sanitizeFilename } from './helpers.js';
import { createWorkspace, addDoc, addContainerToWorkspace } from './workspaces.js';

// ============================================================================
// TYPES
// ============================================================================

interface GDocTextRun {
  content?: string;
  textStyle?: {
    bold?: boolean;
    italic?: boolean;
    link?: { url?: string };
  };
}

interface GDocElement {
  textRun?: GDocTextRun;
}

interface GDocParagraph {
  paragraphStyle?: { namedStyleType?: string };
  elements?: GDocElement[];
  bullet?: { nestingLevel?: number };
}

interface GDocTableCell {
  content?: { paragraph?: GDocParagraph }[];
}

interface GDocTableRow {
  tableCells?: GDocTableCell[];
}

interface GDocStructuralElement {
  paragraph?: GDocParagraph;
  table?: { tableRows?: GDocTableRow[] };
}

interface GDocDocument {
  title?: string;
  body?: { content?: GDocStructuralElement[] };
}

interface SectionData {
  title: string;
  elements: GDocStructuralElement[];
}

export interface ImportResult {
  title: string;
  mode: 'single' | 'workspace';
  workspaceFilename?: string;
  files: { title: string; filename: string; wordCount: number }[];
}

// ============================================================================
// GOOGLE DOC → MARKDOWN CONVERSION
// ============================================================================

function textRunToMarkdown(element: GDocElement): string {
  if (!element.textRun) return '';
  const text = element.textRun.content;
  if (!text || text === '\n') return '';

  const style = element.textRun.textStyle || {};
  let result = text.replace(/\n$/, '');

  // Trim inner whitespace before wrapping — GDocs often has bold runs ending
  // with spaces like "Territory " which produces broken "**Territory **"
  if (style.bold && style.italic) {
    result = `***${result.trim()}***`;
  } else if (style.bold) {
    result = `**${result.trim()}**`;
  } else if (style.italic) {
    result = `*${result.trim()}*`;
  }

  if (style.link?.url) {
    result = `[${result}](${style.link.url})`;
  }

  return result;
}

function textRunToPlainText(element: GDocElement): string {
  if (!element.textRun) return '';
  const text = element.textRun.content;
  if (!text || text === '\n') return '';
  return text.replace(/\n$/, '');
}

function paragraphToMarkdown(para: GDocParagraph): string {
  const style = para.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
  const elements = para.elements || [];
  const isHeading = style?.startsWith('HEADING_');

  // Headings: strip bold/italic — GDocs scatters random bold across heading runs
  // which produces broken markdown like **Territory & Masculinity (v0.**2**.0)**
  let text = elements.map(isHeading ? textRunToPlainText : textRunToMarkdown).join('');
  if (!text.trim()) return '';

  if (style === 'HEADING_1') return `# ${text.trim()}`;
  if (style === 'HEADING_2') return `## ${text.trim()}`;
  if (style === 'HEADING_3') return `### ${text.trim()}`;
  if (style === 'HEADING_4') return `#### ${text.trim()}`;

  if (para.bullet) {
    const level = para.bullet.nestingLevel || 0;
    const indent = '  '.repeat(level);
    return `${indent}- ${text.trim()}`;
  }

  return text.trim();
}

function structuralElementToMarkdown(element: GDocStructuralElement): string {
  if (element.paragraph) {
    return paragraphToMarkdown(element.paragraph);
  }
  if (element.table) {
    const rows: string[] = [];
    for (const row of (element.table.tableRows || [])) {
      const cells: string[] = [];
      for (const cell of (row.tableCells || [])) {
        const cellText = (cell.content || [])
          .map((el: any) => el.paragraph ? paragraphToMarkdown(el.paragraph) : '')
          .filter(Boolean)
          .join(' ');
        cells.push(cellText);
      }
      rows.push('| ' + cells.join(' | ') + ' |');
    }
    if (rows.length > 1) {
      const headerSep = '| ' + rows[0].split('|').slice(1, -1).map(() => '---').join(' | ') + ' |';
      rows.splice(1, 0, headerSep);
    }
    return rows.join('\n');
  }
  return '';
}

// ============================================================================
// SECTION SPLITTING
// ============================================================================

function splitIntoSections(doc: GDocDocument): SectionData[] {
  const elements = doc.body?.content || [];
  const sections: SectionData[] = [];
  let current: SectionData | null = null;

  for (const element of elements) {
    if (!element.paragraph) {
      if (current) current.elements.push(element);
      continue;
    }

    const style = element.paragraph.paragraphStyle?.namedStyleType;
    if (style === 'HEADING_1') {
      const title = (element.paragraph.elements || [])
        .map((el: GDocElement) => el.textRun?.content || '')
        .join('')
        .trim();

      current = { title, elements: [element] };
      sections.push(current);
    } else {
      if (!current) {
        current = { title: 'Preamble', elements: [element] };
        sections.push(current);
      } else {
        current.elements.push(element);
      }
    }
  }

  return sections;
}

function sectionToMarkdown(section: SectionData): string {
  const lines: string[] = [];
  for (const element of section.elements) {
    const md = structuralElementToMarkdown(element);
    if (md) lines.push(md);
  }
  return lines.join('\n\n');
}

function elementsToMarkdown(elements: GDocStructuralElement[]): string {
  const lines: string[] = [];
  for (const element of elements) {
    const md = structuralElementToMarkdown(element);
    if (md) lines.push(md);
  }
  return lines.join('\n\n');
}

function writeDocFile(title: string, markdownBody: string): { filename: string; wordCount: number } {
  const filename = `${sanitizeFilename(title).substring(0, 200)}.md`;
  const filepath = join(DATA_DIR, filename);
  const metadata = { title };
  const content = `---\n${JSON.stringify(metadata)}\n---\n\n${markdownBody}`;
  writeFileSync(filepath, content, 'utf-8');
  const wordCount = markdownBody.trim() ? markdownBody.trim().split(/\s+/).length : 0;
  return { filename, wordCount };
}

// ============================================================================
// IMPORT
// ============================================================================

/**
 * Import a Google Doc JSON into OpenWriter.
 * - Single-section doc → one .md file
 * - Multi-section doc (2+ HEADING_1) → chapter files + book manifest
 */
export function importGoogleDoc(gdocJson: GDocDocument, title?: string): ImportResult {
  ensureDataDir();

  const docTitle = title || gdocJson.title || 'Imported Document';
  const sections = splitIntoSections(gdocJson);

  if (sections.length === 0) {
    throw new Error('No content found in Google Doc');
  }

  // Single section (or no H1 splits) → import as one document
  if (sections.length <= 1) {
    const allElements = gdocJson.body?.content || [];
    const markdown = elementsToMarkdown(allElements);
    const file = writeDocFile(docTitle, markdown);
    return {
      title: docTitle,
      mode: 'single',
      files: [{ title: docTitle, filename: file.filename, wordCount: file.wordCount }],
    };
  }

  // Multiple sections → split into chapter files + workspace with ordered container
  const fileResults: ImportResult['files'] = [];

  for (const section of sections) {
    const markdown = sectionToMarkdown(section);
    const file = writeDocFile(section.title, markdown);
    fileResults.push({ title: section.title, filename: file.filename, wordCount: file.wordCount });
  }

  const wsInfo = createWorkspace({ title: docTitle });
  const { containerId } = addContainerToWorkspace(wsInfo.filename, null, 'Chapters');
  for (const fileResult of fileResults) {
    addDoc(wsInfo.filename, containerId, fileResult.filename, fileResult.title);
  }

  return {
    title: docTitle,
    mode: 'workspace',
    workspaceFilename: wsInfo.filename,
    files: fileResults,
  };
}
