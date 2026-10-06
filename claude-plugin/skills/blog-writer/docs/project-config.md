# Reading the `## Blog` config

As of v0.4.0, frontmatter shape (`content_dir`, `image_dir`, `post_format`, the actual frontmatter fields) lives on the github plugin's per-site config in `~/.openwriter/config.json`, set during `/blog-writer setup`. The project's `## Blog` section is now optional — it carries writing rules and image style guidance, NOT publish mechanics.

## What still belongs in `## Blog`

Fields the blog-writer skill (modes `beats`, `draft`, `images`, optionally `pipeline`) still reads from the project's CLAUDE.md `## Blog` section:

```yaml
# Writing
writing_rules: docs/writing-style.md    # optional — overrides default voice/style rules
author: "Alex Carter"                # default author byline (can be overridden per-post via blogContext)
timezone: America/Los_Angeles           # for date defaults

# Images
style_doc: docs/blog-image-styles.md       # path to your image style library doc
content_driven: true                     # if true, images mode reads the post first for concept analysis
aspect_ratio: 16:9                       # default for blog covers
image_format: png                        # png | webp — webp triggers sharp conversion before publish

# Deploy verification
site_url: https://example.com            # base URL for the live-URL HTTP 200 check
blog_url_pattern: /blog/{slug}/          # URL pattern to construct the post's live URL
```

Project config is now lightweight — five-ish fields at most. The heavy lifting (content_dir, frontmatter, image_dir, public prefix, framework) lives in the github plugin's per-site config.

## What moved OUT of `## Blog`

These fields used to live in project config (v0.3.x) but are now set during `/blog-writer setup`:

| Old field (v0.3) | New home (v0.4+) |
|---|---|
| `content_dir` | `add_blog_site({content_dir})` |
| `image_dir` | `add_blog_site({image_dir})` |
| `image_public_prefix` (implicit) | `add_blog_site({image_public_prefix})` |
| `post_format` | `add_blog_site({framework})` (`astro` / `next` / `jekyll` / `hugo` / `unknown`) |
| `image_naming` (filename pattern) | n/a — the plugin uses openwriter's `/_images/<hash>.png` style, no per-site renaming |
| `registries` (registry update list) | n/a — Astro/Next/Hugo/Jekyll auto-discover posts from `content_dir`; no separate registry to update |

If you find a project still using the v0.3 schema, you can leave it alone or migrate by running `/blog-writer setup` — the per-site config takes precedence; project config gets ignored for those fields.

## Required vs optional

All `## Blog` fields are now optional. Defaults apply if missing:

| Field | Default |
|---|---|
| `writing_rules` | None — voice + style live in `/authors-voice` and the site's voice anchor (see [voice-anchor.md](voice-anchor.md)); writing_rules only overrides for project-specific terminology or rhetorical patterns |
| `author` | None — `blogContext.author` per post, or site's `frontmatter_defaults.author` |
| `timezone` | `America/Los_Angeles` |
| `style_doc` | None — `images` mode falls back to generic "clean modern illustration" prompt |
| `content_driven` | `false` |
| `aspect_ratio` | `16:9` |
| `image_format` | `png` |
| `site_url` + `blog_url_pattern` | None — pipeline mode skips Step 4 (deploy verify) without these |

The skill should NOT block on missing `## Blog` — it should fall through to defaults and proceed. The hard requirement is that the target blog repo is registered via `add_blog_site`, not that the project has a `## Blog` section.

## Adding a new project

Two steps:

1. **Per-blog setup (one-time):** `/blog-writer setup` — registers the GitHub repo with the github plugin. See [setup.md](setup.md).
2. **Per-project config (optional, recommended):** add a `## Blog` section to the project's CLAUDE.md with the fields above. Especially helpful:
   - `style_doc` — for visually consistent image generation
   - `writing_rules` — for project-specific voice
   - `site_url` + `blog_url_pattern` — for deploy verification

If the project has neither, the skill still works — defaults take over.

## Multi-blog projects

If a single project publishes to multiple blog repos (e.g. company main blog + engineering blog), register each repo with `add_blog_site` using distinct labels. Pipeline mode prompts the user to pick when multiple sites are registered.

The project's `## Blog` config is still single-shape — it applies to all blogs the project publishes to. For per-blog style differences, use separate `style_doc` files referenced from inside the writing-rules doc, or rely on the per-site `frontmatter_defaults` to encode site-specific constants.
