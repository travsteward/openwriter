# Per-Site Voice Anchor

Each blog site can have its own voice anchor. A `/blog-writer draft` pour reads the site-specific anchor first; if none exists it falls back silently to the global default.

This file documents the discovery convention. The actual voice machinery (anchor blend, NEVER rules, fingerprint, minion dispatch) lives in `/authors-voice` — this doc is just the path lookup blog-writer performs before delegating.

## Why per-site anchors

Different blogs speak different voices. The same author writes RecipeBox posts in a sharp, founder-direct register and a personal essay blog in a slower, reflective register. Forcing both through one anchor produces homogenized prose that doesn't land on either site.

A per-site anchor lets the blend shift by site without rewriting the global default for the whole writing practice.

## Discovery convention

When `draft` mode is about to delegate to `/authors-voice`, it looks up the anchor file in this order:

1. **Site-specific anchor** — `~/.claude/skills/authors-voice/voice/anchor-<site-slug>.md`
2. **Global default** — `~/.claude/skills/authors-voice/voice/anchor.md`

The `<site-slug>` is the registered site's `label` (from `list_blog_sites`) run through this slug rule:

- Lowercase
- Replace any non-`[a-z0-9]` run with a single hyphen
- Strip leading/trailing hyphens

Examples:

| Site label | Anchor path |
|---|---|
| `RecipeBox` | `voice/anchor-recipebox.md` |
| `OpenWriter` | `voice/anchor-openwriter.md` |
| `Foo & Bar` | `voice/anchor-foo-bar.md` |

Silent fallback: if the site-specific file doesn't exist, draft mode uses `anchor.md` and prints a single line to the user — `voice: using default anchor (no anchor-<slug>.md found)`. Don't block, don't prompt — just inform.

## File shape

Anchor files match the existing `/authors-voice` convention. Minimum viable anchor is a 5-line author blend (sums to 100%):

```
- 30% Bill Bryson
- 25% Mary Roach
- 20% Atul Gawande
- 15% Oliver Sacks
- 10% Malcolm Gladwell
```

`/authors-voice` reads this blend and constructs the voice prompt for the minion. The blend is the load-bearing part; everything else (NEVER rules, fingerprint, coined terms) is optional and lives in `/authors-voice` companion docs (`anchor-analysis.md`, `never-rules.md`, etc.).

For a site-specific anchor, you can also create a matching analysis doc:

- `voice/anchor-<site-slug>.md` — the blend (required)
- `voice/anchor-<site-slug>-analysis.md` — the deep voice analysis (optional; produced by `/authors-voice` corpus analysis)

The analysis doc carries the site-specific fingerprint (sentence stats, diction tells, register notes, coined-term inventory). Build it AFTER you have a few posts from that site in the corpus.

## When to build a site-specific anchor

Build one when ANY of these conditions hold:

1. **The site's existing posts read in a distinctly different register from your default voice.** Founder blog vs craft blog vs marketing blog — all yours, all different.
2. **You've drafted 3+ posts for the site through the default anchor and consistently had to voice-tune them post-pour.** Tuning means the default is wrong for this site. Bake the fix into a site-specific anchor.
3. **The site has a co-author or guest contributors whose voice you want to preserve.** Different anchor per author within the same site is possible — name them `anchor-<site-slug>-<author-slug>.md` and pass the author override into the dispatch brief.

Don't build one for sites you haven't published on yet. The default is fine until you have evidence of mismatch.

## How `draft` mode uses the anchor

When `draft` mode pours prose, it builds a dispatch brief and hands it to `/authors-voice` Apply Protocol. The brief carries:

```js
{
  task: "<beat outcome commitment, verbatim from Beats doc>",
  voice_anchor_path: "voice/anchor-recipebox.md",   // or anchor.md fallback
  voice_anchor_fallback: "voice/anchor.md",
  must_appear: ["<author-unique phrases>", "<callbacks>"],
  word_target: "<beat word count>",
  prior_beats: ["<beats already drafted, in order>"]
}
```

`/authors-voice` reads the anchor file, constructs the voice prompt, runs the minion, returns voice-matched prose. Blog-writer integrates the result into the Draft doc.

If the site-specific anchor exists but `/authors-voice` reports it's malformed (no blend, wrong percentages summing to non-100%, etc.), draft mode falls back to default and surfaces the error to the user. Don't block — broken anchors shouldn't stop publishing.

## Bootstrapping a site-specific anchor

The fastest path:

1. Run `/blog-writer setup` for the site (gets the label, generates the slug)
2. Copy `voice/anchor.md` to `voice/anchor-<site-slug>.md`
3. Edit the blend — adjust percentages, swap authors, until the blend matches how the site's existing posts read
4. Optional: feed the site's existing posts into `/authors-voice` corpus analysis to produce a matching `anchor-<site-slug>-analysis.md`

Then draft. The first 2-3 posts will reveal whether the blend is right; tune percentages until the voice lands consistently.

## Anti-patterns

- ❌ Putting voice anchor paths into the github plugin's per-site config. Voice paths are an authors-voice concern, not a publish-plugin concern. Discovery is convention-based, not config-coupled.
- ❌ Hardcoding the site slug somewhere in the skill instead of computing from `label`. Sites get renamed; the slug is a runtime derivation.
- ❌ Blocking the draft when no site-specific anchor exists. Silent fallback to default, one-line notice, proceed.
- ❌ Building a site-specific anchor before publishing 3+ posts there. Premature anchor = optimized for the wrong target.
- ❌ One mega-anchor that tries to cover every site. The blend is load-bearing; covering N sites in one anchor blurs all of them.
