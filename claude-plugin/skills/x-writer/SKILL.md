---
name: x-writer
description: |
  Writing format, image generation, and pipeline for X (Twitter) content.
  Paragraph-based medium form, Fischerian Hooks, anti-performance writing.
  Progressive disclosure: article format scoring, thread/article images,
  comic strip generation, full brainstorm→polish→schedule pipeline.
  Built for use with OpenWriter.

  Use when: "/x-writer", "write for x", "x post format", "write this tweet",
  "format this post", "how should I write this", "format article",
  "evaluate article", "optimize article", "article image", "article cover",
  "thread images", "comic strip", "x comics", "comic panels", "generate panels",
  "polish tweet", "draft tweets", "write tweets", "write in my voice",
  "schedule tweet"
metadata:
  author: travsteward
  version: "0.3.0"
license: MIT
---

# X Writer

The writing format for X content. This skill defines HOW to write — not WHAT to write about. Apply these patterns to all tweets, threads, quote tweets, and replies.

## [!OUTPUT-DISCIPLINE] — proactive fire, non-negotiable

Two conventions the user should NEVER have to ask for. Violating either is a process failure.

1. **PROSE LIVES IN THE EDITOR, NOT IN CHAT.** Every draft, rewrite, and revision goes into the OpenWriter doc as pending changes. **NEVER dump or re-paste the full prose in chat** — not on first write, not after edits, not "so you can see it." Chat is for discussion, scoring, and what-changed summaries ONLY. If you're about to paste paragraphs of the post into chat, STOP — write them to the doc instead.

2. **ALWAYS EMIT THE CLICKABLE LINK when you cite a doc.** The instant you reference a docId, call `mcp__openwriter__get_doc_link` and emit `[open](url)`. The user should never have to say "link please." Cite a docId → link it, same message.

**Editing-vs-generation boundary (Author's Voice trigger):** on a near-final dump, WRITE = light copy-edit of the user's words only (run-ons, typos, dropped words). The moment you cross into rephrasing, restructuring, or supplying new prose, that is NOT yours to write — route it through `/authors-voice`. Speaking for the user in your own register is a mistake; if generation is needed, call Author's Voice. (See [!QT-WORKFLOW] Step 4.)

## Core Philosophy

**The line-by-line style is dead.** Broken up, one-sentence-per-line writing signals EFFORT. It says "I am trying to get your attention." People see through it. They turn off. The pithy fragment style is the format of engagement farmers, not thinkers.

**We write in paragraphs.** Clean, flowing, natural paragraphs. Like a smart person talking to you, not a copywriter performing for you. The authority comes from the IDEAS, not the formatting tricks.

## The Fischerian Hook

Named after Fischer King (@FischerKing64), who demonstrates the pattern naturally.

**The first sentence of every paragraph is the hook.** It's a strong, declarative statement that pulls the reader in. Not a question. Not a teaser. A position.

Examples from Fischer King:

> "The worst part about people in white collar professions claiming they work '80-100 hours a week' is that they are all liars."

> "Every living President is watching Trump and realizing he lost the opportunity to shape the future of the country."

> "The most disturbing aspect of Gordon Ramsay's 'Kitchen Nightmares' is the revelation that so many restaurants are just microwaving your meal."

The hook is a complete thought that makes you want the next sentence. The paragraph then builds, explains, or lands the point. The hook isn't bait — it's the thesis.

**What a Fischerian Hook is NOT:**

- "Here's what nobody tells you about X..." (teaser bait)
- "I need to talk about something." (vague attention grab)
- "This." followed by a screenshot (lazy engagement)
- One-word sentences for "impact" (performance writing)

## Format: Medium Form

**Typical length: 3-6 paragraphs.** Three is the minimum for a real argument (setup, development, landing). Medium-form posts run longer when the argument needs it; length alone never makes something a thread — a thread is a deliberate format choice.

**Each paragraph is 2-4 sentences.** Not one-liners. Not walls of text. Natural paragraph length that breathes.

**For threads:** each tweet is its own medium-form post (3-5 paragraphs). The thread isn't one long essay chopped up — it's a sequence of self-contained posts that build on each other.

## Anti-Performance Rules

1. **No single-sentence paragraphs for emphasis.** If a sentence is important, it lives inside a paragraph where the surrounding context makes it hit harder.

2. **No line breaks within paragraphs for dramatic effect.** A paragraph flows. If you need a new thought, start a new paragraph.

3. **No "Let me explain" or "Here's the thing" throat-clearing.** Start with the point. The Fischerian Hook eliminates all preamble.

4. **No emoji anchors.** No starting lines with emoji to create visual structure. The writing IS the structure.

5. **No rhetorical question chains.** "What if I told you...? What if everything you knew was wrong?" — this is performance, not writing.

6. **No trailing ellipsis for mystery.** "And the answer might surprise you..." — say the answer.

## Voice Characteristics

- **Declarative, not questioning.** State positions confidently. "This is how it works" not "Have you ever wondered how it works?"
- **Specific, not vague.** Names, numbers, studies, references. "Researchers butchered 30 deer with 60 handaxes" not "Studies show that..."
- **Conversational but not casual.** Like talking to a smart friend at dinner, not like texting. No slang, no "lol", no "ngl."
- **Variable sentence length.** Mix short declarative sentences with longer explanatory ones. The rhythm is natural speech, not metronome.
- **Authority through knowledge, not tone.** Don't TELL them you're an authority. Demonstrate it by knowing things they don't.

## Thread Format

When writing threads, each tweet follows the same medium-form paragraph rules:

1. **Tweet 1 (Hook tweet):** 3-5 paragraphs. First paragraph's first sentence is the thread hook — the reason someone stops scrolling. Include the primary image if there is one.

2. **Body tweets (2-N):** Each is a self-contained medium-form post. Each has its own Fischerian Hook. Each could stand alone as a tweet, but builds on the thread's argument.

3. **Close tweet:** Lands the framework. Not a call to action ("Follow for more!"). Not a summary. The final insight that makes the whole thread click.

**Thread images:** Each body tweet can have a progression image or supporting visual. Images support the argument — they don't replace it.

## Voice: Always Apply

Voice is applied per [!QT-WORKFLOW] Step 4: near-final dumps get copy-edit + `/anti-ai`; thin beats get `/authors-voice` → Enhance → hook polish → optional `/polish` → `/anti-ai`. The x-writer skill handles format and structure. The voice skill handles tone, word choice, and eliminating AI tells.

**X-register anchor.** If your `/authors-voice` profile has a separate X-register anchor (e.g. `voice/anchor-x.md`, built via its Multi-Register Split), use it for X writes (tweets, QTs, threads, replies) instead of a book or long-form anchor. An X blend optimizes for two-second hooks, contrarian inversions, blunt opinion register, and paragraph medium-form; a book anchor pulls toward expository elaboration that the X surface punishes. NEVER rules and fingerprints stay corpus-wide — only the blend changes. No X anchor yet → fall back to `voice/anchor.md`.

> **Preferred path: OpenWriter's built-in Author's Voice "Enhance" plugin** (API-backed, full corpus RAG) — beats local Apply-minion briefs for X rewrites every time.

**AI tells to eliminate:**
- "Furthermore", "moreover", "additionally" — conjunction stacking that no human uses in casual prose
- "It's worth noting that" — throat-clearing
- "This is particularly important because" — explaining why something matters instead of just stating it
- "In essence", "fundamentally", "at its core" — filler abstractions
- "Arguably", "undeniably", "unquestionably" — hedging or over-asserting
- "Landscape", "paradigm", "ecosystem", "leveraging" — corporate AI vocabulary
- "Delve", "tapestry", "nuanced" — the most flagged AI words on the internet
- Balanced "on one hand / on the other hand" structures — real people take positions
- Ending with an inspirational reframe or call to reflection — just end

**The workflow (single pipeline — `/x-writer` runs the whole thing):**
0. **Format → angle → beats:** Always state the FORMAT first — X Article, plain tweet, thread, or QT. A funnel stage (Problem / Solution / Product) is NOT a format; name the actual format. Then extract the user's angle and beats — the agent ASKS and REFINES, never originates (see [!QT-WORKFLOW] — universal, not QT-only). No drafting until the format is named and the angle + beats are locked and approved.
1–4. **Write** per [!QT-WORKFLOW] Step 4, applying x-writer format rules (Fischerian hooks, paragraph structure, medium form).
5. **Score (optional):** if you have a scoring/prediction skill installed, run it on the ship-ready draft. See [!QT-WORKFLOW] Step 5.

## [!DOC-CONVENTION] — content_type discipline

Typed content docs (`tweet` / `reply` / `quote` / `article` / `linkedin` / `newsletter` / `blog`) hold ONLY the final prose as it will render on the target platform. Nothing else.

**What does NOT go in a typed content doc:**
- Markdown headers (`#`, `##`, `###`)
- Bold / italic / inline markdown formatting
- Section labels (`BEATS:`, `ANGLE:`, `SOURCE:`, `NOTES:`)
- Source URLs in the body (the frontmatter `tweetContext.url` for QTs/replies, `articleContext` for articles, handles linkage)
- Transcripts, refinement options, scoring rubrics, commentary
- Anything that won't be in the final post

**Where beats / angle / notes / source data go:**
- **During an active session:** in chat. Ephemeral. No persistence overhead.
- **For persistent scratchpads** ("let's do this tomorrow", multi-day shaping): create a separate `content_type: "document"` doc titled `Notes — [topic]` or `Beats — [topic]`. Use markdown freely there. When ready to write, create a NEW typed content doc and populate it with final prose only — the notes doc and the typed doc are TWO separate docs.
- **NEVER use a typed content doc as a scratchpad.** If you're tempted to add a `##` header, you've picked the wrong content_type.

**Pipeline (QT example, generalizes to all typed content):**
1. SURFACE + ANGLE + BEATS happen in chat per [!QT-WORKFLOW]. No OpenWriter doc created yet.
2. Beats lock → create the typed content doc (`content_type: "quote"`, etc.) at Step 4 (WRITE).
3. Populate with ONLY final prose.
4. Frontmatter (`tweetContext.url`) handles source linkage. Don't duplicate the URL in the body.

**Versioning:** when the user asks for a "second version" / "another draft" / "v2", NEVER overwrite the existing draft's node — each version is its OWN doc. Create a new typed doc (same `content_type` + `url`), populate it, leave the prior draft untouched. If unsure whether they want a replacement or a new draft, default to a NEW doc.

**Never stack rewrites on an unaccepted pending node.** Re-running a `write_to_pad` rewrite on a node whose previous pending edit hasn't been accepted/rejected flags the overlay `pending-stale` — it renders as a dotted underline instead of the normal pending decoration. Accept/reject the prior change first, or write the new version to a fresh doc.

## [!QT-WORKFLOW] — Content shaping (ANGLE/BEATS universal; SURFACE = cold-source only)

This is the shaping workflow for ALL content, not just QTs. **ANGLE → BEATS → WRITE govern every format** (X Article, Thread, Plain, QT): the user owns the angle and the beats, the agent only ASKS and REFINES, then WRITE runs on the user's approval. The agent never originates the take for any format — agent imposing angle = imposing taste = killing voice authenticity.

The one cold-source step is SURFACE. When the user invokes /x-writer to shape content from a discovery source (a user-supplied URL, a bookmark, a trending tweet, or any tweet the user didn't naturally connect with), SURFACE warms them up to the candidate first. For content from the user's own intent, skip SURFACE and start at ANGLE.

### Step 1: SURFACE

Show the candidate fully — one screen, no abbreviation:

- **Original tweet:** handle, full text, exact metrics (views, RTs, QTs, likes, replies, bookmarks), media description
- **Chain context:** if the source is itself a QT, show the quoted tweet
- **Why this is a candidate:** where it came from, how it fits the user's niche, and any past posts of theirs on the same topic
- **Theme alignment:** if the user has a current theme or plan, how this fits or diverges

### Step 2: ANGLE

**User provides the angle. Agent does NOT generate.** Agent prompt: "What's your angle on this?" (one line, no proposals, no menu).

After the user provides an angle:
- Clear and sharp → confirm understanding in one sentence, move to Step 3
- Ambiguous or could be sharper → propose ONE refinement (not three options): "Want me to tighten this to: '[one-line refined version]'?"
- Weak (vague, generic, off-niche) → flag the specific weakness ("this could land for anyone — what's the cut only you would make?"), push back ONCE, then defer to the user's call

**If the user is stuck and explicitly asks for prompts,** offer source material — never a finished angle: their own reference docs and recurring frameworks (via `list_workspaces` → `read_pad`), past posts of theirs that worked on adjacent topics, their current theme. These are sparks, not drafts.

### Step 3: BEATS

**User provides the beats. Agent does NOT generate.** The user dumps beats however they come (numbered list, paragraph, voice-memo style). Agent's response:

1. **Mirror back** the beats in clean format for confirmation (one sentence per beat, labeled HOOK / SETUP / INSIGHT / EVIDENCE / LAND or however they cluster)
2. **Flag structural concerns** if any: weak hook (not Fischerian), missing land, redundant middle, a beat that doesn't earn its paragraph, a paragraph running longer than 2-4 sentences. Paragraph COUNT is NOT a structural concern — never flag length as needing a thread.
3. **Suggest refinements ONE-PER-BEAT**: "Beat 2 might land sharper as: '[one-line suggestion]'?" Never rewrite the whole beat sequence.

If the user explicitly asks for a starting structure, offer a SHAPE (HOOK / SETUP / INSIGHT / EVIDENCE / LAND) — never the CONTENT of each beat.

**Medium-form constraints to enforce during refinement:**
- 2-4 sentences per paragraph. Paragraph count flexes: 3-6 is typical, but medium-form QTs/posts run longer when the argument needs the room. **Length is NEVER a reason to convert to a thread** — a thread is a deliberate format choice (multi-tweet with HRs).
- Hook is Fischerian — declarative, not teaser, not question
- LAND is positional or aphoristic, never a CTA, never a rhetorical question

### Step 4: WRITE

Once beats are locked, gauge them first — **dump vs thin** — then write accordingly.

**Near-deliverable dump (the user dumps close-to-final prose):** WRITE is EDITING, not generation. Preserve as much of their exact wording, rhythm, and voice as possible; clean ONLY the obviously messy prose — run-ons, transcription artifacts, dropped/duplicated words, typos. Do NOT run a from-scratch voice rewrite, and do NOT let Enhance or `/polish` overwrite prose that already sounds like them. The cleanup runs in order: (1) light copy-edit, (2) Fischerian-hook check, (3) **`/anti-ai` — MANDATORY on every dump.** The cleanup itself injects AI fingerprints (em-dashes, "not X but Y", copula inflation, colon overuse); `/anti-ai` strips them.

**Thin beats (structure only, not prose):** use the generation path —

1. **Draft from beats** via `/authors-voice` (X-register anchor if you have one) with the beats as commitments.
2. **OpenWriter Enhance pass** — cleans flow, balances.
3. **Fischerian hook polish** — verify the opener lands in two seconds. Rewrite if it doesn't.
4. **`/polish`** (optional) — score against the advertising-master panel if the stakes warrant.
5. **`/anti-ai` pass** — final fingerprint scrub.

### Step 5: SCORE (optional — only if you have a scoring skill)

If you have a tweet scoring/prediction skill installed, run it **after** Step 4 on the EXACT text that ships and **before** posting/scheduling — otherwise predicted-vs-actual means nothing.

1. **Output the score IN CHAT** — never silent, never only written to a file.
2. **The user chooses: Post / Iterate / Scrap.** A "predicted flop" they believe in still ships. The user can skip scoring with a word.
3. **Iterations route back through `/x-writer`** (re-edit → re-voice → re-anti-ai → re-score). The scorer predicts; it never edits.
4. **Never optimize the draft to juice the predicted score.** The score informs the user; it does not drive a rewrite loop.

### When to skip steps

- User already wrote the post and asks for polish → skip to Step 4
- User has a clear angle already → skip Step 2, start at Step 3
- Original content from the user's own intent → skip SURFACE only. ANGLE + BEATS still come from the user — they usually already have them, so confirm and refine, then WRITE.

## Progressive Disclosure — Sub-Docs

Load on demand based on the task:

- **OpenWriter mechanics** — `tweetContext` / `articleContext` metadata, `content_type` (`tweet` / `reply` / `quote` / `article`), thread HRs, image handling, paragraph spacing, parent-tweet workflow → [`docs/openwriter-mechanics.md`](docs/openwriter-mechanics.md)
- **Article format** — evaluate (7-dimension score) or optimize X Articles. 10 rules for scroll-stop engagement → [`docs/article-format.md`](docs/article-format.md)
- **Images** — generate covers + thread images. 5 styles (Dark Editorial, Cinematic Realism, Abstract/Conceptual, Raw/Documentary, Dark Infographic), decision tree, character references → [`docs/images.md`](docs/images.md) + [`docs/images/`](docs/images/) (styles, characters, workflow)
- **Comics** — character-consistent comic strip panels for threads. 4 comic-specific styles, full pipeline → [`docs/comics.md`](docs/comics.md) + [`docs/comics/`](docs/comics/) (styles, characters, workflow)
- **Pipeline** — full brainstorm → polish (Author's Voice) workflow; scheduling/posting hands off to OpenWriter native (`mcp__openwriter__schedule_post`, `post_to_x`) → [`docs/pipeline.md`](docs/pipeline.md)

## Scripts

- `scripts/generate-image.js` — Gemini image generation with reference image support
- `scripts/characters/` — character reference PNGs for consistent multi-panel/thread image sets (user-supplied)

## What This Skill Does NOT Cover

- **What to write about** — topic strategy is outside this skill's scope
- **Posting/scheduling** — OpenWriter native: `mcp__openwriter__schedule_post`, `post_to_x`, `manage_schedule`
- **Scoring/prediction** — Step 5 above runs a scoring skill if you have one installed; none is bundled with OpenWriter
- **Reading tweets** — use a tweet-reader skill if you have one installed (not bundled)
- **Direct X API access** — use an X API skill if you have one installed (not bundled); OpenWriter's native posting covers the normal path
