# Mode: Pipeline

End-to-end blog post creation. Runs every mode in sequence with verification gates between stages.

## When to use

- User says "blog pipeline" / "full blog workflow" / "write and publish" / "new blog post end to end"
- Strategist hands off with sub-form set and angle locked — wants the whole flow autonomously

## Sequence

| Step | Mode | Action | Gate |
|---|---|---|---|
| 0 | `setup` (one-time) | Register the blog repo with the github plugin if not already | `list_blog_sites` includes target |
| 1 | `brainstorm` (optional) | Ideate topics in OpenWriter | User picks a topic |
| 2 | `beats` | Extract beat list + lock title / preview / slug | User locks the Beats doc |
| 3 | `draft` | Pour prose per-beat via `/authors-voice` with site-specific anchor | User approves the Draft doc |
| 4 | `images` | Generate cover + any inline body images | User approves images |
| 4.5 | (manual) | User accepts pending decorations in right-rail Review tab | `pending: 0` on the Draft doc |
| 5 | `integrate` | `post_to_blog` against the registered site — builds frontmatter, copies images, commits + pushes | `images_committed` matches, commit hash returned |
| 6 | (auto-deploy verify) | Wait ~1–3 min for Netlify/CF/Vercel build, then verify live URL returns HTTP 200 | HTTP 200 + visual check |

Step 0 only runs the first time the user publishes to a given repo. Step 1 is optional — skip if the user already has a locked topic.

## Entry points

Users can enter at any step:

- **"Set up my blog repo"** → Step 0
- **"Brainstorm blog topics"** → Step 1
- **"Extract beats for this post"** → Step 2
- **"Pour the draft"** → Step 3 (requires locked Beats doc)
- **"Generate a cover image"** → Step 4
- **"I have the content + image, publish"** → Step 4.5 (if pending) → Step 5
- **"Blog is ready, push it"** → Step 5
- **"Did the post land?"** → Step 6

Detect the entry point from what the user provides and what already exists in OpenWriter + the github plugin's site list.

## Step 0: Setup

If `list_blog_sites` doesn't include the target repo, hand off to [setup mode](setup.md). One-time per blog. After setup, skip to Step 1 (or further if topic is already in hand).

## Step 1: Brainstorm (optional)

Run [brainstorm mode](brainstorm.md) if the user doesn't have a topic locked. Produces a Blog Ideas doc with 3-5 candidate topics. User picks one.

**Gate:** User says "this one" — picks a topic. Skip Step 1 entirely if the user already has the topic in hand.

## Step 2: Beats

Run [beats mode](beats.md). Create per-post container, create `Beats — <Post Title>` doc, run the 3-pass or 5-pass extraction (sub-form dependent), lock title + preview + slug as B0.

**Gate:** Beats doc reads top-to-bottom as a clear flow. Title + preview + slug are committed. User explicitly approves the structure.

The beats step is where the post's shape gets locked. Don't skip it — pouring prose without committed beats produces shapeless drafts that need full structural rework downstream. The 3-pass for `short` / `announcement` is fast (5-10 min); the 5-pass for `long` / `tutorial` is the bulk of the editing work and pays for itself on every reshape.

## Step 3: Draft

Run [draft mode](draft.md). Create the `<Post Title>` sibling doc (titled with the locked title from Beats B0, `content_type: blog`), resolve voice anchor (`voice/anchor-<site-slug>.md` or fallback), pour prose beat-by-beat via `/authors-voice` Apply Protocol. Cross-beat coherence pass after all beats land. Mirror preview + slug from Beats to Draft `blogContext` (title is already on the doc title field, not blogContext).

**Gate:** User approves the draft. Iterate via the reshape loop (below) if structural issues surface. Don't proceed until they explicitly approve — image generation hangs on the final angle, and the published frontmatter freezes the description.

## Step 4: Images

Run [images mode](images.md). Read the style doc, check history, generate cover via `insert_image` + wire to `blogContext.coverImage`. Optionally generate inline images placed after specific paragraphs.

**Gate:** User approves the images. Iterate prompts until approval.

## Step 4.5: Accept pending

Tell the user: *"I've inserted N images / wrote M paragraphs. Click Accept All (or Shift+A) in the right-rail Review tab so they commit to canonical before I publish — `post_to_blog` reads the canonical doc, not the pending overlay."*

Wait for the user to confirm. Then verify:

```js
const status = await get_pad_status({ docId: draftDocId });
// or scan read_pad output for "pending: 0"
```

If still pending, prompt again. Do not proceed until clean.

**Why this matters.** `post_to_blog` reads `srv.getDocument()` which returns the on-disk canonical doc. Agent-pending decorations (inserts from `insert_image`, rewrites from `write_to_pad`) live in the in-memory overlay until accepted. Skip this step and you'll publish a post missing your latest agent writes.

## Step 5: Publish

Run [integrate mode](integrate.md):
- Find the site_id via `list_blog_sites`
- `post_to_blog({site_id, commit_message: "blog: <title>"})` against the Draft doc

**Gate:** `success: true` returned, `images_committed` count matches expectation, commit hash present.

If `images_committed` is 0 when you expected images, fall back to Step 4.5 — the user didn't accept the pending decorations.

## Step 6: Verify deploy

Most static sites auto-deploy on git push (Netlify, Cloudflare Pages, Vercel). Wait ~1–3 min for the build.

Construct the verification URL:
```
{site_url}{blog_url_pattern with slug}
```

Both fields come from the github plugin's per-site config (set during `/blog-writer setup` from `inspect_blog_repo` proposals; CNAME-derived). Defaults: assume `https://<owner>.<framework_default>/blog/<slug>/` if not configured.

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}" -L --max-time 15 "<url>"
```

For a real visual check (cover landed, tags pill correctly, inline image renders), open the URL in the user's chrome via Claude_in_Chrome MCP and screenshot.

**Gate:** HTTP 200 + visual confirmation.

For projects with a custom deploy pipeline (build server, manual approval), hand off to your project's deploy pipeline instead of waiting on auto-deploy.

## Reshape loop (inner cycle)

The reshape loop is the heart of the architecture. Beats reshape regularly during Step 3 (and sometimes Step 4 / Step 5 when reading the post in context surfaces a structural problem). The flow:

1. Author reads the Draft doc, flags "B3 doesn't land" / "B5 should come before B4" / "kill B7"
2. **Return to Step 2 (Beats)** — reshape the Beats doc (rename, reorder, drop, add)
3. **Re-run Step 3 (Draft) for affected beats only** — per-beat dispatch via `/authors-voice` with the unchanged site anchor; replace the affected paragraph in the Draft doc
4. Cross-beat coherence patch on neighbors of the reshaped beat(s)
5. Author re-reviews; loop until approved

The two-doc Beats + Draft split makes the reshape loop cheap. Each loop iteration is one Beats edit + one or two beat re-pours, not a full rewrite. If reshape iterations stack up (5+ loops on one post), STOP and reconsider — the post's premise may not be working; return to Step 1 brainstorm.

## Progress reporting

After each step, report what completed:

```
Step 0/6 - Setup: Registered RecipeBox (yourname/recipebox-website)
Step 1/6 - Brainstorm: User picked topic "Stripe Connect is a one-way door"
Step 2/6 - Beats: 12 beats locked, B0 title/preview/slug committed (Beats doc: bb4f6c46)
Step 3/6 - Draft: 12 beats poured, voice anchor voice/anchor-recipebox.md, draft approved (Draft doc: d8a1f203)
Step 4/6 - Images: Cover + 1 inline image generated, wired to blogContext
Step 4.5/6 - Accept: User accepted pending decorations
Step 5/6 - Publish: Commit 16413ed pushed to main, 2 images committed
Step 6/6 - Deploy: Live at https://recipebox.example.com/blog/weekly-meal-plans/ (HTTP 200, visual confirmed)
```

If a gate fails, stop and report what blocked.

## Output

```json
{
  "status": "draft-ready",
  "artifact": {
    "beats_doc_id": "...",
    "draft_doc_id": "...",
    "container_id": "...",
    "workspace_id": "...",
    "site_id": "<uuid>",
    "commit": "<short hash>",
    "live_url": "<verified URL>"
  },
  "next_steps": ["announce (your own channels)"],
  "notes": "Pipeline complete. Live at <url>. Ready for announcement."
}
```

If deploy hand-off is the final step (custom deploy pipeline), the pipeline returns after Step 5 with a manual-deploy note in `next_steps`.

## Anti-patterns

- ❌ Skipping Step 2 (Beats) and jumping straight to Step 3 — produces shapeless drafts; reshape loop becomes a full rewrite
- ❌ Skipping a gate ("user probably approves") — every gate is explicit confirmation
- ❌ Running steps in parallel — each step's output feeds the next
- ❌ Skipping Step 4.5 — publishes a post with stale body / missing images and you have to do it twice
- ❌ Re-pouring the entire draft when one beat reshaped (Step 3 reshape loop) — re-pour only the affected beat(s)
- ❌ Auto-deploying without explicit "push it" approval when there's a custom deploy pipeline — see global CLAUDE.md "Never Push Without Explicit Approval". (`post_to_blog` IS a push, but it's to the blog content repo, not a production deploy — for static sites with auto-deploy that's the same thing. Verify before assuming.)
