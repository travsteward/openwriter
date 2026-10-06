# Mode: Draft

Pour prose against a locked Beats doc. Each beat dispatches to `/authors-voice` with the site-specific voice anchor. Output: the `<Post Title>` sibling doc (content_type: blog) in the post's container — the publishable doc.

## When to use

- User says "draft this post" / "write the draft" / "pour the beats" / "blog draft"
- `beats` mode just locked → handoff calls into here
- Author reshaped a beat in the Beats doc and wants the corresponding draft section re-poured
- Strategist provided a brief with locked beats + site_id

## Hard prereq: Beats doc must be locked

Draft mode does NOT extract beats. If there's no `Beats — <Post Title>` doc with a locked beat list and B0 (title + preview + slug) block, **STOP** and run `/blog-writer beats` first.

Pouring prose without committed beats produces shapeless drafts that need full structural rework downstream — cheaper to commit the beats first.

Signs the beats aren't locked:
- Beat names are categorical ("THE HOOK," "THE MECHANISM") instead of declarative claims
- No word targets on beats
- Title / preview / slug not yet in the B0 block
- Beats doc has prose in it instead of outcome commitments

Hand back to `beats` mode for any of those.

## Workflow

### Step 1: Resolve inputs

Gather:

1. **Beats doc id** — from session context or by `search_docs` for `Beats — <Post Title>`
2. **Per-post container id** — read the Beats doc's parent container
3. **Sub-form** — read from Beats doc frontmatter (short / announcement / long / tutorial)
4. **Site_id + label** — read from Beats doc frontmatter (`site_id`) or `list_blog_sites` if user names the site
5. **Voice anchor path** — compute slug from site label, check `voice/anchor-<site-slug>.md`, fallback to `voice/anchor.md` (see [voice-anchor.md](voice-anchor.md))

If site isn't resolved, prompt user once with a list from `list_blog_sites`. Don't guess.

### Step 2: Create or open the Draft doc

The Draft doc's title IS the published title — name it directly as the locked title from Beats B0, no prefix:

```js
// New draft (use the locked title from Beats B0 verbatim):
create_document({
  title: "<locked title from Beats B0>",
  container_id: "<per-post container>",
  content_type: "blog"
})

// Then populate as a stub (empty body — beats pour later):
populate_document({
  docId: draftDocId,
  content: ""
})
```

If a Draft doc already exists in the container (reshape case), use that one — don't create a sibling duplicate. Recognize it by: `content_type: blog` inside the post's container (only one such doc per container).

### Step 3: Mirror preview + slug + date to the Draft's blogContext

Title is already on the doc's title field from Step 2. Mirror the rest of the B0 commitments + boilerplate:

```js
set_metadata({
  docId: draftDocId,
  metadata: {
    blogContext: {
      active: true,
      description: "<from Beats B0, 140-160 char>",
      slug: "<from Beats B0>",
      date: "<YYYY-MM-DD>",         // today in project timezone
      tags: ["<from Beats frontmatter>"]
      // coverImage / coverImageAlt set later by images mode
    }
  }
})
```

Title is NOT set on blogContext — the publish plugin reads title from the doc title, not blogContext.title. See [titling.md](titling.md) for the reasoning.

If the user reshapes title / preview / slug in the Beats doc post-draft, re-mirror on the next pour. Title reshape: `rename_item({ docId: draftDocId, name: "<new title>" })`. Preview / slug reshape: `set_metadata` again.

### Step 4: Pour prose, beat by beat

For each beat in the Beats doc (in sequence):

1. Build the dispatch brief:

```js
{
  task: "<beat outcome paragraph from Beats doc, verbatim>",
  voice_anchor_path: "voice/anchor-<site-slug>.md",
  voice_anchor_fallback: "voice/anchor.md",
  must_appear: [
    "<author-unique phrases from beat>",
    "<callbacks to prior beats>"
  ],
  word_target: "<beat word target from Beats doc>",
  prior_beats: [
    "<one-sentence summary of each beat already poured, in order>"
  ],
  beat_number: "B3",
  beat_name: "MIGRATION TAKES THREE COMMANDS",
  category: "MECHANISM"   // from beat's category tag
}
```

2. Delegate to `/authors-voice` Apply Protocol with the brief as the TASK
3. Receive voice-matched prose
4. Append to the Draft doc as a new paragraph block, tagged with the beat number for the reshape loop

5. Update `prior_beats` summary for the next dispatch

**Dispatch granularity:**

| sub_form | Dispatch strategy |
|---|---|
| `short` (3-5 beats, <1000w total) | Single dispatch — all beats listed as commitments in one brief |
| `announcement` (3-6 beats, <1200w total) | Single dispatch if <1000w; per-beat if heavier |
| `long` (8-15 beats, 1500-3000w total) | Per-beat dispatch |
| `tutorial` (8-12 beats, 1500-2500w total) | Per-beat dispatch; code blocks land as part of the relevant beat |

Per-beat dispatch protects voice quality — a long, multi-claim brief collapses density across the post. The book-writer empirical lock (one beat = one dispatch produces gold prose; multi-beat dispatches collapse) applies at blog scale too.

### Step 5: Cross-beat coherence pass

After all beats have poured:

1. Read the full Draft doc
2. Check transitions between beats — does B3 close the question B2 opened? Does B4 open a question B5 answers?
3. Check the open/close loop — does the final beat's payoff close the tension the title + B1 opened?
4. Check for repetition — did two beats land the same claim with different prose?
5. Patch transitions or duplications via `/authors-voice` minion calls (small targeted dispatches), not by rewriting

If the coherence pass surfaces a structural problem (a missing beat, an out-of-order beat), STOP. Don't patch in prose. Return to `beats` mode, reshape, re-pour the affected beats.

### Step 6: Date handling

Set `blogContext.date` to today in the project's configured timezone (default: `America/Los_Angeles`). Format: `YYYY-MM-DD`. The publish plugin formats / renames per site config (`date → publishedDate` for Astro sites).

### Step 7: Output

```json
{
  "status": "draft-ready",
  "artifact": {
    "draft_doc_id": "<draft doc>",
    "beats_doc_id": "<beats doc>",
    "container_id": "<per-post container>",
    "workspace_id": "...",
    "site_id": "<site uuid>",
    "voice_anchor_used": "voice/anchor-recipebox.md"
  },
  "next_steps": ["/blog-writer images", "/blog-writer integrate"],
  "notes": "Draft poured, N beats integrated, voice-anchored to <site-label>. User should review in OpenWriter and Accept All before integrate."
}
```

## Reshape loop

When the author reshapes a beat in the Beats doc, draft mode re-pours ONLY the affected beat(s), not the whole post.

Flow:

1. Author edits B5 in the Beats doc (renames the claim, swaps the category, adjusts word target)
2. User says "re-pour B5" or "redraft B5"
3. Draft mode reads the new B5 commitment, builds a dispatch brief with `prior_beats` reflecting B1-B4 from the existing Draft
4. Single `/authors-voice` dispatch
5. Replace B5's paragraph in the Draft doc (find by beat-number tag from Step 4 of original pour)
6. Re-run cross-beat coherence on neighbors (B4 → B5 transition, B5 → B6 transition); patch transitions if needed

If the author reshapes B5 AND inserts a new B6 between old B6 (now B7), re-pour B6 and re-pour the new B7. Don't re-pour B1-B4 or B8+.

If multiple beats reshape in a single editing session, batch the re-pours but keep them per-beat — don't collapse into a multi-beat dispatch.

## Voice composition

Every beat pour runs through `/authors-voice`. Two paths:

- **Preferred:** `/authors-voice` Apply Protocol via Skill invocation. Reads the site-specific anchor, runs the minion, returns voice-matched prose, runs post-write audit (NEVER patches, fingerprint check). This is the spec.
- **Fallback for non-OpenWriter workflows:** OpenWriter's built-in Author's Voice "Enhance" plugin — API-backed, full corpus RAG. Operates on the Draft doc directly after a non-voice draft pour. Use only when running the skill standalone outside the per-beat dispatch flow.

The voice layer eliminates AI tells, enforces register, locks down diction. The drafting skill owns SHAPE; voice owns VOICE.

## What lives where (per-post container layout)

```
<Post Title>/                              (container — named after the post)
├── Beats — <Post Title>                   (beats mode output — content_type: document)
├── <Post Title>                           (THIS doc — the publishable post — content_type: blog)
└── Sources — <Post Title>                 (optional — content_type: document)
```

The Draft doc's TITLE is the post's locked title (no prefix). That's what the publish plugin reads as the published title.

The Beats and Sources docs are visually distinguished by the `Beats — ` / `Sources — ` prefix, and structurally distinguished by their `content_type` (anything other than `blog`). The Draft doc is identified inside the container by `content_type: blog` — the only such doc per container.

Beats and Draft are SEPARATE docs by firm rule. Beats reshape doesn't touch Draft directly; only this mode re-pours the affected sections.

Sources doc is optional — most posts let the model's training data carry the examples. Build a Sources doc only when (a) post cites specific URLs / papers / quotes the author wants pinned, (b) topic is post-training-cutoff (recent data the model can't be trusted on), or (c) author wants Smith 2019 specifically, not Jones 2020.

## Anti-patterns

- ❌ Pouring prose without locked beats. Run `beats` mode first.
- ❌ Pouring all beats in one mega-dispatch for `long` posts. Voice density collapses across multi-beat dispatches.
- ❌ Writing prose into the Beats doc instead of the Draft doc. The two-doc split is load-bearing.
- ❌ Re-pouring the whole draft when one beat reshaped. Re-pour the affected beat only.
- ❌ Using a single global voice anchor when a site-specific one exists. Read [voice-anchor.md](voice-anchor.md) — discovery is conventional, not opt-in.
- ❌ Writing `---\nfrontmatter\n---` into the Draft doc body. Use `set_metadata({blogContext})`.
- ❌ Site-wide constants (`layout`, `author`, `prerender`) in `blogContext`. Those live on the site's `frontmatter_defaults` (set during `/blog-writer setup`).
- ❌ Generating images mid-draft. Images come AFTER draft is approved — the visual concept depends on the locked angle.
- ❌ Skipping the cross-beat coherence pass. The post reads as a sequence; verify the sequence lands before declaring done.
- ❌ Patching a structural problem with prose. Structural problems return to `beats` mode.
