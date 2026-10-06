---
name: blog-writer
description: |
  Channel-master writer for long-form blog posts. Owns the SHAPE of a post —
  beat structure, title/preview/slug commitments, per-post container layout,
  per-site voice anchor discovery — and delegates VOICE (prose generation) to
  /authors-voice and PUBLISH mechanics to the openwriter github plugin
  (`add_blog_site` + `post_to_blog`).

  Use when: "/blog-writer", "write a blog post", "blog draft", "brainstorm blog
  topics", "blog beats", "extract beats from this post", "write about this
  feature", "draft a post", "blog title", "preview text", "OG description",
  "blog image", "featured image", "OG image", "integrate", "create the files",
  "wire up the blog post", "publish to blog", "post to blog", "set up blog repo",
  "register blog site".

  Requires: OpenWriter MCP server configured + github plugin enabled +
  `gh auth login` set up locally. Project SHOULD have a `## Blog` section in its
  CLAUDE.md for writing-rules / image-style overrides (optional after setup).
metadata:
  author: travsteward
  version: "0.6.0"
license: MIT
---

# Blog Writer

Channel-master skill for long-form blog content. Owns ideation → beats → draft → image → publish.

**Architecture:** beats-first (v0.5.0) + plugin-backed publish (v0.4.0). Each post lives in its own container with two sibling docs: a `Beats` doc (the structural commitments — beat list + title/preview/slug as B0) and a `Draft` doc (the voice-poured prose). Beats reshape regularly; draft re-pours via `/authors-voice` against a per-site anchor (`voice/anchor-<site-slug>.md`). Publish is a single `post_to_blog` MCP call against a site registered via `add_blog_site` — site-specific frontmatter (layout, author, prerender, `date → publishedDate` for Astro, etc.) lives on the github plugin's per-site config in `~/.openwriter/config.json`, not in project config. Mirrors book-writer's discipline at post scale.

## Convention

This skill obeys the shared writer contract at [WRITER-CONVENTION.md](../WRITER-CONVENTION.md). Brief shape and return shape match that doc. Sub-form values: `long` | `short` | `tutorial` | `announcement`.

**OpenWriter pad mechanics are canonical in [/openwriter](../openwriter/SKILL.md) — read it, don't re-derive from tool descriptions.** The load-bearing rule: `populate_document` is **create-only, used ONCE**; it re-sends the whole body, so calling it again to "fix" a doc appends a duplicate. All edits (rewrite / insert / delete) go through `write_to_pad` on fresh node IDs. Plus the read ladder (`outline_doc` → `search_docs` → `peek_doc` → `read_pad`).

**Blog posts ship SEO-complete in the FIRST pass.** A blog post almost always carries SEO — internal/cluster links, meta + slug + tags, snippet-targeted headings, FAQ/schema-eligible content all go into the *initial* draft (the minion brief + first `populate_document`), never bolted on after. Bolting SEO on later forces an edit (→ `write_to_pad`, never a 2nd populate). SEO-strategy-led posts (pillar / landing / comparison) front-end through `/seo-writer` if you have it installed (not bundled with OpenWriter).

**Cover image is a publish gate** (firm rule 12). Placement rules: no bottom-band text (the platform renders og:title there), keep the subject center-safe, ≤5–7 words of overlay text, do not echo the title/description. Palette / brand skin comes from the project's `style_doc` (e.g. `recipebox.md`). Generation, canonical size, and the tmp-first rule for text-overlay covers: [docs/images.md](docs/images.md).

**ABOUT TO HAND-EDIT A PUBLISHED POST'S `.md`, ITS `image:` FRONTMATTER, OR DROP A COVER INTO THE REPO'S `public/`? STOP.** The OpenWriter doc's `blogContext.coverImage` is the single source of truth, and `post_to_blog` is the ONLY writer to the blog repo. Edits flow **doc → Accept → Publish** — never doc *and* repo in parallel, because that drift is exactly what breaks idempotent republish (Publish rewrites `<content_dir>/<slug>.md` wholesale and your hand-edits vanish). Never hand-name a cover; never side-channel an image; never `git push` the post yourself. Canonical publish flow + the `lastPublish`-clobber footgun: [docs/integrate.md](docs/integrate.md).

## Modes

| Mode | Trigger | What it does | Sub-doc |
|---|---|---|---|
| `setup` | `/blog-writer setup`, "register blog repo", "add blog site" | One-time per blog: `inspect_blog_repo` clones the target, auto-proposes `frontmatter_defaults` + `frontmatter_field_map` from existing posts; `add_blog_site` persists the site config | [docs/setup.md](docs/setup.md) |
| `brainstorm` | `/blog-writer brainstorm`, "brainstorm blog topics" | Open a Blog Ideas doc; propose 3-5 candidate angles with tone + length labels; hand off to `beats` when user picks | [docs/brainstorm.md](docs/brainstorm.md) |
| `beats` | `/blog-writer beats`, "extract beats", "blog beats" | Query-first beat extraction with 3-pass (short/announcement, 3-5 beats) or 5-pass (long/tutorial, 8-15 beats); 9 blog category tags (CLAIM/REFRAME/MECHANISM/EVIDENCE/DEMO/SCENE/OBJECTION/APHORISM/PIVOT) + HOOK/CTA positional roles; locks title + preview + slug as B0; dopamine arc layered with conversion arc | [docs/beats.md](docs/beats.md) + [docs/titling.md](docs/titling.md) |
| `draft` | `/blog-writer draft`, "draft this post", "pour the beats" | Per-beat dispatch to `/authors-voice` Apply Protocol with site-specific anchor; cross-beat coherence pass; supports beat-level reshape loop (re-pour only the affected beats) | [docs/draft.md](docs/draft.md) + [docs/voice-anchor.md](docs/voice-anchor.md) |
| `images` | `/blog-writer images`, "blog image", "featured image" | Read style doc, craft prompt, generate cover via `insert_image` (no docId → returns path → `blogContext.coverImage`); optional inline images at `afterNodeId` | [docs/images.md](docs/images.md) |
| `integrate` | `/blog-writer integrate`, "publish", "post to blog" | `post_to_blog` against the registered site — builds frontmatter from `blogContext` + site defaults, copies referenced `/_images/...` to `image_dir`, rewrites paths, commits, pushes; verifies pending decorations accepted first | [docs/integrate.md](docs/integrate.md) |
| `pipeline` | `/blog-writer pipeline`, "full blog workflow", "write and publish" | 7-step sequence (Setup → Brainstorm → Beats → Draft → Images → Accept → Publish → Verify) with explicit gates; reshape loop returns to Beats step | [docs/pipeline.md](docs/pipeline.md) |

Modes can chain (pipeline runs them in sequence) or stand alone. Beats reshape → draft re-pour is the inner loop the architecture is designed around.

## Setup (per-session vs per-blog)

**Per-session.** Read the project's CLAUDE.md and extract the optional `## Blog` section. It can carry `writing_rules`, `style_doc`, `content_driven`, `aspect_ratio`. Used by `images` mode + as defaults for `beats`/`draft`. Schema: [docs/project-config.md](docs/project-config.md). If absent, defaults apply and the skill still runs.

**Per-blog (one-time).** Each blog repo must be registered with the github plugin via `add_blog_site` before `integrate` can publish to it. Run `/blog-writer setup` once per blog. The setup mode uses `inspect_blog_repo` to auto-propose `frontmatter_defaults` (layout, author, prerender — fields constant across the site's existing posts) and `frontmatter_field_map` (e.g. `date → publishedDate` for Astro sites). Sub-doc: [docs/setup.md](docs/setup.md).

## Architecture (build internals)

Per-post container structure (Beats + Draft sibling docs), the 10-step OpenWriter call-order for building one post, and the return/output contract live in [docs/architecture.md](docs/architecture.md). Two facts ride every build:

- **Two sibling docs per post.** `Beats — <Title>` (content_type `document`) holds structure; `<Title>` (content_type `blog`) is the publishable Draft — one per container. Reshape beats → re-pour only the affected beats, never the whole post.
- **ABOUT TO CALL `switch_document` (or any view-control MCP) MID-BUILD? STOP.** The agent builds the container + Beats + Draft + metadata + images silently, targeting docs by `docId`; the user watches the activity feed and navigates themselves. Only `switch_document` on an explicit user instruction ("open the Draft", "show me the Beats").

## Firm rules

1. **Beats before draft.** Draft mode requires a locked Beats doc. No beats → run `beats` first. Pouring prose without committed beats produces shapeless drafts that need full structural rework downstream.
2. **Beats and Draft live in separate docs, always.** One container per post, two sibling docs: `Beats — <Post Title>` (content_type: document) and `<Post Title>` (content_type: blog — the publishable doc). Beats reshape → draft re-pour. Don't mix prose into the Beats doc; don't put structural commitments in the Draft doc.
3. **Title + preview + slug are B0 commitments.** Locked in the Beats doc's B0 block during `beats` mode. When `draft` mode runs: title mirrors to the Draft doc's title field via `rename_item` (the publish plugin reads title from there, not from `blogContext.title`); preview + slug mirror to `blogContext` via `set_metadata`. See [docs/titling.md](docs/titling.md). The first paragraph of the draft must echo the title — can't echo what isn't locked.
4. **Per-site voice anchor.** `draft` mode reads `voice/anchor-<site-slug>.md` where `<site-slug>` is the slugified site label from `list_blog_sites`. Silent fallback to `voice/anchor.md` if not present. Discovery is convention-based, NOT in plugin config. See [docs/voice-anchor.md](docs/voice-anchor.md).
5. **Setup before integrate.** A blog repo must be registered via `add_blog_site` before `integrate` can publish. Check `list_blog_sites` at session start — if the target repo isn't there, run `/blog-writer setup` first.
6. **Project config is optional; per-site config is canonical.** `## Blog` in CLAUDE.md is for `writing_rules`, `style_doc`, `content_driven`, `aspect_ratio`. Frontmatter shape (`layout`, `author`, `publishedDate` vs `date`, etc.) lives on the github plugin's per-site config, NOT in project config.
7. **Voice always.** Every beat pours through `/authors-voice` Apply Protocol with the site-specific anchor. The skill owns shape; voice owns diction. Per-beat dispatch is the default for `long`/`tutorial`; collapse to single dispatch for `short`/`announcement` under 1000w.
8. **Two-step doc creation.** `create_document` (spinner) → `populate_document` (content). Never inline a 30s generation into one tool call.
9. **Today's date in the doc.** Set `blogContext.date` as `YYYY-MM-DD` in the project's configured timezone (default `America/Los_Angeles`). The plugin formats / renames per site config.
10. **Accept pending decorations before publishing.** Agent-inserted images and rewrites land as pending decorations until the user accepts them in the right-rail Review tab. `post_to_blog` reads the canonical doc on disk — pending changes don't ship. After agent writes, `integrate` must tell the user "click Accept All in the right rail, then I'll publish" rather than silently posting incomplete content. See [docs/integrate.md](docs/integrate.md).
11. **Mark-sent is automatic.** After a successful `post_to_blog`, the plugin writes `blogContext.lastPublish = { publishedAt, publishedUrl, commit, file }` on the Draft doc. File tree shows a green ✓; right-click menu surfaces "View Post." Same convention as tweets / articles / newsletters.
12. **Cover image before publish.** No post `integrate`s without a cover/OG image — a gate, not optional. Design per the Convention above (placement rules + `style_doc` palette; [docs/images.md](docs/images.md) mechanics).
13. **No H1 title in the body.** The site template renders the frontmatter title above the post — a body that opens with `# <title>` shows the title TWICE on the live page. The draft body starts at the first paragraph; the title lives only on the doc title field.
14. **`blogContext.coverImage` must be a LOCAL `/_images/...` path.** A repo-relative path ("images/og/og-x.png") publishes fine but renders nothing in the OpenWriter doc — the user reviews a coverless draft. Local path → the doc shows the cover during review AND `post_to_blog` owns the copy/rename into the site's `image_dir`. If the final PNG was produced outside OpenWriter, copy it into the ACTIVE PROFILE's images dir — `~/.openwriter/profiles/<Profile>/_images/` (the root `~/.openwriter/_images/` is legacy and NOT served; the `/_images` route reads the profile dir) — and point coverImage at `/_images/<file>`.
15. **Cluster wiring at publish — every post.** If the site keeps a topical-cluster map (pillar pages + their spokes), check it before `integrate`. A post that sits inside a cluster MUST carry a contextual spoke→pillar link (varied anchor, inline — not a bare "related" footer) and be registered as a spoke in that map in the same session. If no cluster fits, say so explicitly — silent skips are how orphan posts accumulate. If you have `/seo-writer` installed (not bundled with OpenWriter), its cluster docs cover the strategy.

## Anti-patterns

- ❌ Calling `draft` without first running `beats` for the post — fails with "no Beats doc found in container"
- ❌ Calling `post_to_blog` without first running `setup` for that repo — fails with "no blog site with id X"
- ❌ Putting site-wide constants (`layout`, `author`, `prerender`) into `blogContext` instead of the site's `frontmatter_defaults`
- ❌ Calling `post_to_blog` immediately after `insert_image` without waiting for accept — pending image stays in browser overlay, doesn't ship
- ❌ Writing the blog post `.md` file directly into the target repo via Write/Edit tools — that's `post_to_blog`'s job
- ❌ Generating an image before the content is approved (image themes might shift)
- ❌ Skipping voice protocol because "the draft sounds fine"
- ❌ Mixing modes — finish one, then start the next
- ❌ Single global voice anchor when a site-specific one exists — `draft` mode reads conventionally; no opt-in required
- ❌ Reshaping beats AND re-pouring the entire draft in one pass — reshape beats first, lock them, then re-pour ONLY the affected beats
- ❌ Putting markdown syntax in `edit_text.replace` — that field is PLAIN TEXT; `[x](y)` lands as literal brackets in the doc. Links/marks via `edit_text.addMark`, or rewrite the whole node with `write_to_pad` (which DOES parse markdown)
- ❌ Opening the draft body with the post title as an H1 — the site renders the frontmatter title; you get it twice
- ❌ Setting `blogContext.coverImage` to a repo path — doc review shows no image; use a local `/_images/` path

## Scripts

- `mcp__openwriter__insert_image` — Gemini image generation directly into the active OpenWriter doc (primary path; cover via path-return + `blogContext.coverImage`)
- image-gen CLI (if installed locally) — standalone fallback for non-OpenWriter workflows
- Sharp conversion (PNG → WebP) — for projects where the target site insists on `.webp` (the github plugin copies PNGs unchanged; conversion is a project-specific concern before publish)

## Related skills

Delegated / required:
- **/authors-voice** — voice pipeline; REQUIRED for any prose generation (`draft` delegates every beat dispatch).
- **/anti-ai** — final AI-tells fingerprint scrub; recommended after a post is voice-poured.
- **openwriter** — the workspace/document MCP; REQUIRED for the doc management this skill governs.
- **/seo-writer** — optional, not bundled: SEO-strategy-led posts front-end there, then reuse this skill's publish path.

NOT covered (use your own tooling instead): project deploy pipelines · cross-channel announcements (Discord, X, etc.) · **/newsletter-writer** (different channel) · **/x-writer** (different channel) · **/book-writer** (multi-chapter books — global beat sheet, workspace management).
