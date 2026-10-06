---
name: beat-writer
description: |
  Channel-agnostic writer for any piece of content that doesn't yet belong
  to a specific channel. Use when you have something to say but don't know
  where it goes — could become a blog post, X thread, newsletter section,
  web copy, journal entry, or just stay as a plain doc. Runs the beat
  extraction + shaping discipline, pours prose via /authors-voice (with
  the operator's default anchor — personal voice), polishes, and leaves
  a clean draft in OpenWriter. The draft can later be refactored into a
  specific channel via /blog-writer, /x-writer, or /newsletter-writer.

  Use when: "/beat-writer", "write this", "draft something", "I have an
  idea but don't know where", "extract beats", "write me a draft",
  "pour this in voice", "I want to think this through in writing",
  "plain doc", "just open a doc", "uncommitted draft", "I'll figure out
  where it goes later".

  NOT for: known-channel work (use the channel-master directly —
  /blog-writer for blogs, /x-writer for tweets, /newsletter-writer for
  emails, /book-writer for chapters).

  Requires: OpenWriter MCP server configured + /authors-voice set up
  with at least Tier 1 anchor.
metadata:
  author: travsteward
  version: "0.1.1"
license: MIT
---

# Beat Writer

Channel-agnostic, beats-first writer for uncommitted drafts. Owns extraction + shaping; delegates prose to `/authors-voice` (operator's default anchor — personal voice). Output is a plain OpenWriter doc that can stay generic OR get refactored later into a specific channel via a channel-master writer.

**4-layer model:**

1. **EXTRACT** — pull beats out of the operator. Same query-first, 5-pass discipline used by `/book-writer`. Channel-agnostic CATEGORY tags (CLAIM / REFRAME / MECHANISM / EVIDENCE / STORY / APHORISM / PIVOT / OBJECTION). `docs/extraction.md`
2. **SHAPE** — order beats by reader flow, lock as commitments (no content prescription). No channel template — just a sequenced beats list. `docs/beat-method.md`
3. **VOICE** — `/authors-voice` Apply Protocol with the operator's DEFAULT anchor (personal voice). Same machinery as every other writer; no anchor swap. The piece sounds like the operator.
4. **POLISH** — `/polish` to 90/100, then `/anti-ai`, then a naive-reader pass. Delegated, not duplicated.

## Firm rules

1. **Single entry point.** Invoked as `/beat-writer` only. No subcommands, no flag-syntax args. Internal dispatch from context.

2. **EXTRACT before WRITE.** Same query-first discipline as `/book-writer`. AI never invents beats; the operator's head is the source.

3. **Beats are commitments, not content.** Each beat names the OUTCOME (what the reader registers / what shift lands). The voice layer brings the words.

4. **No channel template.** This skill deliberately does NOT impose a page structure, thread shape, post format, or chapter container. The draft is shapeless-by-design (just a sequenced beat list) so any channel-master can later re-shape it.

5. **Voice = `/authors-voice` Apply Protocol with operator's DEFAULT anchor.** Same machine, default fuel. The piece sounds like the operator. Editor never writes prose directly; every pour is a minion dispatch. Same Rule 1 as `/authors-voice`.

6. **OpenWriter is the writing surface.** One container per draft; Beats doc + Draft doc inside (same convention as `/blog-writer`). Workspace: `[Project] Drafts` (or reuse the operator's existing writing workspace if present).

7. **Refactor is optional.** When a draft's destination becomes obvious, hand off to the appropriate channel-master (`/blog-writer`, `/x-writer`, `/newsletter-writer`, `/book-writer`). Refactor doesn't move the draft; the channel-master reads the Beats + Draft docs and re-shapes into its own container. See `docs/refactor.md`.

8. **Polish is delegated.** `/polish` → `/anti-ai`. Do not duplicate their logic.

## Architecture

```
beat-writer/
├── SKILL.md                          (this file — router + firm rules + 4-layer model)
└── docs/                             (loaded on routing match)
    ├── extraction.md                 (5-pass — channel-agnostic CATEGORY tags)
    ├── beat-method.md                (beat = type + job + slot; commitments-not-content)
    ├── pipeline.md                   (extract → write → polish → anti-ai)
    ├── openwriter-surface.md         (Drafts workspace + container + Beats/Draft doc pattern)
    └── refactor.md                   (handoff to /blog-writer, /x-writer, /newsletter-writer, /book-writer)
```

## Routing

| User intent | Action |
|---|---|
| "/beat-writer" with no context | Ask ONE clarifying question: what are we writing about? |
| "draft something about X" / "write this" | Extract → shape → voice → polish |
| "I have this idea: [seed]" | Operator's dump = seed → 5-pass extraction → shape → write |
| "extract beats from [topic]" | Pass 1–5 only — no draft pour |
| "pour these beats: [list]" | Skip extraction; load beats; voice pour via /authors-voice |
| "polish this draft" | Skip extraction + write; run polish/anti-ai only |
| "make this into a blog/tweet/newsletter/page" | Refactor handoff — load draft + Beats, route to channel-master per `docs/refactor.md` |

## Output contract

```json
{
  "status": "draft-ready" | "needs-input" | "blocked",
  "artifact": { "doc_id": "...", "workspace_id": "...", "container_id": "..." },
  "next_steps": ["polish", "anti-ai", "refactor-to-<channel>", "publish-via-channel-master"],
  "notes": "<optional>"
}
```

## Companion skills

- **/authors-voice** — REQUIRED. Every prose pour delegates to its Apply Protocol with operator's default anchor.
- **/polish** — REQUIRED for the 90/100 push.
- **/anti-ai** — final fingerprint scrub after polish.
- **openwriter** — REQUIRED. Beats + Draft docs live here.
- **/blog-writer / /x-writer / /newsletter-writer / /book-writer** — refactor targets when the draft's destination becomes clear.

## What this skill does NOT cover

- **Channel-specific shape** — page templates, thread structure, blog post layout, email scaffolds, chapter containers. Those belong to channel-masters.
- **Channel-specific constraints** — character budgets per slot. Use `/x-writer` for tweet/article budgets.
- **Voice machinery** — `/authors-voice` owns Apply Protocol, NEVER-rule patching, fingerprint audit, blinder audit.
- **Personal-voice setup** — `/authors-voice` owns anchor setup, NEVER rules, fingerprints, corpus analysis.
- **Publishing** — channel-master skills own publish mechanics.

## When to skip this skill

- Known channel from the start — use the channel-master directly (`/blog-writer`, `/x-writer`, etc.)
- Single-paragraph or one-liner — `/authors-voice` directly is faster
- Pure ideation (no draft target) — talk it out, don't formalize it
- Polish-only on existing prose — `/polish` directly
