# Title + Preview + Slug — B0 commitments

Title, preview text (meta description), and slug are the THREE commitments locked before any prose pours. They're B0 in the Beats doc — the load-bearing beats that determine whether the post gets read at all.

## Why these three are one unit

A post has two moments of decision before the reader commits:

1. **The link surface** — title + preview shown on a feed, a search result, a social share, an RSS reader. ~3 seconds of attention. Click or scroll past.
2. **The first paragraph** — opens after click. ~10 seconds of attention. Keep reading or bounce.

Title + preview own moment 1. The Hook beats (B1-B2) own moment 2. If moment 1 fails the rest is dead. Lock title + preview before drafting because the draft must DELIVER what they promise — work backward from the click.

The slug is the URL surface — it shapes what links look like in feeds, mentions, citations. It also affects search ranking and shareability. It's locked at the same time so the published URL doesn't get reshaped after publication (URL changes break inbound links).

## Title conventions

### Format

- **50-70 characters** (Google cuts off display title around 60; some platforms push 70)
- **Sentence case** by default, Title Case if the site convention demands it (check existing posts)
- **No trailing period** (titles aren't sentences)
- **No emoji** unless the site's existing posts use them consistently
- **No subtitle/colon split** unless the site convention demands it ("Topic: Detail" is fine; gratuitous colons are not)

### What makes a title land

Run the title through these tests — if it fails any one, rewrite:

1. **Specificity test.** Does the title name a specific claim, mechanism, outcome, or person? "How we built X" beats "Lessons from our build." "Why Meal planning is a one-way door" beats "Choosing a payment processor."
2. **Promise test.** Does the title tell the reader what they GET from reading? Information, a framework, a reframe, a warning, a story. If the title is a vague gesture ("Thoughts on payments"), it makes no promise.
3. **Curiosity-gap test.** Does the title hint at a tension or reveal without resolving it? "Meal planning is a one-way door" — gap: WHY is it one-way? "We migrated 500 customers in three days" — gap: HOW?
4. **First-sentence test.** Could the title be the first sentence of a Tweet that lands? If yes, it's punchy enough. If it reads like a chapter heading from a textbook, it's not.
5. **Search-snippet test.** Imagine the title in a Google result with a 160-char description below it. Would someone scrolling click THIS one over the four others on the page? If no, sharper.

### Title patterns that work

| Pattern | Example | When |
|---|---|---|
| Declarative claim | "Meal planning is a one-way door" | Opinion, contrarian, reframe |
| Specific outcome | "We migrated 500 customers in three days" | Announcement, case study |
| Counter-intuitive | "Why our slowest feature is our best one" | Reframe, deep dive |
| How-to (specific) | "How to ship a Stripe Connect migration without downtime" | Tutorial, framework |
| Number + payoff | "Three reasons your auth flow is leaking conversions" | Listicle (use sparingly) |
| Question (load-bearing) | "Should you self-host or use Connect?" | Decision-frame post |
| Lived-scene anchor | "The day we deleted our payment retry queue" | Story-driven post |

### Title patterns that don't work

- ❌ "Some thoughts on X" — promises nothing
- ❌ "X 101" — generic, signals beginner content even when the post isn't
- ❌ "Why X matters" — abstract, vague stakes
- ❌ "The future of X" — speculative without grounding
- ❌ "X: the complete guide" — overpromises unless the post is genuinely complete
- ❌ Any title that starts "Introducing..." (except for hard product announcements, and even then it's weak)

### Per-site title voice

Different blogs have different title postures. The site's voice anchor (`voice/anchor-<site_id>.md`) can carry a title-style line that shapes the posture:

- **Technical blog:** keyword-forward, scannable, declarative — "Meal planning is a one-way door"
- **Opinion blog:** provocative, claim-first — "Your auth flow is the bottleneck, not your API"
- **Tutorial blog:** outcome-first, how-to — "Ship a Connect migration in three days"
- **Founder/personal blog:** voice-forward, conversational — "The day we deleted our payment retry queue"

When drafting titles, check the existing posts on the site. Match the register; don't import a tone the site doesn't speak.

## Preview text (meta description) conventions

The preview text is what shows up:
- Under the title in Google search results
- In the share card when the URL is pasted into Slack / Discord / iMessage
- In the RSS reader summary
- In the OG card on social platforms (fallback if no custom OG description)

It's set on `blogContext.description` and lands in the published frontmatter (`description: `, or whatever field the site's `frontmatter_field_map` renames it to).

### Format

- **140-160 characters** (Google truncates around 155-160; staying under 160 avoids the "..." cutoff)
- **One or two sentences max**
- **Complete sentences** — preview text is read; it's not a tagline
- **First-person or second-person** matching the site's voice
- **No trailing period IF it's a single fragment; otherwise punctuate normally**
- **No quotation marks** (they don't render well in search snippets)
- **Don't restate the title verbatim** — the title is already shown above

### What makes a preview land

The preview earns the click the title started. Two patterns work:

1. **Extend the curiosity gap.** Title plants the tension; preview deepens it without resolving. *Title: "Meal planning is a one-way door." Preview: "Three months in, here's what we learned about why most platforms can't migrate off Connect — and the one architecture choice that gives you an out."*
2. **Promise the payoff.** Title makes a claim; preview names what the reader walks away with. *Title: "How to ship a Stripe Connect migration without downtime." Preview: "The exact runbook we used to migrate 500 customers in three days. Zero charge failures, zero rollbacks, two engineers."*

### Anti-patterns

- ❌ Restating the title — wasted real estate
- ❌ "In this post, we'll discuss..." — meta-narration, no value
- ❌ Single-keyword stuffing — sounds like SEO spam
- ❌ Question without payoff — "Have you ever wondered about X?" is filler
- ❌ Over-160 chars — the cut-off mid-sentence kills the click
- ❌ All-caps shouting — reads as a banner, not a description

### The preview test

Read the title and preview as a pair, as if they're showing up in a Google result you didn't write. If you'd click it, ship it. If you'd scroll past, rewrite.

## Slug conventions

The slug is the URL-safe filename portion of the post's URL. The published URL is `{site_url}{blog_url_pattern with slug}` — e.g. `https://example.com/blog/weekly-meal-plans/`.

### Format

- **Lowercase only**
- **Hyphen-separated** (never underscores — hyphens are the search-engine convention)
- **2-5 words** (shorter is better; long slugs get truncated in shares)
- **Keyword-forward** — first word should carry the search intent
- **No stop words** unless required for meaning — drop "the," "a," "of" when removable
- **No dates** — let the site's `blog_url_pattern` add a date prefix if the site convention requires it
- **No file extensions** — `.md`/`.mdx` is added by the publish plugin
- **ASCII only** — no accented characters or non-Latin glyphs (some routers strip them silently)

### Slug ↔ title relationship

The slug is usually a compressed form of the title:

| Title | Slug |
|---|---|
| Meal planning is a one-way door | `meal-planning-one-way-door` |
| We migrated 500 customers in three days | `migrated-500-customers-three-days` |
| How to ship a Connect migration without downtime | `connect-migration-without-downtime` |
| The day we deleted our payment retry queue | `deleted-payment-retry-queue` |

Drop articles ("the," "a," "is"), drop personal pronouns ("we," "our") unless they're load-bearing, keep the substantive nouns and verbs.

### Slug stability

**Once published, the slug NEVER changes.** Changing it breaks every inbound link — feeds, social shares, citations, the "View Post" link the openwriter doc keeps. If you regret a slug after publish, the move is to publish a NEW post with the corrected slug and 301-redirect the old one (handled at the site level, not by this skill).

If the draft is unpublished and the slug needs to change, fine — just confirm with the user before re-locking.

### Slug uniqueness

The slug must be unique within the site's `content_dir`. The publish plugin will error or overwrite if it collides — check `inspect_blog_repo` output or `gh` for existing slugs before locking a new one. If the desired slug is taken, add a disambiguator: `weekly-meal-plans-2026`, or rephrase.

## Locking the three to the Draft doc

When title + preview + slug are locked in the Beats doc B0 block, mirror them onto the Draft doc — **title via `rename_item`, preview + slug via `set_metadata` → `blogContext`**. The publish plugin reads title from the doc's actual title field, not `blogContext.title`.

```js
// Title goes on the DRAFT doc's title field (NOT blogContext).
rename_item({ docId: draftDocId, name: "<locked title>" })

// Preview + slug + the rest go on blogContext.
set_metadata({
  docId: draftDocId,
  metadata: {
    blogContext: {
      active: true,
      description: "<locked preview, 140-160 char>",
      slug: "<locked-slug>",
      date: "<YYYY-MM-DD>",
      tags: ["<category1>", "<category2>"]
      // coverImage / coverImageAlt set later by images mode
    }
  }
})
```

Why title-via-doc-title: the publish plugin treats the OpenWriter doc title as the canonical published title. `blogContext.title` is ignored (intentionally — keeps the title surface single-sourced for direct editing in OpenWriter's title bar). Don't set both — set the doc title.

The Beats doc keeps the B0 block as the canonical authored copy of the three commitments; the Draft doc's title field + blogContext is the publish-ready copy. They stay in sync because reshape passes update both surfaces.

The BlogComposeView UI also surfaces these as form fields — if the user wants to edit by hand mid-cycle, point them there and re-read the doc title + metadata before re-pouring.

## Workflow

The `beats` mode handles title + preview + slug as part of the Beats doc lock:

1. Author drafts the beat list via the 3-pass or 5-pass
2. Editor proposes 2-3 title candidates that name the post's load-bearing claim
3. Author picks / sharpens — one locked title
4. Editor drafts 2 preview candidates (curiosity-gap and payoff-promise patterns)
5. Author picks / sharpens — one locked preview
6. Editor proposes the slug compressed from the locked title; author confirms or sharpens
7. Mirror to `blogContext` via `set_metadata`

If the title is reshaped post-draft, re-check the preview (it might still serve), and the slug stays (post is already published OR not yet published — author decides).

## Anti-patterns

- ❌ Drafting prose before title + preview are locked. The first paragraph of the draft should ECHO the title; can't echo what isn't locked.
- ❌ Treating title as decoration. It's the load-bearing B0 commitment — the post's whole point reduced to one line.
- ❌ Letting the preview be "the first 160 characters of the post." That's a fallback for sites that don't author meta descriptions; for hand-authored posts it wastes the slot.
- ❌ Slug-as-afterthought. The slug is the URL — author it deliberately.
- ❌ Renaming the slug after publish without a redirect plan. Breaks every inbound link.
- ❌ Stuffing keywords into title or preview ("Stripe Connect migration tutorial 2026 step-by-step guide"). SEO theater, not SEO.
