/**
 * Blog publishing MCP tools — local git ops, no Worker, no PAT.
 *
 * Auth: piggybacks on the user's existing `gh auth login`.
 * Persistence: blogSites in plugins['@openwriter/plugin-github'].blogSites.
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join, extname, dirname, basename } from 'path';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import {
  getServerModules,
  listBlogSites,
  writeBlogSites,
  type BlogSite,
  type PluginMcpTool,
} from './helpers.js';

const NETWORK_TIMEOUT = 60000;

// SECURITY (MCP-1): no shell. `git`/`gh` are spawned directly via execFile
// with an argv array, so every element — including attacker-influenced blog
// config values (owner/repo/branch) and slugs — is passed to the program as a
// single literal argument and is NEVER interpreted by a shell. Do NOT add
// `shell: true` or hand-roll arg quoting here: that reintroduces OS command
// injection. If a future call genuinely needs shell features, whitelist-
// validate the inputs instead.
function exec(cmd: string, args: string[], cwd: string, timeout = NETWORK_TIMEOUT): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function ghAuthOk(cwd: string): Promise<boolean> {
  try { await exec('gh', ['auth', 'status'], cwd); return true; } catch { return false; }
}

/**
 * Last-resort site-URL detection via the GitHub Pages API. `inferSiteUrl`
 * only reads files committed to the repo (CNAME, wrangler route); this
 * catches GitHub Pages sites whose served URL — custom domain or the
 * `<owner>.github.io/<repo>` default — lives in Pages settings, not a file.
 * Returns the canonical served base URL (trailing slash stripped), or
 * undefined when Pages is not enabled / not accessible. Credential-free
 * (rides the existing `gh auth`); other hosts (Cloudflare Pages, Vercel,
 * Netlify) configure the domain in their dashboard and can't be derived
 * here — those rely on the user supplying site_url.
 */
async function inferSiteUrlFromGitHubPages(owner: string, repo: string, cwd: string): Promise<string | undefined> {
  try {
    const out = await exec('gh', ['api', `repos/${owner}/${repo}/pages`, '--jq', '.html_url'], cwd);
    const url = out.split('\n')[0].trim();
    if (/^https?:\/\//i.test(url)) return url.replace(/\/+$/, '');
  } catch { /* Pages not enabled, or no access — fall through */ }
  return undefined;
}

// Shared hint surfaced when site_url couldn't be determined, so the agent
// knows to ask the user rather than silently shipping posts with no live link.
const SITE_URL_HINT =
  'Could not auto-detect the public site URL (no CNAME, wrangler route, or GitHub Pages config — ' +
  'common for Cloudflare Pages / Vercel / Netlify sites whose domain lives in the host dashboard). ' +
  'Ask the user for the public base URL (e.g. https://example.com) and set it via site_url. ' +
  'Without it, published posts get no clickable "View Post" link (only the commit/file).';

function slugify(s: string): string {
  return s.toLowerCase().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function owRoot(): string {
  return join(homedir(), '.openwriter');
}

// ---- inspect_blog_repo helpers ----

function walkDir(root: string, max = 5000): string[] {
  const out: string[] = [];
  const queue = [root];
  while (queue.length && out.length < max) {
    const dir = queue.shift()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (name === '.git' || name === 'node_modules') continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) queue.push(full);
      else out.push(full);
    }
  }
  return out;
}

function dirOfMostMarkdown(files: string[], cloneRoot: string): { dir: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (extname(f).toLowerCase() !== '.md' && extname(f).toLowerCase() !== '.mdx') continue;
    const rel = f.slice(cloneRoot.length + 1).replace(/\\/g, '/');
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    // Skip README.md at root, etc.
    if (!dir) continue;
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  let best: { dir: string; count: number } | null = null;
  for (const [dir, count] of counts) {
    if (!best || count > best.count) best = { dir, count };
  }
  return best;
}

/**
 * Parse one frontmatter block into key→raw-string-value pairs.
 * Top-level only — array-on-next-line and nested objects are returned as
 * "<multiline>" sentinel so they're treated as varying.
 */
function parseYamlFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    const trimmed = rest.trim();
    if (trimmed === '' || trimmed === '|' || trimmed === '>') {
      // Multi-line scalar / list-on-next-line — mark as variable
      out[key] = '<multiline>';
      continue;
    }
    out[key] = trimmed;
  }
  return out;
}

/**
 * Detect frontmatter that was clearly written by an older version of the
 * openwriter github plugin (and therefore leaks openwriter-internal fields).
 * Those files would otherwise pollute the constant-detection across samples,
 * so the inspector excludes them.
 *
 * Fingerprint markers (any one is sufficient):
 *   - `enrichmentStale` field present (openwriter-only)
 *   - `status: draft` + `slug` + `date:` with ISO-with-time (old plugin's emit)
 *   - top-level `tags` set to a single openwriter content-type token
 *     (e.g. `tags: [blog]`)
 */
function looksLikeOpenwriterLeak(fm: Record<string, string>): boolean {
  if ('enrichmentStale' in fm) return true;
  if (fm.status === 'draft' && 'slug' in fm && fm.date && /T\d{2}:\d{2}/.test(fm.date)) {
    return true;
  }
  const t = fm.tags;
  if (t && /^\[\s*["']?(blog|tweet|article|linkedin|newsletter)["']?\s*\]$/i.test(t.trim())) {
    return true;
  }
  return false;
}

/**
 * Inspect multiple sample post frontmatters and propose:
 *  - `frontmatter_defaults`: fields with the SAME value across all posts
 *  - `frontmatter_field_map`: rename map from openwriter standard names
 *    to whatever the site actually uses (e.g. `date` → `publishedDate`)
 *  - `frontmatter_schema`: union of all keys seen
 *
 * Files that look like openwriter-leak frontmatter (the OLD plugin's
 * output) are excluded from analysis so they don't poison the constants.
 *
 * The detection is conservative — only fields present in ≥2 samples with
 * an identical value become defaults. Single-sample fields are skipped
 * to avoid baking per-post variations in.
 */
function inferFrontmatterShape(rawSamples: Record<string, string>[]): {
  defaults: Record<string, any>;
  field_map: Record<string, string>;
  schema: string[];
} {
  // Filter out openwriter-leak files so they don't pollute defaults detection
  const samples = rawSamples.filter((s) => !looksLikeOpenwriterLeak(s));
  if (samples.length === 0) return { defaults: {}, field_map: {}, schema: [] };

  // Schema = union of all keys (preserve insertion order from first sample)
  const schemaOrder: string[] = [];
  const seen = new Set<string>();
  for (const s of samples) {
    for (const k of Object.keys(s)) {
      if (!seen.has(k)) { seen.add(k); schemaOrder.push(k); }
    }
  }

  // Defaults: key present in ALL samples with identical, non-empty,
  // non-multiline value
  const defaults: Record<string, any> = {};
  for (const k of schemaOrder) {
    const values = samples.map((s) => s[k]);
    if (values.some((v) => v === undefined)) continue;
    if (values.some((v) => v === '<multiline>')) continue;
    const first = values[0];
    if (!first) continue;
    if (!values.every((v) => v === first)) continue;
    // Skip per-post fields that are NEVER constants in practice
    if (['title', 'description', 'slug', 'date', 'publishedDate', 'pubDate', 'coverImage', 'coverImageAlt', 'tags', 'category', 'categories'].includes(k)) continue;
    // Unquote double-quoted strings
    const unq = first.match(/^"(.*)"$/);
    let parsed: any = unq ? unq[1] : first;
    if (parsed === 'true') parsed = true;
    else if (parsed === 'false') parsed = false;
    else if (/^-?\d+$/.test(parsed)) parsed = Number(parsed);
    defaults[k] = parsed;
  }

  // Field map: detect which date field the site uses
  const field_map: Record<string, string> = {};
  if (seen.has('publishedDate') && !seen.has('date')) {
    field_map.date = 'publishedDate';
  } else if (seen.has('pubDate') && !seen.has('date')) {
    field_map.date = 'pubDate';
  }

  return { defaults, field_map, schema: schemaOrder };
}

// ---- Image-contract inference (inspect_blog_repo) ----
// adr: adr/blog-image-contract.md

const IMAGE_FIELD_CANDIDATES = [
  'image', 'coverImage', 'cover', 'ogImage', 'heroImage', 'featuredImage', 'thumbnail', 'banner',
];
const IMAGE_VALUE_RE = /\.(png|jpe?g|webp|gif|avif|svg)\b/i;

function unquoteScalar(s: string): string {
  const m = s.match(/^["'](.*)["']$/);
  return m ? m[1] : s;
}

/**
 * Pick the frontmatter key that holds the post's cover image. Prefers the
 * conventional names in order; the value must look like a local image path
 * (carries an image extension). Falls back to any field whose value does.
 */
function pickImageField(fm: Record<string, string>): { key: string; value: string } | null {
  for (const k of IMAGE_FIELD_CANDIDATES) {
    const raw = fm[k];
    if (!raw || raw === '<multiline>') continue;
    const v = unquoteScalar(raw);
    if (IMAGE_VALUE_RE.test(v)) return { key: k, value: v };
  }
  for (const [k, raw] of Object.entries(fm)) {
    if (raw === '<multiline>') continue;
    const v = unquoteScalar(raw);
    if (IMAGE_VALUE_RE.test(v)) return { key: k, value: v };
  }
  return null;
}

/**
 * Derive the per-site image contract from sampled posts:
 *  - `image_field`        — which frontmatter key holds the cover
 *  - `image_path_style`   — do values carry a leading slash?
 *  - `image_public_prefix`— the dominant directory the images live under
 *                           (relative, no leading slash)
 *  - `image_naming`       — `og-{slug}` vs `{slug}` filename convention
 *                           (detected by the dominant basename shape)
 * Conservative: only the dominant local-path field is analyzed; full URLs
 * are ignored. Anything not confidently detected is left undefined so
 * post_to_blog falls back to its documented defaults.
 */
export function inferImageConventions(
  samples: Array<{ fm: Record<string, string>; slug: string }>,
): {
  image_field?: string;
  image_path_style?: 'relative' | 'absolute';
  image_public_prefix?: string;
  image_naming?: string;
} {
  const hits: Array<{ key: string; value: string; slug: string }> = [];
  for (const s of samples) {
    const pick = pickImageField(s.fm);
    if (pick) hits.push({ ...pick, slug: s.slug });
  }
  if (hits.length === 0) return {};

  // Dominant cover field name
  const fieldCounts = new Map<string, number>();
  for (const h of hits) fieldCounts.set(h.key, (fieldCounts.get(h.key) || 0) + 1);
  const image_field = [...fieldCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Only local paths of the dominant field tell us about the path contract
  const local = hits.filter(
    (h) => h.key === image_field && !/^https?:\/\//i.test(h.value) && !h.value.startsWith('//'),
  );
  if (local.length === 0) return { image_field };

  // Path style: majority leading-slash ⇒ absolute
  const abs = local.filter((h) => h.value.startsWith('/')).length;
  const image_path_style: 'relative' | 'absolute' = abs > local.length / 2 ? 'absolute' : 'relative';

  // Public prefix: dominant directory portion (no leading/trailing slash)
  const dirCounts = new Map<string, number>();
  for (const h of local) {
    const noSlash = h.value.replace(/^\/+/, '');
    const dir = noSlash.includes('/') ? noSlash.slice(0, noSlash.lastIndexOf('/')) : '';
    dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
  }
  const topDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const image_public_prefix = topDir || undefined;

  // Naming convention by dominant basename shape + extension
  let ogCount = 0;
  let slugCount = 0;
  const extCounts = new Map<string, number>();
  for (const h of local) {
    const base = h.value.replace(/^.*\//, '');
    const ext = (base.match(/\.([a-z0-9]+)$/i)?.[1] || 'png').toLowerCase();
    extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
    const stem = base.replace(/\.[a-z0-9]+$/i, '');
    if (stem === h.slug) slugCount++;
    else if (stem.startsWith('og-')) ogCount++;
  }
  const dominantExt = [...extCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let image_naming: string | undefined;
  if (slugCount > local.length / 2) image_naming = `{slug}.${dominantExt}`;
  else if (ogCount > local.length / 2) image_naming = `og-{slug}.${dominantExt}`;
  // else: undefined ⇒ post_to_blog default (og-{slug}.{ext})

  return { image_field, image_path_style, image_public_prefix, image_naming };
}

/**
 * Map an inferred (relative) public image prefix to the on-disk image_dir
 * for the framework's static-asset root.
 */
function imageDirForFramework(fw: BlogSite['framework'], prefix: string): string {
  switch (fw) {
    case 'astro':
    case 'next':
      return `public/${prefix}`;
    case 'hugo':
      return `static/${prefix}`;
    case 'jekyll':
      return prefix; // served from repo root
    default:
      return `public/${prefix}`;
  }
}

/**
 * Detect the site's public URL from common static-host conventions:
 *  - `CNAME` at repo root or `public/CNAME` (GitHub Pages / Cloudflare Pages / Netlify)
 *  - `wrangler.toml` `routes` (Cloudflare Workers)
 *  - `netlify.toml` `[[redirects]]` to= field with a full URL
 *  - GitHub Pages default `<owner>.github.io/<repo>/` is NOT proposed — too often wrong
 *    when a custom domain is in play; user can fill in if they want it.
 */
function inferSiteUrl(cloneRoot: string): string | undefined {
  const tryRead = (rel: string): string | undefined => {
    const p = join(cloneRoot, rel);
    if (!existsSync(p)) return undefined;
    try { return readFileSync(p, 'utf-8').trim(); } catch { return undefined; }
  };

  // CNAME files (single line with domain, no scheme)
  for (const rel of ['CNAME', 'public/CNAME', 'static/CNAME', 'src/CNAME']) {
    const v = tryRead(rel);
    if (v) {
      const host = v.split('\n')[0].trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return `https://${host}`;
    }
  }

  // wrangler.toml — look for `routes = ["https://..."]` or `route = "..."`
  const wrangler = tryRead('wrangler.toml');
  if (wrangler) {
    const m = wrangler.match(/route[s]?\s*=\s*\[?\s*["']https?:\/\/([^"'/*]+)/);
    if (m) return `https://${m[1].replace(/\/$/, '')}`;
  }

  return undefined;
}

function inferFramework(cloneRoot: string, files: string[]): BlogSite['framework'] {
  const has = (rel: string) => existsSync(join(cloneRoot, rel));
  if (
    has('astro.config.mjs') || has('astro.config.ts') || has('astro.config.js') ||
    files.some(f => /astro\.config\.(mjs|ts|js)$/.test(f))
  ) return 'astro';
  if (has('next.config.js') || has('next.config.mjs') || has('next.config.ts')) return 'next';
  if (has('_config.yml')) return 'jekyll';
  if (has('hugo.toml') || has('config.toml') || has('hugo.yaml') || has('config.yaml')) return 'hugo';
  return 'unknown';
}

function defaultDirsForFramework(fw: BlogSite['framework'], detectedContentDir: string): {
  content_dir: string;
  image_dir: string;
  image_public_prefix: string;
} {
  switch (fw) {
    case 'astro':
      return {
        content_dir: detectedContentDir || 'src/content/blog',
        image_dir: 'public/blog-images',
        image_public_prefix: '/blog-images',
      };
    case 'next':
      return {
        content_dir: detectedContentDir || 'posts',
        image_dir: 'public/blog-images',
        image_public_prefix: '/blog-images',
      };
    case 'jekyll':
      return {
        content_dir: '_posts',
        image_dir: 'assets/images',
        image_public_prefix: '/assets/images',
      };
    case 'hugo':
      return {
        content_dir: detectedContentDir || 'content/posts',
        image_dir: 'static/images',
        image_public_prefix: '/images',
      };
    default:
      return {
        content_dir: detectedContentDir || 'posts',
        image_dir: 'public/images',
        image_public_prefix: '/images',
      };
  }
}

// ---- post_to_blog helpers ----

/**
 * Strict double-quoted YAML emission for scalars — matches the style of
 * a typical Astro blog's existing posts. Arrays are inline-square-bracket JSON for
 * compactness. Booleans + numbers emit bare.
 */
function yamlValue(v: any): string {
  if (v == null) return '""';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return '[' + v.map((x) => yamlValue(x)).join(', ') + ']';
  if (typeof v === 'object') return JSON.stringify(v);
  return JSON.stringify(String(v));
}

/**
 * Format a date for frontmatter. If the value already matches YYYY-MM-DD,
 * pass through; if it's an ISO string with time, slice to date only;
 * otherwise return as-is.
 */
function formatDate(v: any): string {
  if (typeof v !== 'string') return String(v ?? '');
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : v;
}

// ---- Per-site image contract (path style + cover naming) ----
// adr: adr/blog-image-contract.md
//
// The image reference is a PER-SITE CONTRACT, not a global assumption. Two
// dimensions, both stored on BlogSite and inferred by inspect_blog_repo:
//   1. path style — does the value carry a leading slash, or does the site's
//      template prepend one? (`image_path_style`)
//   2. cover filename — deterministic `og-{slug}.{ext}`, never the raw
//      `/_images/` name, so republish is idempotent and never orphans.
//        (`image_naming`)
// Absent keys ⇒ legacy behavior ("absolute", raw name) so already-correct
// sites never regress.

/** Site's effective path style. Absent ⇒ legacy "absolute". */
export function pathStyleOf(site: Pick<BlogSite, 'image_path_style'>): 'relative' | 'absolute' {
  return site.image_path_style === 'relative' ? 'relative' : 'absolute';
}

/**
 * Public reference for one image file under the site's prefix, honoring the
 * site's path style. The prefix is normalized (leading + trailing slashes
 * stripped) so storage is style-agnostic — `style` alone decides the leading
 * slash, which makes the contract unambiguous regardless of how the prefix
 * was saved (`/images/og` vs `images/og` both behave identically).
 *   relative → "images/og/x.png"   absolute → "/images/og/x.png"
 */
export function imageRef(publicPrefix: string, file: string, style: 'relative' | 'absolute'): string {
  const seg = (publicPrefix || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const rel = seg ? `${seg}/${file}` : file;
  return style === 'absolute' ? `/${rel}` : rel;
}

/**
 * Rewrite inline `/_images/` references in the post BODY to their published
 * public paths, collecting the referenced filenames for copying.
 *
 * Body references ALWAYS emit an absolute (leading-slash) path, regardless of
 * the site's `image_path_style`. That style contract exists for the
 * FRONTMATTER cover only, whose value is rendered through the site's template
 * — a relative-style site's layout prepends the slash itself (e.g. Astro
 * `<img src={`/${image}`}>`). A raw markdown body image has no template: a
 * slashless path is treated by Astro/Vite as an ESM import (`Rollup failed to
 * resolve import "images/og/x.png"`) and red-builds the site, while a
 * root-absolute path resolves against the public dir on every static
 * framework. Do NOT collapse body refs back into the cover's path style.
 * adr: adr/blog-image-contract.md
 */
export function rewriteBodyImages(bodyMd: string, publicPrefix: string): { body: string; imageRefs: Set<string> } {
  const imageRefs = new Set<string>();
  const body = bodyMd.replace(/\/_images\/([^\s)"'<>]+)/g, (_m, fn) => {
    imageRefs.add(fn);
    return imageRef(publicPrefix, fn, 'absolute');
  });
  return { body, imageRefs };
}

/**
 * Resolve the deterministic cover filename from the site's naming template.
 *   `{slug}` → post slug
 *   `{ext}`  → source extension, no dot (preserved from the original)
 * A template carrying a literal extension and no `{ext}` placeholder
 * (e.g. `og-{slug}.png`) is respected as authored. Absent template ⇒
 * `og-{slug}.{ext}`.
 */
export function coverFilename(template: string | undefined, slug: string, sourceExt: string): string {
  const ext = sourceExt.replace(/^\.+/, '');
  return (template || 'og-{slug}.{ext}')
    .replace(/\{slug\}/g, slug)
    .replace(/\{ext\}/g, ext);
}

/**
 * Resolve the live post path from the site's `blog_url_pattern`.
 *   `{slug}`  → post slug
 *   `{year}`  → 4-digit year of the post date
 *   `{month}` → 2-digit month
 *   `{day}`   → 2-digit day
 * The date is the one the frontmatter emits: blogContext.date's YYYY-MM-DD
 * part (no Date parsing, so no timezone shift), else today — the same
 * fallback buildFrontmatter uses. Absent pattern ⇒ `/blog/{slug}/`.
 */
export function blogPostPath(pattern: string | undefined, slug: string, date: unknown): string {
  const ymd = formatDate(date).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    || new Date().toISOString().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  const path = (pattern || '/blog/{slug}/')
    .replace(/\{slug\}/g, slug)
    .replace(/\{year\}/g, ymd[1])
    .replace(/\{month\}/g, ymd[2])
    .replace(/\{day\}/g, ymd[3]);
  return path.startsWith('/') ? path : '/' + path;
}

/**
 * Build the YAML frontmatter from blogContext + site defaults.
 *
 * Order of precedence (low → high):
 *   1. Site `frontmatter_defaults` (e.g. `layout`, `author`, `prerender`)
 *   2. Generated `title` (from document title — always present)
 *   3. blogContext fields (description, date, author, tags, slug, draft, coverImage)
 *
 * Field-name mapping: blogContext keys are renamed via `site.frontmatter_field_map`
 * before emit (e.g. `date` → `publishedDate` for Astro sites).
 *
 * Top-level openwriter metadata (status, enrichmentStale, tags-as-content-type,
 * etc.) is NEVER passed through. Frontmatter is built ONLY from blogContext +
 * defaults — this is the design contract from server/blog-routes.ts.
 */
export function buildFrontmatter(
  title: string,
  blogCtx: Record<string, any>,
  site: BlogSite,
  coverImagePath?: string,
): string {
  const fm: Record<string, any> = {};
  const map = site.frontmatter_field_map || {};

  // 1. Site defaults (lowest priority — overridable below)
  if (site.frontmatter_defaults) {
    for (const [k, v] of Object.entries(site.frontmatter_defaults)) {
      fm[k] = v;
    }
  }

  // 2. Title (always)
  fm.title = title;

  // 3. blogContext fields — apply field_map rename, skip empty values
  const passthrough: Array<{ src: string; format?: (v: any) => any }> = [
    { src: 'description' },
    { src: 'date', format: formatDate },
    { src: 'author' },
    { src: 'tags' },
    { src: 'category' },
    { src: 'slug' },
    { src: 'draft' },
    { src: 'subtitle' },
    { src: 'excerpt' },
    { src: 'coverImageAlt' },
  ];
  for (const { src, format } of passthrough) {
    const v = blogCtx[src];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    const dest = map[src] || src;
    fm[dest] = format ? format(v) : v;
  }

  // 4. Cover image: rewritten path takes priority over blogContext.coverImage
  if (coverImagePath) {
    const dest = map.coverImage || 'coverImage';
    fm[dest] = coverImagePath;
  }

  // Ensure date field exists if site expects one — derive from today
  const dateDest = map.date || 'date';
  const publishedDateDest = map.publishedDate || (map.date === 'publishedDate' ? 'publishedDate' : null);
  if (!fm[dateDest] && !(publishedDateDest && fm[publishedDateDest])) {
    fm[dateDest] = new Date().toISOString().slice(0, 10);
  }

  // Date fields emit as UNQUOTED yaml scalars (pubDate: 2026-05-31), never
  // quoted strings. Astro's z.date() rejects a quoted value — js-yaml parses it
  // as a String, not a Date — which froze a live Netlify build (a production Astro blog,
  // 2026-06-01). The unquoted form is ALSO accepted by z.coerce.date() and by
  // Jekyll/Hugo/Next (gray-matter), so it is the universally-correct emit.
  // adr: adr/blog-image-contract.md
  const dateKeys = new Set<string>([dateDest]);
  if (publishedDateDest) dateKeys.add(publishedDateDest);
  const emitLine = (k: string, v: any): string =>
    dateKeys.has(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? `${k}: ${v}`
      : `${k}: ${yamlValue(v)}`;

  // Emit in stable order: defaults first (in their declared order),
  // then title, then any new keys we added
  const lines: string[] = [];
  const written = new Set<string>();
  if (site.frontmatter_defaults) {
    for (const k of Object.keys(site.frontmatter_defaults)) {
      if (k in fm) {
        lines.push(emitLine(k, fm[k]));
        written.add(k);
      }
    }
  }
  if (!written.has('title')) {
    lines.push(`title: ${yamlValue(fm.title)}`);
    written.add('title');
  }
  for (const [k, v] of Object.entries(fm)) {
    if (written.has(k)) continue;
    lines.push(emitLine(k, v));
    written.add(k);
  }

  return `---\n${lines.join('\n')}\n---\n\n`;
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n+/, '').replace(/^\s*<!--\s*-->\s*$/gm, '').trim();
}

// ---- Tools ----

export function blogTools(): PluginMcpTool[] {
  return [
    {
      name: 'inspect_blog_repo',
      description: 'Clone a GitHub blog repo (shallow) to a local cache and infer its framework, content directory, image directory, and frontmatter schema. Read-only — produces a config preview you can feed to add_blog_site.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_url: { type: 'string', description: 'GitHub repo URL or owner/repo shorthand (e.g. "https://github.com/user/blog" or "user/blog")' },
        },
        required: ['repo_url'],
      },
      handler: async (params) => {
        const repoUrl = String(params.repo_url || '').trim();
        if (!repoUrl) return { error: 'repo_url is required' };

        // Normalize to owner/repo
        let ownerRepo = repoUrl
          .replace(/^https?:\/\/github\.com\//, '')
          .replace(/\.git$/, '')
          .replace(/^github:/, '');
        const parts = ownerRepo.split('/').filter(Boolean);
        if (parts.length < 2) return { error: 'Could not parse owner/repo from repo_url' };
        const owner = parts[0];
        const repo = parts[1];

        const cacheRoot = join(owRoot(), '_blog-inspect-cache');
        mkdirSync(cacheRoot, { recursive: true });
        const cloneDir = join(cacheRoot, `${owner}-${repo}`);

        if (!(await ghAuthOk(cacheRoot))) {
          return { error: 'gh CLI not authenticated. Run `gh auth login` first.' };
        }

        // Refresh: remove existing then clone shallow
        if (existsSync(cloneDir)) {
          try { rmSync(cloneDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        try {
          await exec('gh', ['repo', 'clone', `${owner}/${repo}`, cloneDir, '--', '--depth', '1'], cacheRoot);
        } catch (err: any) {
          return { error: `Clone failed: ${err.message}` };
        }

        const files = walkDir(cloneDir);
        const framework = inferFramework(cloneDir, files);
        const mdBest = dirOfMostMarkdown(files, cloneDir);
        const detected = mdBest?.dir || '';
        const defaults = defaultDirsForFramework(framework, detected);

        // Collect multiple sample post frontmatters so we can detect constants.
        // Up to 10 samples to avoid pathological loops on huge repos.
        const sampleFiles = files
          .filter((f) => {
            const rel = f.slice(cloneDir.length + 1).replace(/\\/g, '/');
            return (detected ? rel.startsWith(detected + '/') : true) && /\.(md|mdx)$/i.test(rel);
          })
          .slice(0, 10);
        const sampleData: Array<{ fm: Record<string, string>; slug: string }> = [];
        for (const f of sampleFiles) {
          try {
            const fm = parseYamlFrontmatter(readFileSync(f, 'utf-8'));
            const slug = basename(f).replace(/\.(md|mdx)$/i, '');
            sampleData.push({ fm, slug });
          } catch { /* skip */ }
        }
        const rawSamples = sampleData.map((s) => s.fm);
        const samplesAfterFilter = rawSamples.filter((s) => !looksLikeOpenwriterLeak(s));
        const samplesSkipped = rawSamples.length - samplesAfterFilter.length;
        const shape = inferFrontmatterShape(rawSamples);

        // Per-site image contract — inferred from real posts (path style, the
        // directory images live under, og-{slug} vs {slug} naming, and which
        // frontmatter field holds the cover). Leak samples excluded so the
        // old plugin's emit doesn't poison detection. adr: adr/blog-image-contract.md
        const conv = inferImageConventions(
          sampleData.filter((s) => !looksLikeOpenwriterLeak(s.fm)),
        );
        const imagePublicPrefix = conv.image_public_prefix ?? defaults.image_public_prefix;
        const imageDir = conv.image_public_prefix
          ? imageDirForFramework(framework, conv.image_public_prefix)
          : defaults.image_dir;
        const imagePathStyle = conv.image_path_style ?? 'absolute';
        const imageNaming = conv.image_naming ?? 'og-{slug}.{ext}';
        // Cover field-name mapping (e.g. site uses `image:` not `coverImage:`)
        const fieldMap = { ...shape.field_map };
        if (conv.image_field && conv.image_field !== 'coverImage') {
          fieldMap.coverImage = conv.image_field;
        }

        const confidence: 'high' | 'medium' | 'low' =
          framework !== 'unknown' && detected ? 'high'
          : detected ? 'medium'
          : 'low';

        // site_url: prefer files committed to the repo (CNAME / wrangler route),
        // then fall back to the GitHub Pages API for GH-hosted sites whose served
        // URL lives in Pages settings rather than a committed file.
        const siteUrl = inferSiteUrl(cloneDir) || await inferSiteUrlFromGitHubPages(owner, repo, cacheRoot);

        return {
          owner,
          repo,
          framework,
          content_dir: defaults.content_dir,
          image_dir: imageDir,
          image_public_prefix: imagePublicPrefix,
          image_path_style: imagePathStyle,
          image_naming: imageNaming,
          frontmatter_schema: shape.schema,
          frontmatter_defaults: shape.defaults,
          frontmatter_field_map: fieldMap,
          // Always propose a pattern even when site_url is unknown so the user can fill in the URL
          site_url: siteUrl,
          blog_url_pattern: '/blog/{slug}/',
          // When site_url couldn't be derived, tell the agent to ask the user —
          // otherwise it ships posts with no live "View Post" link, silently.
          ...(siteUrl ? {} : { needs_site_url: true, site_url_hint: SITE_URL_HINT }),
          samples_analyzed: samplesAfterFilter.length,
          samples_skipped_openwriter_leak: samplesSkipped,
          markdown_files_found: mdBest?.count ?? 0,
          confidence,
        };
      },
    },

    {
      name: 'add_blog_site',
      description: 'Register a GitHub blog repo as a publishing target. Use inspect_blog_repo first to discover sensible defaults — including the frontmatter_defaults and frontmatter_field_map it proposes, which match what the site\'s existing posts use.',
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'User-facing name (e.g. "Personal blog")' },
          owner: { type: 'string', description: 'GitHub owner/user/org' },
          repo: { type: 'string', description: 'Repo name' },
          branch: { type: 'string', description: 'Branch to push to (default: main)' },
          content_dir: { type: 'string', description: 'Directory where post .md files live (e.g. "src/content/blog")' },
          image_dir: { type: 'string', description: 'Directory where image files write (e.g. "public/blog-images")' },
          image_public_prefix: { type: 'string', description: 'Directory prefix images live under (e.g. "images/og" or "/blog-images"). The leading slash is governed by image_path_style, not by how this is stored.' },
          image_path_style: { type: 'string', enum: ['relative', 'absolute'], description: 'How image paths are written: "relative" = no leading slash (`images/og/x.png`; the template prepends one), "absolute" = leading slash (`/images/og/x.png`; used verbatim). inspect_blog_repo infers this from existing posts. Default: "absolute" (legacy).' },
          image_naming: { type: 'string', description: 'Cover filename template with `{slug}` + `{ext}` placeholders. Default "og-{slug}.{ext}". Deterministic: same doc+slug ⇒ same filename every republish (no orphaned covers).' },
          framework: { type: 'string', enum: ['astro', 'next', 'jekyll', 'hugo', 'unknown'], description: 'Site framework' },
          frontmatter_defaults: {
            type: 'object',
            description: 'Constants applied to every post\'s frontmatter (e.g. `{ "layout": "../../layouts/BlogPost.astro", "author": "...", "prerender": true }`). Detected by inspect_blog_repo as fields with constant values across existing posts.',
          },
          frontmatter_field_map: {
            type: 'object',
            description: 'Rename map: openwriter blogContext key → site frontmatter key (e.g. `{ "date": "publishedDate" }` for Astro-style sites that use `publishedDate`).',
          },
          frontmatter_schema: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of frontmatter keys the site uses (from inspection). Stored for reference / future UI.',
          },
          site_url: {
            type: 'string',
            description: 'Public base URL of the site (e.g. "https://example.com"). Used to construct the live "View Post" URL surfaced after publish. inspect_blog_repo proposes this from CNAME / wrangler.toml / the GitHub Pages API when found; for Cloudflare Pages / Vercel / Netlify (domain configured in the host dashboard) it can\'t be auto-detected — ask the user and pass it here. If omitted, the response returns needs_site_url so you know to follow up; backfill later with edit_blog_site.',
          },
          blog_url_pattern: {
            type: 'string',
            description: 'URL path pattern for a blog post with `{slug}` placeholder, plus optional `{year}`, `{month}`, `{day}` (2-digit) from the post date (e.g. "/blog/{slug}/" or "/blog/{year}/{month}/{slug}/"). Default: "/blog/{slug}/". Combined with site_url to build the live URL stored on the doc after publish.',
          },
        },
        required: ['label', 'owner', 'repo', 'content_dir', 'image_dir', 'image_public_prefix', 'framework'],
      },
      handler: async (params) => {
        const site: BlogSite = {
          id: randomUUID(),
          label: String(params.label),
          owner: String(params.owner),
          repo: String(params.repo),
          branch: String(params.branch || 'main'),
          content_dir: String(params.content_dir),
          image_dir: String(params.image_dir),
          image_public_prefix: String(params.image_public_prefix),
          framework: (params.framework as BlogSite['framework']) || 'unknown',
        };
        if (params.frontmatter_defaults && typeof params.frontmatter_defaults === 'object') {
          site.frontmatter_defaults = params.frontmatter_defaults as Record<string, any>;
        }
        if (params.frontmatter_field_map && typeof params.frontmatter_field_map === 'object') {
          site.frontmatter_field_map = params.frontmatter_field_map as Record<string, string>;
        }
        if (params.image_path_style === 'relative' || params.image_path_style === 'absolute') {
          site.image_path_style = params.image_path_style;
        }
        if (typeof params.image_naming === 'string' && params.image_naming.trim()) {
          site.image_naming = params.image_naming.trim();
        }
        if (Array.isArray(params.frontmatter_schema)) {
          site.frontmatter_schema = (params.frontmatter_schema as any[]).map(String);
        }
        if (typeof params.site_url === 'string' && params.site_url.trim()) {
          site.site_url = params.site_url.trim().replace(/\/+$/, '');
        }
        if (typeof params.blog_url_pattern === 'string' && params.blog_url_pattern.trim()) {
          site.blog_url_pattern = params.blog_url_pattern.trim();
        }
        const sites = await listBlogSites();
        sites.push(site);
        await writeBlogSites(sites);
        return {
          success: true,
          site,
          // No site_url ⇒ no live link on publish. Tell the agent to follow up.
          ...(site.site_url ? {} : { needs_site_url: true, site_url_hint: SITE_URL_HINT }),
        };
      },
    },

    {
      name: 'list_blog_sites',
      description: 'List all registered GitHub blog sites.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const sites = await listBlogSites();
        return { sites };
      },
    },

    {
      name: 'remove_blog_site',
      description: 'Remove a registered blog site by id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Blog site id (from list_blog_sites)' },
        },
        required: ['id'],
      },
      handler: async (params) => {
        const id = String(params.id);
        const sites = await listBlogSites();
        const next = sites.filter(s => s.id !== id);
        if (next.length === sites.length) return { error: `No blog site with id ${id}` };
        await writeBlogSites(next);
        return { success: true, removed: id };
      },
    },

    {
      name: 'edit_blog_site',
      description: 'Update fields on an already-registered blog site by id. Only the fields you pass change; everything else is left intact. The common use is backfilling site_url / blog_url_pattern after registration so published posts get a live "View Post" link (e.g. for Cloudflare Pages / Vercel / Netlify sites where the domain couldn\'t be auto-detected).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Blog site id (from list_blog_sites)' },
          label: { type: 'string', description: 'User-facing name' },
          branch: { type: 'string', description: 'Branch to push to' },
          content_dir: { type: 'string', description: 'Directory where post .md files live' },
          image_dir: { type: 'string', description: 'Directory where image files write' },
          image_public_prefix: { type: 'string', description: 'Directory prefix images live under' },
          image_path_style: { type: 'string', enum: ['relative', 'absolute'], description: 'How image paths are written' },
          image_naming: { type: 'string', description: 'Cover filename template with `{slug}` + `{ext}`' },
          framework: { type: 'string', enum: ['astro', 'next', 'jekyll', 'hugo', 'unknown'], description: 'Site framework' },
          frontmatter_defaults: { type: 'object', description: 'Constants applied to every post\'s frontmatter' },
          frontmatter_field_map: { type: 'object', description: 'Rename map: openwriter blogContext key → site frontmatter key' },
          frontmatter_schema: { type: 'array', items: { type: 'string' }, description: 'List of frontmatter keys the site uses' },
          site_url: { type: 'string', description: 'Public base URL (e.g. "https://example.com"). Pass an empty string to clear it.' },
          blog_url_pattern: { type: 'string', description: 'URL path pattern with `{slug}` placeholder, plus optional `{year}`, `{month}`, `{day}` (2-digit) from the post date (e.g. "/blog/{year}/{month}/{slug}/").' },
        },
        required: ['id'],
      },
      handler: async (params) => {
        const id = String(params.id);
        const sites = await listBlogSites();
        const site = sites.find(s => s.id === id);
        if (!site) return { error: `No blog site with id ${id}` };

        // Plain string fields — set when a non-empty string is provided.
        for (const key of ['label', 'branch', 'content_dir', 'image_dir', 'image_public_prefix', 'image_naming', 'blog_url_pattern'] as const) {
          if (typeof params[key] === 'string' && (params[key] as string).trim()) {
            (site as any)[key] = (params[key] as string).trim();
          }
        }
        // site_url: trim + strip trailing slash; empty string clears it.
        if (typeof params.site_url === 'string') {
          const v = params.site_url.trim().replace(/\/+$/, '');
          if (v) site.site_url = v; else delete site.site_url;
        }
        if (params.image_path_style === 'relative' || params.image_path_style === 'absolute') {
          site.image_path_style = params.image_path_style;
        }
        if (params.framework && ['astro', 'next', 'jekyll', 'hugo', 'unknown'].includes(String(params.framework))) {
          site.framework = params.framework as BlogSite['framework'];
        }
        if (params.frontmatter_defaults && typeof params.frontmatter_defaults === 'object') {
          site.frontmatter_defaults = params.frontmatter_defaults as Record<string, any>;
        }
        if (params.frontmatter_field_map && typeof params.frontmatter_field_map === 'object') {
          site.frontmatter_field_map = params.frontmatter_field_map as Record<string, string>;
        }
        if (Array.isArray(params.frontmatter_schema)) {
          site.frontmatter_schema = (params.frontmatter_schema as any[]).map(String);
        }
        await writeBlogSites(sites);
        return { success: true, site };
      },
    },

    {
      name: 'post_to_blog',
      description: 'Publish the active OpenWriter document to a registered GitHub blog site via local git ops (clone-or-pull, write file + images, commit, push). Auth uses your existing `gh auth login`.',
      inputSchema: {
        type: 'object',
        properties: {
          site_id: { type: 'string', description: 'Blog site id (from list_blog_sites)' },
          slug: { type: 'string', description: 'Filename slug (without .md). Default: slugified document title.' },
          commit_message: { type: 'string', description: 'Git commit message. Default: "blog: {title}".' },
        },
        required: ['site_id'],
      },
      handler: async (params) => {
        const siteId = String(params.site_id);
        const sites = await listBlogSites();
        const site = sites.find(s => s.id === siteId);
        if (!site) return { error: `No blog site with id ${siteId}` };

        const srv = await getServerModules();

        // Flush any pending writes so we read fresh state
        try { srv.cancelDebouncedSave(); srv.save(); } catch { /* ignore */ }

        const doc = srv.getDocument();
        const title = srv.getTitle();
        const metadata = srv.getMetadata() || {};
        if (!doc || !doc.content) return { error: 'No active document. Switch to a document first.' };
        if (!title) return { error: 'Document has no title. Set a title before publishing.' };

        const contentType =
          metadata.content_type ||
          (metadata.tweetContext ? 'tweet'
            : metadata.articleContext ? 'article'
            : metadata.linkedinContext ? 'linkedin'
            : metadata.newsletterContext ? 'newsletter'
            : metadata.blogContext ? 'blog'
            : undefined);
        if (contentType !== 'blog') {
          return {
            error: `Active document is content_type "${contentType || 'untyped'}", not "blog". post_to_blog only publishes blog docs. Create a blog doc (sidebar → "+ New" → Blog) and switch to it before posting.`,
          };
        }

        const blogCtx: Record<string, any> = metadata.blogContext || {};

        const cloneRoot = join(owRoot(), '_blog-clones');
        mkdirSync(cloneRoot, { recursive: true });
        const clonePath = join(cloneRoot, site.id);

        if (!(await ghAuthOk(cloneRoot))) {
          return { error: 'gh CLI not authenticated. Run `gh auth login` first.' };
        }

        // Clone or refresh
        if (!existsSync(join(clonePath, '.git'))) {
          if (existsSync(clonePath)) {
            try { rmSync(clonePath, { recursive: true, force: true }); } catch { /* ignore */ }
          }
          try {
            await exec('gh', ['repo', 'clone', `${site.owner}/${site.repo}`, clonePath], cloneRoot);
          } catch (err: any) {
            return { error: `Clone failed: ${err.message}` };
          }
          try {
            await exec('git', ['checkout', site.branch], clonePath);
          } catch { /* may already be on it */ }
        } else {
          try {
            await exec('git', ['fetch', 'origin', site.branch], clonePath);
            await exec('git', ['checkout', site.branch], clonePath);
            await exec('git', ['reset', '--hard', `origin/${site.branch}`], clonePath);
          } catch (err: any) {
            return { error: `Failed to refresh clone: ${err.message}` };
          }
        }

        // Build markdown body
        const rawMd = srv.tiptapToMarkdown(doc, title, metadata);
        const bodyMd = stripFrontmatter(rawMd);

        // Slug priority: explicit param > blogContext.slug > slugified title
        const slug = String(params.slug || blogCtx.slug || slugify(title));
        if (!slug) return { error: 'Could not derive a slug from the title.' };

        // Per-site image contract: `image_path_style` governs the FRONTMATTER
        // cover only. Inline BODY refs are always absolute — see
        // rewriteBodyImages. adr: adr/blog-image-contract.md
        const style = pathStyleOf(site);

        // Inline body images keep their source (hash) filenames — only the
        // path is rewritten. Deterministic slug naming is scoped to the
        // COVER for now (inline naming is a noted follow-up in the ADR).
        const { body: bodyRewritten, imageRefs } = rewriteBodyImages(bodyMd, site.image_public_prefix);

        // Cover image from blogContext → deterministic `og-{slug}.{ext}` name.
        // Same doc + slug ⇒ same filename every republish (idempotent
        // overwrite, no orphaned cover). Source extension is preserved.
        let coverImagePath: string | undefined;
        let coverSrcFile: string | undefined;
        let coverDestFile: string | undefined;
        if (typeof blogCtx.coverImage === 'string' && blogCtx.coverImage) {
          coverSrcFile = blogCtx.coverImage.replace(/^\/_images\//, '');
          const ext = extname(coverSrcFile) || '.png';
          coverDestFile = coverFilename(site.image_naming, slug, ext);
          coverImagePath = imageRef(site.image_public_prefix, coverDestFile, style);
        }

        // Copy images
        const dataDir = srv.getDataDir();
        const imageDirAbs = join(clonePath, site.image_dir);
        mkdirSync(imageDirAbs, { recursive: true });
        let imagesCopied = 0;
        // Inline images — copied under their source filename
        for (const fn of imageRefs) {
          const src = join(dataDir, '_images', fn);
          if (!existsSync(src)) continue;
          const dst = join(imageDirAbs, fn);
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(src, dst);
          imagesCopied++;
        }
        // Cover — copied under the deterministic slug-based name
        if (coverSrcFile && coverDestFile) {
          const src = join(dataDir, '_images', coverSrcFile);
          if (existsSync(src)) {
            const dst = join(imageDirAbs, coverDestFile);
            mkdirSync(dirname(dst), { recursive: true });
            copyFileSync(src, dst);
            imagesCopied++;
          }
        }

        // Write the post file
        const frontmatter = buildFrontmatter(title, blogCtx, site, coverImagePath);
        const postRel = join(site.content_dir, `${slug}.md`);
        const postAbs = join(clonePath, postRel);
        mkdirSync(dirname(postAbs), { recursive: true });
        writeFileSync(postAbs, frontmatter + bodyRewritten + '\n', 'utf-8');

        // ── PRE-COMMIT SCHEMA GATE ──────────────────────────────────────────
        // Validate the built frontmatter against the TARGET SITE's own content
        // schema BEFORE anything is committed. A value outside the site's
        // z.enum (e.g. category "Updates" when the schema allows only
        // 'Product Updates' | 'Guides' | …) otherwise sails straight to a red
        // Astro build + a silent 404 — the exact failure that motivated this
        // gate (live incident 2026-06-09). The schema is read from the cloned
        // repo's LIVE config every publish, never a mirrored snapshot, so it
        // can't drift from the site. adr: adr/blog-publish-schema-gate.md
        const gate = await srv.validateBlogFrontmatter({
          repoRoot: clonePath,
          contentDir: site.content_dir,
          frontmatter,
        });
        if (!gate.ok) {
          // ABORT before commit/push. Nothing was committed; this working-tree
          // edit stays local and is wiped by the next publish's reset --hard.
          const friendly = gate.summary
            || (gate.issues || []).map((i) => i.message).join('; ')
            || 'frontmatter does not match the site schema';
          // Human surface: a toast fires for whoever clicked Publish, over the
          // existing WS path, routed to the canonical showToast() primitive.
          try { srv.broadcastToast(`Blog publish blocked: ${friendly}`, 'error'); } catch { /* best-effort */ }
          // MCP surface: structured error so the calling agent sees exactly
          // what to fix and can republish.
          return {
            error: `Publish blocked — ${friendly}`,
            validation_failed: true,
            issues: gate.issues || [],
            ...(gate.configPath ? { schema_config: gate.configPath } : {}),
            ...(gate.collection ? { collection: gate.collection } : {}),
            hint: "Fix the frontmatter to match the site's content schema, then republish. Nothing was committed or pushed.",
          };
        }
        // Validation could not run faithfully (non-Astro repo, unparseable
        // config, or a schemaless collection). NEVER a silent skip — surface
        // it. For an Astro site this is a real gap (loud error); for other
        // frameworks there's simply no Astro schema to check (quiet info). The
        // reason always rides back on the MCP response either way.
        let validationWarning: string | undefined;
        if (gate.skipped) {
          validationWarning = `Published WITHOUT schema validation — ${gate.reason}.`;
          const astroExpected = site.framework === 'astro';
          try {
            srv.broadcastToast(
              astroExpected
                ? `Blog published without schema check — ${gate.reason}`
                : `Blog published (no Astro schema to check on this ${site.framework} site)`,
              astroExpected ? 'error' : 'info',
            );
          } catch { /* best-effort */ }
        }

        // Commit + push (no-op is fine — still counts as a publish for the writeback)
        const commitMessage = String(params.commit_message || `blog: ${title}`);
        let noChanges = false;
        try {
          await exec('git', ['add', '-A'], clonePath);
          const status = await exec('git', ['status', '--porcelain'], clonePath);
          if (!status) {
            noChanges = true;
          } else {
            await exec('git', ['commit', '-m', commitMessage], clonePath);
            await exec('git', ['push', 'origin', site.branch], clonePath);
          }
        } catch (err: any) {
          return { error: `Git op failed: ${err.message}` };
        }

        let shortHash = '';
        try { shortHash = await exec('git', ['rev-parse', '--short', 'HEAD'], clonePath); } catch { /* ignore */ }

        // Construct the live URL when the site has site_url configured.
        // Pattern defaults to /blog/{slug}/ — matches the convention proposed by inspect_blog_repo.
        let liveUrl: string | undefined;
        if (site.site_url) {
          liveUrl = site.site_url.replace(/\/+$/, '') + blogPostPath(site.blog_url_pattern, slug, blogCtx.date);
        }

        // Mark the doc as sent so the file-tree right-click menu surfaces
        // "View Post" with a live link. This mirrors the tweetContext.lastPost /
        // articleContext.lastPost / newsletterContext.lastSend pattern. Runs
        // even on no-op publishes — the doc is still "on the site as of now".
        // adr: adr/plugin-slot-nested-data.md (writes through setMetadata which deep-merges blogContext)
        let writebackWarning: string | undefined;
        try {
          srv.setMetadata({
            blogContext: {
              lastPublish: {
                publishedAt: new Date().toISOString(),
                ...(liveUrl ? { publishedUrl: liveUrl } : {}),
                ...(shortHash ? { commit: shortHash } : {}),
                file: postRel.replace(/\\/g, '/'),
              },
            },
          });
          // setMetadata doesn't bump docVersion on its own — without an explicit
          // bump, save()→writeToDisk hits the no-op gate (docVersion === lastSavedDocVersion
          // when there's no body change) and the lastPublish writeback never lands on disk.
          // Same convention mcp.ts:1112 uses for active-doc metadata writes.
          srv.bumpDocVersion();
          srv.save();
          // Notify every connected client so the file-tree "published" ✓ + the
          // "Republish to Blog" context-menu label + the compose-view "Published"
          // pill flip live, with no manual reload. metadata-changed updates the
          // active doc's compose view; documents-changed re-reads /api/documents
          // (where blogContext.lastPublish.publishedUrl → postedUrl drives the
          // file tree). Mirrors the broadcast-after-setMetadata convention the
          // core MCP tools follow. adr: adr/plugin-metadata-broadcast.md
          srv.broadcastMetadataChanged(srv.getMetadata());
          srv.broadcastDocumentsChanged();
        } catch (err: any) {
          writebackWarning = `Published successfully, but failed to mark doc as sent: ${err.message}`;
        }

        return {
          success: true,
          file: postRel.replace(/\\/g, '/'),
          commit: shortHash,
          images_committed: noChanges ? 0 : imagesCopied,
          // Transparency: the exact cover path written to frontmatter + the
          // filename it shipped as, so the agent/user sees what landed.
          ...(coverImagePath ? { image: coverImagePath, cover_file: coverDestFile } : {}),
          live_url: liveUrl,
          // Transparency on the happy path: the schema gate ran and passed (or
          // was loudly skipped). adr: adr/blog-publish-schema-gate.md
          validated: !gate.skipped,
          ...(gate.configPath ? { schema_config: gate.configPath } : {}),
          ...(gate.collection ? { schema_collection: gate.collection } : {}),
          message: noChanges
            ? 'No changes — file already up to date. Doc marked as sent.'
            : `Pushed to ${site.owner}/${site.repo}@${site.branch}`,
          ...(validationWarning ? { validation_warning: validationWarning } : {}),
          ...(writebackWarning ? { warning: writebackWarning } : {}),
        };
      },
    },
  ];
}
