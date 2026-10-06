# Mode: Setup

One-time-per-blog-repo registration with the openwriter github plugin. After setup, `integrate` can publish to this repo with a single `post_to_blog` call.

## When to use

- User says "set up blog repo" / "register blog site" / "add my blog"
- `list_blog_sites` returns no entry for the target repo before publishing
- Onboarding a new project onto the github plugin pipeline

## Requirements

- openwriter MCP server running, github plugin enabled
- `gh auth login` set up on the user's machine (the plugin uses the user's local gh credentials; no PATs)
- The target repo must exist on GitHub and the user must have push access

## Workflow

### Step 1: Confirm the target

Get the GitHub URL or `owner/repo` shorthand from the user. Examples:
- `yourname/recipebox-website`
- `https://github.com/acme/blog`

Reject anything that doesn't parse to `owner/repo`.

### Step 2: Inspect

Call `inspect_blog_repo` with the URL. The tool:

1. Clones the repo shallow to `~/.openwriter/_blog-inspect-cache/`
2. Detects framework (`astro` / `next` / `jekyll` / `hugo` / `unknown`) from config files
3. Finds the directory with the most markdown files → proposes `content_dir`
4. Reads up to 10 sample posts' frontmatter
5. **Auto-proposes `frontmatter_defaults`** — fields present in EVERY sample with the same value (constants the site relies on, e.g. `layout`, `author`, `prerender`)
6. **Auto-proposes `frontmatter_field_map`** — if the site uses `publishedDate` or `pubDate` instead of standard `date`, suggests the rename `{date: "publishedDate"}`
7. **Auto-proposes `site_url`** — scans `CNAME` / `public/CNAME` / `wrangler.toml routes`, then falls back to the **GitHub Pages API** (credential-free via `gh`). If it still can't resolve — common for Netlify / Vercel sites whose domain lives only in the host dashboard — it returns **`needs_site_url: true`** + a hint instead of a value. That flag is your cue to ask the user, not ship a post with a dead "View Post" link.
8. **Auto-proposes `blog_url_pattern`** — defaults to `/blog/{slug}/` (the convention almost every Astro/Next/Hugo blog uses). User can override.
9. Filters out files that look like prior leaked-openwriter posts (have `enrichmentStale`, `tags: [blog]`, or `status: draft` + ISO-with-time `date`) — those would pollute the constants detection

Returns:
```json
{
  "owner": "...",
  "repo": "...",
  "framework": "astro",
  "content_dir": "src/pages/blog",
  "image_dir": "public/blog-images",
  "image_public_prefix": "/blog-images",
  "frontmatter_schema": ["layout", "title", "description", "publishedDate", "author", "authorImage", "coverImage", "coverImageAlt", "tags", "prerender"],
  "frontmatter_defaults": {
    "layout": "../../layouts/BlogPost.astro",
    "author": "...",
    "authorImage": "/avatars/...svg",
    "prerender": true
  },
  "frontmatter_field_map": { "date": "publishedDate" },
  "site_url": "https://recipebox.example.com",
  "blog_url_pattern": "/blog/{slug}/",
  "samples_analyzed": 7,
  "samples_skipped_openwriter_leak": 0,
  "markdown_files_found": 7,
  "confidence": "high"
}
```

### Step 3: Show the proposal to the user

Present the inspection result. Highlight:
- **Framework + content_dir** — confirm these match where the user expects new posts to land
- **frontmatter_defaults** — the constants every published post will get
- **frontmatter_field_map** — any rename (e.g. Astro's `publishedDate`)
- **site_url** — if proposed, confirm it's the public hostname; if `needs_site_url: true`, **ask the user for it before adding the site** — without it every published post gets a dead "View Post" link (`post_to_blog` only returns `live_url` when `site_url` + `blog_url_pattern` are both set)
- **blog_url_pattern** — default `/blog/{slug}/` works for most sites; ask if the site uses something else (`/posts/{slug}`, `/blog/{slug}` without trailing slash, etc.)
- **samples_skipped_openwriter_leak** — if non-zero, mention there are stale openwriter-format posts in the repo the user may want to clean up before they pollute future inspections

If `confidence: low` or `samples_skipped_openwriter_leak > 0`, slow down and verify with the user before adding the site.

### Step 4: Add the site

Once approved, call `add_blog_site` with the full payload:

```js
add_blog_site({
  label: "<short user-friendly name, e.g. 'RecipeBox'>",
  owner, repo, branch: "main",     // or detected default branch
  content_dir, image_dir, image_public_prefix, framework,
  frontmatter_defaults,            // pass through from inspect
  frontmatter_field_map,           // pass through from inspect
  frontmatter_schema,              // pass through from inspect
  site_url,                        // pass through (or user-provided), e.g. "https://recipebox.example.com"
  blog_url_pattern                 // default "/blog/{slug}/" — pass through unless user overrides
})
```

Persists to `~/.openwriter/config.json` → `plugins['@openwriter/plugin-github'].blogSites[]`.

Returns the site id (uuid). Surface this id to the user — they'll need it (or the label) when invoking `integrate` later.

### Step 5: Verify

Call `list_blog_sites` and confirm the new site appears with all the fields the inspector proposed. The `frontmatter_defaults`, `frontmatter_field_map`, and `frontmatter_schema` keys must round-trip back — if they're missing on the persisted record, the plugin's per-site config was stripped by an older bug (fixed: see `adr/plugin-slot-nested-data.md`). Re-run setup against a fresh openwriter spawn if it happens.

## Edits after setup

**Backfill / correct a field with `edit_blog_site`.** If a site was registered without `site_url` (or with the wrong `blog_url_pattern`), call `edit_blog_site({ site_id, site_url, blog_url_pattern })` — only the fields you pass change, everything else is left intact. This is the one-click fix when a first publish came back with no live link: backfill `site_url`, then republish. No need to remove + re-register.

The panel at right-rail → Plugins → GitHub shows the registered sites and lets the user remove them. For editing `frontmatter_defaults` after setup, the user edits `~/.openwriter/config.json` directly — the panel doesn't yet expose a defaults editor.

## Output

```json
{
  "status": "draft-ready",
  "artifact": {
    "site_id": "<uuid>",
    "site_label": "<label>",
    "owner": "<owner>",
    "repo": "<repo>"
  },
  "next_steps": ["/blog-writer brainstorm", "/blog-writer beats"],
  "notes": "Site registered. Use site_id when calling /blog-writer integrate."
}
```

## Anti-patterns

- ❌ Skipping the inspect step — registers a site without the defaults the target requires. Posts ship with minimal frontmatter and break the site's build/render.
- ❌ Inventing `frontmatter_defaults` from intuition instead of detecting them — get them wrong and every post inherits the wrong layout / author / etc.
- ❌ Hardcoding `frontmatter_field_map: {date: "publishedDate"}` for every Astro site — some Astro sites use plain `date`. Let `inspect_blog_repo` detect from existing posts.
- ❌ Adding the site without surfacing the proposal — the user should see what's being baked into the config before it's saved.
