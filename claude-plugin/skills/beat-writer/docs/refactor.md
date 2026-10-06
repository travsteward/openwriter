# Refactor

How to migrate a `/beat-writer` draft into a specific channel when the destination becomes clear.

## When to refactor

The draft has been poured and polished. The operator now sees where it goes:
- "This wants to be a blog post" → `/blog-writer`
- "This is a thread" → `/x-writer`
- "This is this week's newsletter" → `/newsletter-writer`
- "This is the new pricing page hero" → `/copy-writer` (if installed — not bundled with OpenWriter)
- "This belongs in Chapter 4 / is a vignette" → `/book-writer`

OR the draft stays as a personal doc — refactor is OPTIONAL. Plenty of drafts deserve to stay drafts.

## Refactor pattern (general)

The channel-master reads the existing Beats + Draft docs and re-shapes into its own container.

```
[Project] Drafts/<Doc Name>/             (original — left in place as source)
├── Beats — <Doc Name>
└── <Doc Name>

                ↓ refactor handoff

[Project] <Channel>/<New Container>/      (new — channel-master scaffolds)
├── Beats — <New Container>               (re-shaped for the channel's tag vocabulary)
├── <New Container>                       (re-poured / restructured for the channel)
└── (channel-specific extras: images, blogContext, etc.)
```

The original draft is NOT deleted. Refactor produces a new container in the channel-master's workspace; the original stays in `[Project] Drafts` as the source. If multiple refactors happen (operator forks the draft to blog + thread), each lands in its own channel workspace.

## Per-channel refactor protocols

### → /blog-writer

1. Operator says "make this a blog post."
2. Load Beats + Draft from `[Project] Drafts/<Doc Name>/`.
3. `/blog-writer` runs its `beats` mode against the extracted material — re-tags with blog CATEGORY (CLAIM / REFRAME / MECHANISM / EVIDENCE / DEMO / SCENE / OBJECTION / APHORISM / PIVOT), adds title + preview + slug as B0 commitments.
4. `/blog-writer` runs its `draft` mode — per-beat dispatch through `/authors-voice` with the per-site anchor (if blog has one) OR operator's default anchor.
5. Polish, image, integrate per `/blog-writer`'s pipeline.

Original `[Project] Drafts/<Doc Name>/` stays untouched.

### → /x-writer

1. Operator says "thread this" or "turn this into an X article."
2. `/x-writer` reads Beats + Draft.
3. Maps to thread / article format per `/x-writer`'s progressive disclosure (Fischerian hooks, anti-performance writing, paragraph-based medium form).
4. Per-tweet / per-section polish, image generation if requested, schedule.

### → /newsletter-writer

1. Operator says "this is this week's newsletter" / "send this to the list."
2. `/newsletter-writer` scaffolds the newsletter doc with the project's newsletter structure.
3. Drops the existing draft as a section (or full body) per the newsletter's beat conventions.
4. Runs gather → review → send pipeline.

### → /copy-writer (if installed)

Not bundled with OpenWriter — skip this section if you do not have a /copy-writer skill.

1. Operator says "this is the new [page-type] copy" / "make this our homepage hero."
2. `/copy-writer` reads the existing Site Brief + the Beats doc.
3. The draft prose can seed page-level extraction (Pass 1 DUMP), but the 5-pass re-runs with copy-specific tags (PROMISE / PROOF / OBJECTION / DIFFERENTIATION / URGENCY / ANCHOR / AUTHORITY / STORY / IDENTITY).
4. New beat map per the page-type template, NEW pour with the copy-writer anchor (10-masters blend).

**Important**: `/copy-writer` uses a different VOICE ANCHOR (the masters) than `/beat-writer` (operator's personal voice). Refactor to `/copy-writer` is NOT a simple lift — the prose gets re-poured. Beats and ideas carry; words don't.

### → /book-writer

1. Operator says "this goes in chapter N" or "this is a vignette for the book."
2. `/book-writer` reads Beats + Draft.
3. Slots the material into the appropriate Chapter container or Vignette library doc.
4. Re-runs beat methodology at chapter scope if material extends beyond a single beat.

## What carries vs what changes (refactor truth table)

| Element | Carries to refactor target | Changes per channel |
|---|---|---|
| Source ideas (DUMP material) | YES | — |
| Beat outcomes (commitments) | YES | Re-categorized per channel tags |
| Beat sequence | PARTIALLY | Re-sequenced per channel flow |
| Prose | YES (for `/blog-writer`, `/newsletter-writer`, `/book-writer`, `/x-writer` — same operator anchor) | NO for `/copy-writer` (re-poured in masters anchor) |
| Voice anchor | YES for personal-voice channels | NO for `/copy-writer` (uses masters anchor) |
| Length / density | LOOSE | Re-shaped per channel's natural form |

## When NOT to refactor

- **Draft is for personal use** — journal, note-to-self, working memo → leave in Drafts
- **Draft is exploratory thinking that didn't crystallize** → archive or delete
- **Draft fits multiple channels equally well** → pick one OR fork (run two refactors, kill the weaker output later)

Refactor is optional. The whole point of `/beat-writer` is to let the operator write before they commit to a channel.

## After refactor

The operator can:
- Keep both the original draft (in Drafts) AND the channel-shaped version (in the channel workspace) — useful for "show your work" or for forking later to a second channel
- Archive the original draft if the channel version supersedes it
- Delete the original if it was purely a scratch / exploration

Channel-master skills don't auto-delete the source draft. That's an operator decision.
