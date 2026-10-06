# Beats — Blog Post Methodology

A beat is the smallest unit of forward movement: one shift in the reader's understanding, attention, or emotional state. The fundamental unit the editor operates on with the author.

Blog-scale adaptation of book-writer's beat methodology. Same discipline, smaller container. For deep methodology background see `book-writer/docs/beats.md` — this doc is the operational form for posts.

## Firm rules

### 1. Beats live in a separate doc, ALWAYS.

Each post has TWO sibling docs in its container:

- `Beats — <Post Title>` (content_type: document) — the locked beat structure (this doc's output)
- `<Post Title>` (content_type: blog) — the prose pour, identified by content_type as the publishable doc (draft mode's output)

Beats and draft change on different cycles. Beats get reshaped when the author rethinks a claim; the draft gets re-poured through `/authors-voice` against the new beats. Keep them separated so a beat-level reshape doesn't fight an in-flight prose edit.

### 2. Beats are commitments, not content.

A beat is the OUTCOME the writer must produce in the reader. NOT the content the writer uses to produce it.

| Content brief (wrong) | Commitment (right) |
|---|---|
| "Mention Stripe Connect, PayPal, and Square, then say why Connect is best" | "Position payment-rails choice as a one-way door — reader registers Connect as the locked-in standard" |
| "Show the migration steps: pnpm install, run codemod, restart" | "Land the migration as boring — reader registers 'three commands, no babysitting'" |

The right column tells the writer WHAT must land. The author's frame + the model's training data bring the specifics. When the editor specifies the prose instead of the move, the minion can't bring its moves.

### 3. Query-first: pull from author, don't propose.

The editor STRUCTURES what the author owns. When beats are needed — to fill a post, extend the spine, sharpen a claim — DEFAULT to querying the author. Mining source docs and proposing 3 candidate beats wastes a turn; the author rejects all 3 because they came from outside the author's brain.

Correct move: name the SIGNAL in the author's recent thinking → formulate ONE focused question → author talks → editor structures the beat from the author's words.

**Query patterns that work:**

- "You just shipped X. What's the counter-intuitive thing about it that nobody else writes?"
- "If someone reads this and only remembers ONE sentence, what should it be?"
- "What did you think before you shipped X, and what do you think now?"
- "What's the reader doing wrong today that this changes?"
- "What's the t-shirt line for this post?"

Propose only when (a) the author asks for candidates explicitly, (b) candidates are mechanically derived from material the author owns (a PR diff, a recent feature spec) — presented as restructuring, not invention, or (c) `announcement` posts where the angle is "we shipped X" and the beats are mechanically downstream of that.

### 4. Declarative-claim names, never categorical labels.

Every beat name must communicate the beat's SUBSTANCE — what it asserts — not what KIND of beat it is.

| Good (substantive) | Bad (categorical) |
|---|---|
| `B1 — STRIPE CONNECT IS A ONE-WAY DOOR` | `B1 — THE HOOK` |
| `B3 — MIGRATION TAKES THREE COMMANDS` | `B3 — THE WALKTHROUGH` |
| `B5 — YOU'LL HATE THIS ON DAY ONE` | `B5 — THE OBJECTION` |

Format: declarative claim, present tense, 4-10 words, the active assertion the beat makes. Author should be able to picture the move from the name alone.

## Beat count and pass depth by sub-form

Beat methodology scales by post size. Two depths:

| sub_form | Beat count | Pass depth | Notes |
|---|---|---|---|
| `short` | 3-5 | 3-pass | Quick announcement, opinion take, single-feature drop |
| `announcement` | 3-6 | 3-pass | Feature launch with context + demo + CTA |
| `long` | 8-15 | 5-pass | Deep dive, framework, multi-section exploration |
| `tutorial` | 8-12 | 5-pass | Step-by-step (some beats wrap code blocks / screenshots) |

The compressed 3-pass skips TENSION and CATEGORY — for posts under 1000 words those passes are overhead the post can't earn back. Drop straight from DUMP to SEQUENCE to COMPRESSION.

## The dopamine arc for a blog post (layered with a conversion arc)

A post's beat list reads as a 4-act dopamine sequence at compressed scale, layered onto a conversion arc that books don't have:

| Act | Dopamine job | Conversion job | Beats (long post) | Beats (short post) |
|---|---|---|---|---|
| **Hook** | Crack the reader open with tension / curiosity-gap / surprising claim | Earn the click into reading | B1-B2 | B1 |
| **Develop** | Each beat resolves one prior tension and opens the next | Move reader from "interesting" to "I believe it" | B3 to B(n-2) | B2-B(n-1) |
| **Bridge** | Pivot or reframe — zoom out to implication, or zoom in to scene | Move reader from "I believe it" to "what do I do" | B(n-1) | (often skipped) |
| **Payoff + CTA** | Close the loop opened in Hook; the action invitation lands clean | The action invitation lands clean | Bn | Bn |

Both arcs must hold. When they diverge (rare), the conversion arc wins for the CTA-ending segment — that's where most posts lose readers, so the close gets sequenced for conversion even if it costs a small dopamine beat.

Acts are organizational scaffolding in the Beats doc, NOT dispatch units. Each beat is its own dispatch when prose pours.

## The 5-pass extraction (long / tutorial)

Editor drives, author owns substance. The shape is universal across writing channels (DUMP captures, structure passes shape, COMPRESSION tests); the TAGS used inside CATEGORY and the dimensions used inside TENSION are blog-specific. Book-writer uses argument-domain tags (REVEAL / MECHANISM / etc.); copy uses conversion tags (PROMISE / PROOF / OBJECTION / etc.); the blog taxonomy below sits between, borrowing from both.

### Pass 1: DUMP

Author brain-dumps every interesting, counter-intuitive, sharp, lived, weird, or sticky thing on the topic. No filtering, no sequencing, no length cap. Editor captures verbatim.

Target: 15-25 raw beat-candidates (more than will survive).

Editor prompts that help:
- "What's the counter-intuitive thing here?"
- "What's the scene from your own work that lands a piece of this?"
- "What's the t-shirt line?"
- "What's the reversal — reader expected X, gets Y?"
- "What's the part you keep coming back to in conversation?"

### Pass 2: TENSION (blog-customized — four dimensions)

Books only tag two tension dimensions per beat. Blog posts have two more: an external promise (the title + preview), and an external action (the CTA close). Tag each candidate against ALL four:

1. **Question this beat ANSWERS** — the tension it resolves
2. **Question this beat OPENS** — the tension it primes for the next beat
3. **Promise this beat DELIVERS on** — which part of the title + preview promise this beat pays off (or `none` if the beat is structural / connective)
4. **Reader action this beat INVITES** — implicit for most beats (scroll / register / trust), explicit for the CTA close (subscribe / share / try / follow / book)

Failure modes Pass 2 catches:

- **Promise-orphan beat** — answers a question and opens another, but doesn't deliver on ANY part of the title's promise. Cut or repurpose: it's interesting but doesn't pay off the contract the link surface made.
- **Title-undelivered promise** — no beat in the list delivers on a specific phrase in the title or preview. Either reshape the title (the post isn't actually about that), or add a beat that delivers (the post is missing a load-bearing move).
- **Dead-end beat** (no open question) — fine at post close; in the middle, flag for cut / merge / repositioning.
- **Non-sequitur beat** (no answered question) — find the prior beat it should follow, or cut.

A clean blog beat: answers ONE question, opens ONE question, delivers ONE slice of the promise, invites a coherent (often implicit) action. The conversion handoff.

### Pass 3: CATEGORY (blog taxonomy — 9 tags + 2 positional roles)

Tag each beat with one category. Categories are MOVES the beat makes — not roles. Two roles (HOOK, CTA) are positional, not tagged:

**Positional roles** (placement is the rule, no category tag):
- **HOOK** — always B1. Opens with tension or curiosity-gap, echoes the title's load-bearing phrase, primes the post's first question. Internally categorized (it's still a CLAIM or REFRAME under the hood) but its position IS its job.
- **CTA** — always the closing beat for posts that want reader action. Invites a specific next move (subscribe, share, try, follow). For posts without an explicit CTA, the closing beat is APHORISM or PIVOT instead — no positional CTA needed.

**Category tags** (one per beat):

| Tag | Meaning | Common shape |
|---|---|---|
| **CLAIM** | New information lands; the load-bearing assertion | "X is true / X happens / X works this way" |
| **REFRAME** | Challenges the reader's prior understanding | "You think X. Actually Y." |
| **MECHANISM** | Explains how or why something works | Step-by-step or causal chain |
| **EVIDENCE** | Proof: data, study, citation, anecdote-as-evidence | "Here's the data / here's the study / here's the case" |
| **DEMO** | Shows the thing in action (code block, screenshot, walkthrough) | The reader sees, not just hears |
| **SCENE** | Lived moment that grounds an abstraction | "The day we shipped X / when our customer hit Y" |
| **OBJECTION** | Anticipates and dismantles a likely pushback | "You might say X. Here's why X doesn't hold." |
| **APHORISM** | Compressed single-line beat | The t-shirt line; one sentence; fires on its own |
| **PIVOT** | Directional turn between sections | "So far we've looked at X. Now —" |

DEMO and OBJECTION are blog-specific additions to the book taxonomy. DEMO covers visual/procedural proof that books rarely lean on. OBJECTION covers persuasion work that essays and tutorials need but book chapters do less of.

**Confirm the MIX. Typical long blog post:**

| Composition | Share |
|---|---|
| CLAIM / REFRAME (the post's load-bearing moves) | 30-40% |
| MECHANISM / EVIDENCE / DEMO (the proof layer) | 25-35% |
| SCENE / APHORISM (the grounding + compression layer) | 15-25% |
| OBJECTION (anticipates pushback) | 5-15% |
| PIVOT (connective tissue) | 5-10% |

Skew shifts by sub-form:
- **Tutorial** — heavier DEMO + MECHANISM (50-60%), lighter REFRAME / OBJECTION
- **Opinion** — heavier REFRAME + APHORISM, lighter DEMO
- **Announcement** — heavier CLAIM + DEMO (showing the new thing), light on REFRAME / MECHANISM
- **Framework** — balanced CLAIM + MECHANISM + EVIDENCE, OBJECTION as the closer before CTA

Bad mixes that signal trouble:
- All EVIDENCE → reads academic, no register variation
- All APHORISM → reads tweet-thready, no grounding
- All MECHANISM → reads textbook, no surprise
- Zero OBJECTION on a persuasive post → reader's pushback is unaddressed
- Zero DEMO on a tutorial → reader doesn't see the thing work

### Pass 4: SEQUENCE (dopamine arc + conversion arc, layered)

Order beats by dopamine flow — each beat's OPEN question becomes the next beat's TENSION. Same primary rule as book.

For posts with a CTA (most blog posts), the dopamine arc layers ONTO a conversion arc. Both must land:

| Position | Dopamine job | Conversion job |
|---|---|---|
| Hook (B1) | Crack the reader open: surprise, curiosity-gap, title-echo | Earn the click into reading |
| Early develop | Resolve B1's tension → open the next | Build trust the post is worth finishing |
| Mid develop | Proof + mechanism + scene | Move the reader from "interesting" to "I believe it" |
| Pivot | Directional turn (PIVOT beat or REFRAME beat) | Move from "I believe it" to "what do I do" |
| Late develop | Objection + payoff | Address the last pushback before action |
| Close (Bn) | Aphorism that lands the t-shirt line, OR CTA inviting action | The action invitation lands clean |

Watch for the standard sequence failures plus blog-specific ones:

- **Broken dopamine** — beat N opens a question beat N+1 doesn't answer (reader waits without payoff)
- **Premature reveals** — payoff lands before setup primed anticipation
- **Stacked openings without payoff** — post keeps promising and never delivers
- **Stacked payoffs without new tension** — post peaks then flatlines
- **Conversion break** — OBJECTION beat positioned BEFORE the post has built enough trust to handle pushback (move it later)
- **CTA without runway** — closing CTA arrives without the post having earned the action (need an OBJECTION or APHORISM beat before CTA to close the loop)

The right sequence is dopamine-optimal AND conversion-optimal. For most posts those are the same sequence; when they diverge, conversion arc wins for the CTA-ending segment.

### Pass 5: COMPRESSION

State each beat as one tweet-length sentence. If you can't compress, the beat is still mush — split or cut. The compression test forces the author to NAME the move precisely.

Blog-specific compression subtest: read all the compressed beats end-to-end. Do they form a coherent micro-story that lands the title + preview promise? If yes, the sequence is shippable. If reading the compressed beats produces a scattered set of claims that don't add up to the post the title promised, return to TENSION (Pass 2) — the promise-delivery dimension wasn't being checked, and the post is going to feel diffuse no matter how voice-poured the prose.

## The 3-pass extraction (short / announcement)

For posts under 1000 words. Skip the full TENSION + CATEGORY passes — they're overhead the post can't earn back at this scale. Their work folds into SEQUENCE instead.

1. **DUMP** — author brain-dumps 5-10 candidates
2. **SEQUENCE** — order by Hook → Develop → Payoff/CTA. While ordering, the editor mentally tags each beat against the implicit four-dimension TENSION test (answers / opens / delivers on promise / invites action) and drops anything that doesn't fit ALL four. Don't write out the tags — just cut what fails.
3. **COMPRESSION** — one tweet-length sentence per beat, 3-5 survive

For `announcement` posts the structure is usually mechanical: B1 = HOOK (the news, title-echo), B2 = CLAIM (why it matters), B3 = DEMO (show it), B4 = CTA (try it / read more / subscribe). Run the 3-pass anyway to sharpen claim-names — categorical "the news" / "why it matters" names produce sloppy prose.

## Beat density (craft choice)

Different posts run at different densities. Pick deliberately for the post's velocity:

| Density anchor | Typical words/beat | When |
|---|---|---|
| Aphoristic | 50-100 | Opinion takes, contrarian shorts |
| Punchy | 150-250 | Most short/announcement posts |
| Argumentative | 250-400 | Frameworks, multi-claim long posts |
| Mechanism walk | 400-600 | Tutorials, deep dives, evidence-heavy posts |

A single post can mix densities: 80w hook → 300w mechanism beat → 100w aphoristic payoff. That variation IS the rhythm. Per-site beat math (in `voice/anchor-<site_id>.md` or its companion `voice/beat-math-<site_id>.md`) can carry a target anchor for that site's voice.

## Beats doc artifact

One doc per post: `Beats — <Post Title>`. Reads top-to-bottom as the flow.

```
# Beats — <Post Title>

**Sub-form:** short | announcement | long | tutorial
**Word target:** ~Xw
**Site:** <site_label from list_blog_sites>
**Voice anchor:** voice/anchor-<site-slug>.md (or default voice/anchor.md)

## Title + preview + slug (B0 commitments)

See `docs/titling.md`. Title mirrored to Draft doc title via rename_item; preview + slug mirrored to blogContext.

- **Title:** <locked title>
- **Preview (140-160 char):** <locked description>
- **Slug:** <locked slug>

## Beat list

### Hook  (~Xw)

**B1 — DECLARATIVE CLAIM IN CAPS.** [HOOK] (~Xw)
One-paragraph outcome description. Title-echo phrase that must appear. Tension this beat opens. What registers in the reader after this beat lands.

### Develop  (~Xw)

**B2 — DECLARATIVE CLAIM.** [REFRAME] (~Xw)
Outcome description. Which part of the title/preview promise this beat delivers on. Callbacks. Author-unique content.

**B3 — DECLARATIVE CLAIM.** [MECHANISM] (~Xw) ...

**B4 — DECLARATIVE CLAIM.** [EVIDENCE] (~Xw) ...

**B5 — DECLARATIVE CLAIM.** [DEMO] (~Xw) ...

### Pivot  (~Xw)

**B6 — DECLARATIVE CLAIM.** [PIVOT] (~Xw) ...

### Payoff  (~Xw)

**B7 — DECLARATIVE CLAIM.** [OBJECTION] (~Xw) ...

**B8 — DECLARATIVE CLAIM.** [APHORISM] (~Xw) ...

**Bn — DECLARATIVE CLAIM.** [CTA] (~Xw)
The action invitation — subscribe / share / try / follow / book. Concrete; no "if you found this useful" filler.
```

Each beat = declarative-claim name + category tag (or positional role for HOOK / CTA) + word target + brief outcome paragraph naming what must land. Outcome shape only — minion brings the prose, editor names the move.

**Why no inline citations:** if the post has hardened sources (specific URLs, paper citations, author-name-year refs), they live in a sibling `Sources — <Post Title>` doc, NOT in the Beats doc. Beats reference Sources by name; the draft mode injects them into the minion brief when pouring prose. For most posts there are no hardened sources — model training data carries the examples.

## Minion dispatch

When the Beats doc is locked, `draft` mode pours prose via `/authors-voice` Apply Protocol.

**Default discipline (matches book-writer):** one beat = one dispatch.

**Compressed dispatch (short / announcement, under 600w total):** all beats in a single dispatch, listed as commitments in the brief. Justified by post being shorter than book-writer's single-beat unit (500-650w).

**Long / tutorial:** per-beat dispatch is the right call — each beat gets its own minion run with its own commitment brief. The author reviews per-beat and reshapes before the next pours.

The dispatch brief carries:
- The beat's outcome commitment (verbatim from Beats doc)
- The site-specific voice anchor path (`voice/anchor-<site_id>.md` — see `docs/voice-anchor.md`)
- Any must-appear phrases / callbacks
- Word target for this beat
- Prior beats already drafted (so the minion knows what's been said)

## Beat reshape loop

Beats reshape regularly. The flow:

1. Author reads the draft, flags "B3 doesn't land" / "B5 should come before B4" / "kill B7"
2. Reshape the **Beats doc** (rename a beat, reorder, drop, add)
3. Re-pour the **Draft doc** for affected beats only (not the whole post — beats are atomic)
4. Voice-pass the new beats via `/authors-voice` against the site anchor
5. Author reviews

The two-doc split makes this cheap. A beat-level reshape stays in the Beats doc; only the affected beat-prose gets re-poured.

## When to skip beats methodology

- Single-paragraph drafts, one-off emails, tweet replies — beats are overhead the piece can't earn back; go straight to `/authors-voice`
- Pure announcement with mechanical structure ("we shipped X") where the author wants to move fast — optional, but the 3-pass still catches weak claim-names
- Iteration on already-drafted prose where structural rework isn't the goal — beats are upstream of prose; use the existing draft as preservation-scope source for `/authors-voice`

Beats methodology is the right investment for any post where the structure is load-bearing — frameworks, deep dives, opinion pieces with multiple claims, tutorials. Skip when the post is shorter than a single book-writer beat (500-650w) AND the structure is mechanical.

## Output

```json
{
  "status": "draft-ready",
  "artifact": {
    "beats_doc_id": "<beats doc>",
    "workspace_id": "...",
    "container_id": "<post container>",
    "sub_form": "long",
    "beat_count": 12
  },
  "next_steps": ["/blog-writer draft"],
  "notes": "Beats locked. Title/preview/slug mirrored to blogContext. Ready to pour prose."
}
```

## Anti-patterns

- ❌ Writing prose into the Beats doc. Beats are commitments; prose lives in the Draft doc.
- ❌ Categorical beat names ("THE HOOK," "THE MECHANISM," "THE PAYOFF"). Substance, not role. Positional roles (HOOK = B1, CTA = Bn) are placement rules, NOT beat names — the beat name is still a declarative claim.
- ❌ Tagging a HOOK or CTA beat with a category in the brackets. They're positional roles; the bracket is `[HOOK]` or `[CTA]`, not `[CLAIM]` or `[APHORISM]`.
- ❌ Packing content into the outcome paragraph (specific examples the model would invent anyway). Specify only AUTHOR-UNIQUE content + load-bearing callbacks.
- ❌ Using book taxonomy tags (REVEAL / REGISTER SHIFT) on blog beats. Blog tags are CLAIM / REFRAME / MECHANISM / EVIDENCE / DEMO / SCENE / OBJECTION / APHORISM / PIVOT.
- ❌ Promise-orphan beats — answer/open clean but deliver on NO part of the title/preview promise. Cut or repurpose.
- ❌ Zero OBJECTION beats on a persuasive post. Reader's likely pushback goes unaddressed; conversion stalls.
- ❌ Zero DEMO beats on a tutorial. Reader doesn't see the thing work; the tutorial fails to land.
- ❌ Running the 5-pass on a 600-word announcement. Use the 3-pass.
- ❌ Skipping beats and going straight to draft "because the topic is simple." If the post has 3+ claims, beats catch the broken sequence before the prose locks in.
- ❌ Reshaping beats AND re-pouring the entire draft in one pass. Reshape beats first, lock them, then re-pour only the affected beats.
