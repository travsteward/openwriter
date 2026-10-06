# Mode: Integrate

Publish the active OpenWriter blog doc to a registered blog repo. One MCP tool call (`post_to_blog`) handles the whole flow: clone-or-refresh the repo, build clean frontmatter from `blogContext` + site `frontmatter_defaults`, copy referenced images to the site's `image_dir`, rewrite `/_images/...` paths to public URLs, commit, push.

## Source of truth + idempotency (read first)

The OpenWriter doc is the **single source of truth** and `post_to_blog` is the **only writer** to the blog repo. The flow is always **doc → Accept pending → Publish**. Never hand-edit the published `.md`, never hand-set its `image:` frontmatter, never drop a cover into the repo's `public/`, and never `git push` the post yourself — each creates a doc-vs-repo drift that the next Publish silently overwrites (it rewrites `<content_dir>/<slug>.md` wholesale), so your hand-edits vanish and the cover can orphan.

Republish is idempotent **by slug**: same `slug` → same target file, overwritten in place, never a duplicate. (Deterministic cover *naming* — `og-{slug}` — and per-site image *path-style* are being standardized in the plugin; until that lands, make `blogContext.coverImage`'s filename already match the site's convention, e.g. `og-{slug}.png`, so Publish reproduces the expected path. Verify the emitted `image:` matches the site's other posts — leading-slash vs not — before trusting a republish.)

## When to use

- User says "integrate" / "publish" / "post to blog" / "wire up the post" / "ship the post"
- Pipeline mode is on Step 3
- Draft is approved in OpenWriter and any cover/inline images are accepted

## Requirements

- Target blog repo registered via `add_blog_site` (run `/blog-writer setup` first if not)
- Active OpenWriter doc with `content_type: blog` (or `blogContext.active: true`)
- Doc title set
- `gh auth login` working
- **All pending agent decorations accepted** — see the gotcha below

## Workflow

### Step 1: Find the site

```js
const sites = await list_blog_sites();
const site = sites.find(s => s.label === "<target>") || sites[0];
```

If multiple sites and the user didn't name one, ask. If zero, redirect to `/blog-writer setup`.

### Step 2: Make sure the doc is on `blogContext`, not in prose

The plugin builds frontmatter from `metadata.blogContext` only — top-level fields are ignored intentionally to prevent openwriter-internal leaks. Verify or set:

```js
set_metadata({
  docId,
  metadata: {
    blogContext: {
      active: true,
      description: "<140-160 char SEO description>",
      date: "<YYYY-MM-DD>",                    // plugin maps to publishedDate if site requires
      tags: ["<category1>", "<category2>"],    // real categories, not the "blog" content-type marker
      author: "<override site default if needed>",
      slug: "<filename-slug-without-md>",
      coverImage: "/_images/<filename>.png",   // path returned by insert_image
      coverImageAlt: "<alt text>"
    }
  }
})
```

Fields NOT to set on `blogContext`:
- `layout`, `prerender`, `authorImage` — site-wide constants; live in `frontmatter_defaults` (set during `setup`)
- `title` — comes from the doc title, not blogContext

### Step 3: Accept any pending agent decorations

**This is the gotcha that bit the first E2E test.** `post_to_blog` reads the canonical doc on disk via `getDocument()` and `tiptapToMarkdown()`. Agent-inserted images and rewrites land as pending decorations in the in-memory overlay until the user accepts them via the right-rail Review tab. Until accepted, they're NOT on disk and the published post won't include them.

Symptoms:
- You inserted an inline image via `insert_image` → `images_committed: 0` after `post_to_blog`
- You rewrote a paragraph → published post still shows the original text

Fix today: tell the user to click "Accept All" (or hit Shift+A) in the right-rail Review tab. Then `post_to_blog`. Confirm via `read_pad` that the body matches what's in the OW UI.

**Don't try to "auto-accept" via `POST /api/auto-accept`** — its `stripPendingAttrs()` clears the overlay rather than committing it to canonical, so you'll lose the agent's writes instead of publishing them.

Cover images set via `set_metadata({ blogContext: { coverImage } })` are NOT pending — they persist to disk immediately because `set_metadata` writes through. Only body-level decorations (inserts, rewrites, deletes) go through the pending overlay.

### Step 4: Publish

```js
post_to_blog({
  site_id: "<uuid from list_blog_sites>",
  slug: "<optional — defaults to blogContext.slug or slugified title>",
  commit_message: "<optional — defaults to 'blog: {title}'>"
})
```

Plugin does:
1. Clone-or-refresh the repo at `~/.openwriter/_blog-clones/<site_id>/`
2. Build frontmatter from `site.frontmatter_defaults` → `title` → `blogContext` (with `frontmatter_field_map` renames applied) → cover image path rewritten to public prefix
3. Strip frontmatter from `tiptapToMarkdown` output (the openwriter-internal JSON frontmatter never ships)
4. Rewrite every `/_images/<filename>` in the body to `<image_public_prefix>/<filename>`
5. Copy referenced images (inline + cover) from `~/.openwriter/profiles/<profile>/_images/` into `<repo>/<image_dir>/`
6. Write the post file at `<repo>/<content_dir>/<slug>.md`
7. `git add -A && git commit -m <message> && git push origin <branch>`

Returns:
```json
{
  "success": true,
  "file": "src/pages/blog/<slug>.md",
  "commit": "<short hash>",
  "images_committed": 2,
  "live_url": "https://<site>/blog/<slug>/",
  "message": "Pushed to <owner>/<repo>@<branch>"
}
```

`live_url` is included when the site has `site_url` + `blog_url_pattern` configured (set during setup). Same call also writes `blogContext.lastPublish` on the doc — file-tree right-click then shows a green ✓ badge + "View Post" menu item that opens this URL. Standard mark-sent convention shared with tweets / articles / newsletters.

### Step 5: Verify

If `images_committed` is less than expected, check Step 3 — pending decorations likely weren't accepted before publish.

Cat the file in the local clone to confirm:
```bash
cat ~/.openwriter/_blog-clones/<site_id>/<content_dir>/<slug>.md
```

The frontmatter should be clean — site defaults at the top, then `title` + `blogContext` fields (after rename). No `status`, no `enrichmentStale`, no `tags: [blog]`, no `slug` duplicate if the site doesn't use it.

Also confirm the doc was marked as sent. `get_metadata({docId})` should now return:

```json
"blogContext": {
  ...,
  "lastPublish": {
    "publishedAt": "<ISO>",
    "publishedUrl": "<live URL>",
    "commit": "<short hash>",
    "file": "<repo-relative path>"
  }
}
```

If `lastPublish` is missing, either the writeback failed (surface the `warning` field from the post_to_blog response) **or a later `set_metadata({ blogContext: {...} })` shallow-replaced the object and wiped it** — `set_metadata` replaces a nested object wholesale, so always spread the existing `blogContext` (including `lastPublish`) when updating it, or update only the leaf key you mean to change. The publish itself still landed; the file-tree just won't show the sent badge or "View Post" item until the link is restored (re-publishing rewrites it).

### Step 6: Wait for auto-deploy

Most static sites deploy on push (Netlify, Cloudflare Pages, Vercel) — usually 1–3 min for an Astro/Next build. If the site has a custom deploy pipeline (build step on a server, manual approval), hand off to your project's deploy pipeline instead.

Verify the URL returns HTTP 200:
```bash
curl -sS -o /dev/null -w "HTTP %{http_code}" -L --max-time 15 "<site_url>/<blog_url_pattern with slug>"
```

For the live render check (does the post look right? did the cover land? does the layout pick up the new tags?), open the URL in the user's chrome via the Claude_in_Chrome MCP.

## Output

```json
{
  "status": "draft-ready",
  "artifact": {
    "doc_id": "<openwriter doc>",
    "workspace_id": "...",
    "site_id": "<site uuid>",
    "commit": "<short hash>",
    "file": "<repo path>",
    "live_url": "<projected URL — verify after deploy>"
  },
  "next_steps": ["announce (your own channels)"],
  "notes": "Published to <owner>/<repo>@<commit>. Site auto-deploys on push; verify live URL in ~2 min."
}
```

## Anti-patterns

- ❌ Manually writing the post .md file into the target repo via Write/Edit tools — skips frontmatter assembly, image copy, path rewrite, and the per-site config
- ❌ Stuffing site-wide constants (`layout`, `author`, `prerender`) into `blogContext` instead of `frontmatter_defaults` — they'll write into every post and drift across the site
- ❌ Publishing immediately after `insert_image` without prompting the user to accept the pending decoration — image won't ship
- ❌ Calling `/api/auto-accept` to "clear pending" — that function strips the overlay, dropping the agent's writes instead of committing them
- ❌ Manually `git push`-ing from the local clone after `post_to_blog` already pushed — the plugin owns the commit + push, double-pushing creates noisy history
- ❌ Setting frontmatter directly on top-level metadata (e.g. `metadata.author`) — the plugin reads only `metadata.blogContext`; top-level is ignored to keep openwriter-internal fields out of the published frontmatter
- ❌ Auto-committing the new files in the target repo — the plugin already committed them; touch them only if a follow-up edit is genuinely needed
