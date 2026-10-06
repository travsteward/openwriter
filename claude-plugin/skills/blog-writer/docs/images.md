# Mode: Images

Generate the featured (cover) image and any inline body images for a blog post. Primary path is the openwriter `insert_image` MCP tool — places the image directly in the active doc (or onto disk for cover wiring), so the github plugin's `post_to_blog` finds it automatically.

## When to use

- User says "blog image" / "featured image" / "OG image" / "cover image" / "inline image for the post"
- Pipeline mode is on Step 2
- User has an approved draft and needs the visual

## Requirements

- `GEMINI_API_KEY` set on the openwriter server (the plugin falls back to the publish platform API if absent)
- Active OpenWriter blog doc OR `set_metadata` access if generating a cover for a non-active doc
- Project SHOULD have a `style_doc` in `## Blog` config — used to pick a consistent visual style across the site. Optional but recommended.

## Two image roles

| Role | Where it lands | How to set |
|---|---|---|
| **Cover** (OG card / hero) | `blogContext.coverImage` on the doc; published as `coverImage` (or whatever the site renames it to) in frontmatter | `insert_image` with no `docId` → returns path → `set_metadata({blogContext: {coverImage, coverImageAlt}})` |
| **Inline** (body image at a specific point) | Becomes an `<img>` node in the doc body at `afterNodeId` | `insert_image` with `docId` + `afterNodeId` |

There's also a third mode — `insert_image` with `set_cover: true` — but that sets `articleContext.coverImage` (designed for `/x-writer` articles). For blog posts, use the path-return + explicit `blogContext.coverImage` set instead.

## Workflow

### Step 1: Read style guidance

If the project's `## Blog` config has `style_doc`, read it. Style docs typically have:
- Visual categories + decision tree
- Tone matrix (matching the post's angle to a style)
- Prompt templates per style
- Project-specific rules (safe zones, no-faces, etc.)
- History table of previously used images (skip styles used in the last 3 posts)

If no `style_doc`, default to: "clean modern illustration; soft palette appropriate to the site's brand; 16:9 cover, 16:9 inline; no text on image."

**OG placement rules — any cover that carries text obeys these placement rules:** no text at the bottom (the platform renders og:title there → collision), ≤5–7 words, don't echo the title/description, keep the subject in the center safe zone, must read in 1–2s at thumbnail. **Text-overlay covers** (photo+text styles) are composited with Sharp: generate the *no-text* base via `insert_image`, then overlay text from a `C:/tmp/` working file (left/center-left, never bottom) and move to the project only on approval. Pure no-text covers (Style A/B/C) skip tmp and ride the `insert_image` path below.

**Canonical output size: 1200×630 (1.905:1).** The blog card hard-codes this ratio (`aspect-ratio: 1200/630`); the post page shows the image uncropped. Gemini's widest is 16:9, so generate at `aspect_ratio: "16:9"` then Sharp `fit:"cover"` to exactly 1200×630 (trims top+bottom of the AI frame — keep the subject centered). Honor a `feature_image_size` override from the project's `## Blog` config. **Do not trust OpenWriter's article-cover preview for spacing** — it clips to ~2.5:1; the real blog post page renders the full 1200×630.

### Step 2: Analyze content (optional)

If `content_driven: true` in the project's `## Blog` config, read the post via `read_pad` first. Extract the ONE concept that would make someone scroll-stop and click. The cover prompt should land that concept visually.

### Step 3: Craft the prompt

Universal rules (apply to every prompt regardless of project):
- 2–4 sentences, focused
- Specific scene description over abstract concepts
- Include lighting details — they drive mood more than anything else
- End with "No text, no watermarks, no logos"
- Never say "leave [area] empty" — Gemini interprets that as "draw a literal box"
- Money in word form: "Five Hundred Dollars" not "$500"

### Step 4: Generate the cover

```js
const { src } = await insert_image({
  prompt: "<crafted prompt>",
  aspect_ratio: "16:9"
  // no docId, no set_cover — generates to disk and returns path
});
// src is like "/_images/9c69e9b0.png"
```

Then wire it to the active doc's blogContext:

```js
set_metadata({
  docId,
  metadata: {
    blogContext: {
      coverImage: src,
      coverImageAlt: "<descriptive alt text — what's in the image, why it's relevant>"
    }
  }
})
```

### Step 5: Generate inline images (optional)

For each inline image:

```js
insert_image({
  prompt: "<crafted prompt>",
  docId,                          // 8-char hex from the active doc
  afterNodeId: "<node id>",        // from read_pad output, place image after this paragraph
  alt: "<descriptive alt text>",
  aspect_ratio: "16:9"
})
```

The image lands in the doc body as a pending decoration. **Tell the user to accept it in the Review tab before invoking integrate** — see the integrate mode's Step 3 gotcha.

### Step 6: Review

Tell the user the images are pending in the openwriter doc; they review them in their own browser. Never open the openwriter UI in a browser yourself (see the openwriter skill, firm rule 0). Iterate prompts until approval. Generated images often miss the mark on the first try; budget for 2–3 regenerations.

### Step 7: Update style history (optional)

If using a `style_doc` with a history table, add an entry: post title, style used, date. Keeps the next post from repeating.

## Image format notes

The github plugin copies PNGs into the repo unchanged. If the target site insists on `.webp` for performance, run sharp conversion before publish — or set up the site's build pipeline to handle PNG → WebP at build time (preferred). The plugin doesn't convert formats.

```bash
# If you must pre-convert
node -e "require('sharp')('<src.png>').webp({quality:82}).toFile('<dst.webp>').then(()=>{})"
```

## Standalone CLI fallback

For non-OpenWriter workflows (legacy projects, scripted batch image generation, projects that don't use the github plugin):

```bash
node <path-to-image-gen-cli>/cli.bundle.js \
  -p "[PROMPT]" \
  -o /c/tmp/blog-image.png \
  -a "16:9"
```

This was the v0.3.x path. The image lands in `/c/tmp/`, then a manual file copy + frontmatter edit wires it into the project. The new path via `insert_image` skips all that — image lands in OpenWriter and rides through `post_to_blog` to the repo.

## Style libraries

Each project can have its own style doc (anywhere on disk — point to it via `style_doc` in the project's `## Blog` config) with:
- Visual categories and decision tree
- Tone matrix
- Prompt templates per style
- Project-specific rules
- History table

### Example

| Project | Style doc |
|---|---|
| RecipeBox | `<your style library dir>/recipebox.md` |

To add a new project's style doc: create the file with the same structure and reference it in the project's `## Blog` config under `style_doc`.

## Output

```json
{
  "status": "draft-ready",
  "artifact": {
    "doc_id": "<blog draft doc>",
    "workspace_id": "...",
    "cover_image_path": "/_images/<filename>.png",
    "inline_image_paths": ["/_images/<filename>.png", "..."]
  },
  "next_steps": ["/blog-writer integrate"],
  "notes": "Cover wired to blogContext.coverImage. Inline images placed as pending decorations — tell the user to Accept All in the right rail before publishing."
}
```

## Anti-patterns

- ❌ Saving the image to `/c/tmp/` and manually copying it into the target repo — that's the old v0.3 path; the new flow puts images directly in OpenWriter and lets `post_to_blog` handle copy + path rewrite
- ❌ Using `insert_image({set_cover: true})` for blog covers — it writes to `articleContext.coverImage` (article skill's field), not `blogContext.coverImage`. The plugin reads `blogContext` only.
- ❌ Setting `coverImage` to an absolute filesystem path or external URL — `post_to_blog` only knows how to rewrite `/_images/...` references. External images must be downloaded into `~/.openwriter/profiles/<profile>/_images/` first.
- ❌ Forgetting to set `coverImageAlt` — accessibility + the site layout often shows alt text as a caption fallback
- ❌ Inline images without `afterNodeId` — won't insert into the body
- ❌ Generating an image before content is approved — angle might shift
- ❌ Reusing a style from the last 3 posts — history table exists for a reason
