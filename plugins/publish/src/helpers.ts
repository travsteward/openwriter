import MarkdownIt from 'markdown-it';
import markdownItIns from 'markdown-it-ins';
import markdownItMark from 'markdown-it-mark';
import markdownItSub from 'markdown-it-sub';
import markdownItSup from 'markdown-it-sup';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

// Lazy-load server modules at runtime
// npm package: dist/plugins/publish/dist/helpers.js → ../../../server/
// Monorepo:    plugins/publish/dist/helpers.js → ../../../packages/openwriter/dist/server/
const npmBase = new URL('../../../server/', import.meta.url).href;
const monoBase = new URL('../../../packages/openwriter/dist/server/', import.meta.url).href;

export interface ServerModules {
  tiptapToMarkdown: (doc: any, title: string, metadata?: Record<string, any>) => string;
  getDocument: () => any;
  getTitle: () => string;
  getMetadata: () => Record<string, any>;
  getActiveProfile: () => string;
  getDataDir: () => string;
  getDocId: () => string;
  setMetadata: (updates: Record<string, any>) => void;
  save: () => void;
  broadcastMetadataChanged: (metadata: Record<string, any>) => void;
  platformFetch: (path: string, options?: RequestInit) => Promise<Response>;
}

let _cached: ServerModules | null = null;

async function tryImport(base: string) {
  const [markdown, state, helpers, connections, ws] = await Promise.all([
    import(base + 'markdown.js'),
    import(base + 'state.js'),
    import(base + 'helpers.js'),
    import(base + 'connections.js'),
    import(base + 'ws.js'),
  ]);
  return { markdown, state, helpers, connections, ws };
}

export async function getServerModules(): Promise<ServerModules> {
  if (_cached) return _cached;
  // Try npm package layout first, fall back to monorepo layout
  let markdown, state, helpers, connections, ws;
  try {
    ({ markdown, state, helpers, connections, ws } = await tryImport(npmBase));
  } catch {
    ({ markdown, state, helpers, connections, ws } = await tryImport(monoBase));
  }
  _cached = {
    tiptapToMarkdown: markdown.tiptapToMarkdown,
    getDocument: state.getDocument,
    getTitle: state.getTitle,
    getMetadata: state.getMetadata,
    getActiveProfile: helpers.getActiveProfile,
    getDataDir: helpers.getDataDir,
    getDocId: state.getDocId,
    setMetadata: state.setMetadata,
    save: state.save,
    broadcastMetadataChanged: ws.broadcastMetadataChanged,
    platformFetch: connections.platformFetch,
  };
  return _cached;
}

// Types
export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  env?: string;
  description?: string;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface PluginRouteContext {
  app: import('express').Router;
  config: Record<string, string>;
  dataDir: string;
}

export interface PluginSidebarMenuItem {
  label: string;
  action: string;
  promptForFocus?: boolean;
}

export interface OpenWriterPlugin {
  name: string;
  version: string;
  description?: string;
  category?: 'writing' | 'social-media' | 'image-generation' | 'publishing' | 'productivity' | 'analytics';
  configSchema?: Record<string, PluginConfigField>;
  registerRoutes?(ctx: PluginRouteContext): void | Promise<void>;
  mcpTools?(config: Record<string, string>): PluginMcpTool[];
  sidebarMenuItems?(): PluginSidebarMenuItem[];
}

// markdown-it instance matching export-routes.ts configuration
export const md = new MarkdownIt({ linkify: false, html: true });
md.enable('strikethrough');
md.use(markdownItIns);
md.use(markdownItMark);
md.use(markdownItSub);
md.use(markdownItSup);

/** Strip YAML frontmatter and TipTap empty markers from markdown output */
export function stripFrontmatter(markdown: string): string {
  let result = markdown;
  const fmMatch = result.match(/^---\n[\s\S]*?\n---\n\n/);
  if (fmMatch) result = result.slice(fmMatch[0].length);
  result = result.replace(/^\s*<!--\s*-->\s*$/gm, '');
  return result.trim();
}

/** Scan HTML for /_images/ references, read local files, return base64 array for R2 upload. dataDir defaults to the server's. */
export async function extractLocalImages(
  html: string,
  dataDir?: string,
): Promise<Array<{ path: string; data: string; content_type: string }>> {
  dataDir ??= (await getServerModules()).getDataDir();
  const images: Array<{ path: string; data: string; content_type: string }> = [];

  const regex = /\/_images\/[^\s"'<>]+/g;
  const seen = new Set<string>();
  let match;

  while ((match = regex.exec(html)) !== null) {
    const imgPath = match[0];
    if (seen.has(imgPath)) continue;
    seen.add(imgPath);

    const localFile = join(dataDir, imgPath);
    if (!existsSync(localFile)) continue;

    const data = readFileSync(localFile).toString('base64');
    const ext = extname(imgPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.gif': 'image/gif',
      '.webp': 'image/webp', '.svg': 'image/svg+xml',
    };

    images.push({ path: imgPath, data, content_type: mimeMap[ext] || 'image/png' });
  }

  return images;
}

/** Convert current document's TipTap JSON to body HTML + plain text */
export async function documentToEmail(): Promise<{ html: string; text: string; subject: string; json: any }> {
  const server = await getServerModules();
  const doc = server.getDocument();
  const title = server.getTitle();
  const metadata = server.getMetadata();

  const raw = server.tiptapToMarkdown(doc, title, metadata);
  const clean = stripFrontmatter(raw).trim();

  const html = md.render(clean);
  const text = markdownToPlainText(clean);

  return { html, text, subject: title, json: doc };
}

/** Strip markdown syntax to produce clean plain text for email */
export function markdownToPlainText(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCodeBlock) {
        for (const cl of codeLines) out.push('    ' + cl);
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (/^\s*<!--.*-->\s*$/.test(line)) continue;
    if (/^!\[.*\]\(.*\)\s*$/.test(line)) continue;
    if (/^\|[\s:|-]+\|\s*$/.test(line)) continue;

    if (/^\|(.+)\|\s*$/.test(line)) {
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => stripInline(c.trim()));
      out.push(cells.join(' | '));
      continue;
    }

    if (/^[-*_]{3,}\s*$/.test(line)) {
      out.push('---');
      continue;
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      out.push(stripInline(headerMatch[2]));
      continue;
    }

    const bqMatch = line.match(/^(>\s?)+(.*)$/);
    if (bqMatch) {
      out.push(stripInline(bqMatch[2]));
      continue;
    }

    const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      const indent = taskMatch[1];
      const check = taskMatch[2] === ' ' ? '[ ]' : '[x]';
      out.push(indent + check + ' ' + stripInline(taskMatch[3]));
      continue;
    }

    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (ulMatch) {
      out.push(ulMatch[1] + '- ' + stripInline(ulMatch[2]));
      continue;
    }

    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      out.push(olMatch[1] + olMatch[2] + '. ' + stripInline(olMatch[3]));
      continue;
    }

    out.push(stripInline(line));
  }

  if (inCodeBlock) {
    for (const cl of codeLines) out.push('    ' + cl);
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strip inline markdown marks from a string */
export function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*{3}|_{3})(.+?)\1/g, '$2')
    .replace(/(\*{2}|_{2})(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\+\+(.+?)\+\+/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/~([^~]+)~/g, '$1')
    .replace(/\^([^^]+)\^/g, '$1');
}

/** Make an authenticated request to the Publish API via platform proxy */
export async function publishFetch(
  _config: Record<string, string>,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const server = await getServerModules();
  return server.platformFetch(path, options);
}
