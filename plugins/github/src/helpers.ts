/**
 * Local helpers for the github plugin — server-module bridge.
 * Mirrors the lazy-import pattern from plugins/publish/src/helpers.ts.
 */

export interface ServerModules {
  // helpers.js
  getDataDir: () => string;
  readConfig: () => any;
  saveConfig: (patch: Record<string, any>) => void;
  // state.js
  save: () => void;
  cancelDebouncedSave: () => void;
  getDocument: () => any;
  getTitle: () => string;
  getMetadata: () => Record<string, any>;
  getDocId: () => string;
  setMetadata: (updates: Record<string, any>) => void;
  bumpDocVersion: () => number;
  // ws.js
  broadcastSyncStatus: (status: any) => void;
  // After any tool mutates + persists doc metadata it must broadcast so every
  // connected client converges without a reload — the same convention the core
  // MCP tools follow (mcp.ts calls broadcastMetadataChanged right after
  // setMetadata). Plugins can't reach ws.js on their own, so the bridge exposes
  // these. adr: adr/plugin-metadata-broadcast.md
  broadcastMetadataChanged: (metadata: Record<string, any>) => void;
  broadcastDocumentsChanged: () => void;
  // Fire a transient toast in every connected browser. Used by post_to_blog to
  // surface a schema-gate rejection to whoever clicked Publish.
  broadcastToast: (message: string, kind?: 'info' | 'error', durationMs?: number) => void;
  // markdown.js
  tiptapToMarkdown: (doc: any, title: string, metadata?: Record<string, any>) => string;
  // blog-schema-gate.js — validate built frontmatter against the target site's
  // live Astro content schema before commit/push. adr: adr/blog-publish-schema-gate.md
  validateBlogFrontmatter: (opts: { repoRoot: string; contentDir: string; frontmatter: string }) => Promise<BlogFrontmatterValidation>;
}

/** Result of the pre-commit schema gate. Mirrors server/blog-schema-gate.ts. */
export interface BlogFrontmatterValidation {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  configPath?: string;
  collection?: string;
  issues?: Array<{ field: string; code: string; message: string }>;
  summary?: string;
}

// npm package:  dist/plugins/github/dist/helpers.js → ../../../server/
// Monorepo dev: plugins/github/dist/helpers.js     → ../../../packages/openwriter/dist/server/
const npmBase = new URL('../../../server/', import.meta.url).href;
const monoBase = new URL('../../../packages/openwriter/dist/server/', import.meta.url).href;

let _cached: ServerModules | null = null;

async function tryImport(base: string) {
  const [helpers, state, ws, markdown, schemaGate] = await Promise.all([
    import(base + 'helpers.js'),
    import(base + 'state.js'),
    import(base + 'ws.js'),
    import(base + 'markdown.js'),
    import(base + 'blog-schema-gate.js'),
  ]);
  return { helpers, state, ws, markdown, schemaGate };
}

export async function getServerModules(): Promise<ServerModules> {
  if (_cached) return _cached;
  let helpers, state, ws, markdown, schemaGate;
  try {
    ({ helpers, state, ws, markdown, schemaGate } = await tryImport(npmBase));
  } catch {
    ({ helpers, state, ws, markdown, schemaGate } = await tryImport(monoBase));
  }
  _cached = {
    getDataDir: helpers.getDataDir,
    readConfig: helpers.readConfig,
    saveConfig: helpers.saveConfig,
    save: state.save,
    cancelDebouncedSave: state.cancelDebouncedSave,
    getDocument: state.getDocument,
    getTitle: state.getTitle,
    getMetadata: state.getMetadata,
    getDocId: state.getDocId,
    setMetadata: state.setMetadata,
    bumpDocVersion: state.bumpDocVersion,
    broadcastSyncStatus: ws.broadcastSyncStatus,
    broadcastMetadataChanged: ws.broadcastMetadataChanged,
    broadcastDocumentsChanged: ws.broadcastDocumentsChanged,
    broadcastToast: ws.broadcastToast,
    tiptapToMarkdown: markdown.tiptapToMarkdown,
    validateBlogFrontmatter: schemaGate.validateBlogFrontmatter,
  };
  return _cached;
}

// Plugin API types
export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  env?: string;
  description?: string;
}

export interface PluginRouteContext {
  app: import('express').Router;
  config: Record<string, string>;
  dataDir: string;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface OpenWriterPlugin {
  name: string;
  version: string;
  description?: string;
  category?: 'writing' | 'social-media' | 'image-generation' | 'publishing' | 'productivity' | 'analytics';
  configSchema?: Record<string, PluginConfigField>;
  registerRoutes?(ctx: PluginRouteContext): void | Promise<void>;
  mcpTools?(config: Record<string, string>): PluginMcpTool[];
}

// ---- Blog site persistence ----

export interface BlogSite {
  id: string;
  label: string;
  owner: string;
  repo: string;
  branch: string;
  content_dir: string;
  image_dir: string;
  image_public_prefix: string;
  framework: 'astro' | 'next' | 'jekyll' | 'hugo' | 'unknown';
  /** Constant frontmatter fields applied to every post (e.g. layout, author, prerender). */
  frontmatter_defaults?: Record<string, any>;
  /**
   * Map openwriter blogContext key → site frontmatter key.
   * e.g. { date: "publishedDate" } for sites that use a non-standard date field.
   */
  frontmatter_field_map?: Record<string, string>;
  /**
   * Schema of frontmatter fields the site's posts use (from inspection).
   * Surfaced in the panel so users can see what the site expects.
   * Not used as a filter — only the defaults + blogContext determine output.
   */
  frontmatter_schema?: string[];
  /**
   * Public base URL of the site (e.g. "https://example.com"). Used by
   * post_to_blog to construct the live URL stamped on `blogContext.lastPublish.publishedUrl`
   * so the file-tree right-click menu can surface "View Post" after a publish.
   * inspect_blog_repo proposes this from `CNAME` / `public/CNAME` when present.
   */
  site_url?: string;
  /**
   * URL path pattern for a blog post, with `{slug}` as the placeholder plus
   * optional `{year}` / `{month}` / `{day}` (2-digit) from the post date.
   * Default: `/blog/{slug}/`. Used together with `site_url` to build the live URL.
   */
  blog_url_pattern?: string;
  /**
   * How image paths are written into frontmatter + body:
   *   "relative" — no leading slash (`images/og/x.png`); the site's template
   *                prepends the slash (e.g. Astro `<img src={`/${image}`}>`).
   *   "absolute" — leading slash (`/images/og/x.png`); value used verbatim.
   * Inferred by inspect_blog_repo from existing posts' image values. Absent ⇒
   * "absolute" — the legacy behavior the plugin always had before this field.
   * adr: adr/blog-image-contract.md
   */
  image_path_style?: 'relative' | 'absolute';
  /**
   * Filename template the published COVER image is copied under. Placeholders:
   *   `{slug}` — the post slug
   *   `{ext}`  — the source file's extension, no dot (preserved from the
   *              `/_images/` original)
   * Default `og-{slug}.{ext}`. Deterministic: same doc + same slug ⇒ same
   * cover filename on every republish (idempotent overwrite, no orphaned
   * cover files). Inferred by inspect_blog_repo from existing posts.
   * adr: adr/blog-image-contract.md
   */
  image_naming?: string;
}

const PLUGIN_NAME = '@openwriter/plugin-github';

export async function listBlogSites(): Promise<BlogSite[]> {
  const srv = await getServerModules();
  const cfg = srv.readConfig() || {};
  const slot = cfg.plugins?.[PLUGIN_NAME];
  return (slot?.blogSites as BlogSite[]) || [];
}

// adr: adr/plugin-slot-nested-data.md
export async function writeBlogSites(sites: BlogSite[]): Promise<void> {
  const srv = await getServerModules();
  const cfg = srv.readConfig() || {};
  const plugins = { ...(cfg.plugins || {}) };
  const slot = { ...(plugins[PLUGIN_NAME] || { enabled: true, config: {} }) };
  slot.blogSites = sites;
  plugins[PLUGIN_NAME] = slot;
  srv.saveConfig({ plugins });
}
