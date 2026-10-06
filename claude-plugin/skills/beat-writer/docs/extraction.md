# Extraction

Pull beats out of the operator before any prose is written. Same query-first, 5-pass discipline used by `/book-writer` — extraction is the foundation of every channel-master writer, including this channel-agnostic one.

## Query-first principle

The editor PULLS from the operator. The editor does NOT propose beats from its own intuition.

**Failure mode**: editor reads the source material → proposes 3 candidate angles → operator rejects all 3 because they came from outside the operator's head. Wasted turn, content the operator doesn't recognize as theirs.

**Correct move**: editor asks one focused question → operator talks → editor captures verbatim → structures from the operator's words.

Default to query. Proposing is OK only when (a) the operator explicitly asks for candidates, or (b) the proposal is mechanically derived from operator-owned source material ("your concept doc lists 5 mechanisms; I'm proposing each becomes a beat — does that fit?").

## DUMP prompts (open-ended, channel-agnostic)

Since the channel isn't fixed yet, the DUMP questions stay generic:

- "What's the counter-intuitive thing here?"
- "What's the part you keep coming back to in conversation?"
- "What's the reversal — the moment the reader expected X and gets Y?"
- "What's the part you'd put on a t-shirt?"
- "What's the scene from your own life that lands a piece of this?"
- "What's the part where you go 'wait, but...'"
- "What's the strongest claim you're willing to make?"
- "What's the example that makes this concrete?"
- "What did you almost not say?"

Wide net — 20–40 raw beat-candidates. No filtering. If the piece later becomes web copy or a tweet thread, channel-specific extraction will add channel-tuned questions; for now, get the raw material out.

## The 5-pass (channel-agnostic)

Same shape as `/book-writer`. The CATEGORY tags are a channel-agnostic superset.

### Pass 1: DUMP

Already done. 20–40 raw beat-candidates captured verbatim, no filtering.

### Pass 2: TENSION

For each raw beat, tag:
- **What question does this beat ANSWER?** (the tension it resolves)
- **What question does this beat OPEN?** (the tension it primes)

Beats with no open question are dead ends — fine at piece-close, otherwise cut/merge.
Beats with no answered question are non-sequiturs — find the prior beat they should follow, or cut.

A clean beat: answers ONE question, opens ONE question.

### Pass 3: CATEGORY

Tag each beat with one of (channel-agnostic superset):

- **CLAIM** — assertion, promise, position-take
- **REFRAME** — old information re-seen in a new light
- **MECHANISM** — how / why something works
- **EVIDENCE** — proof for a prior claim (data, citation, study, lived experience)
- **STORY / SCENE** — lived experience that grounds an abstraction
- **APHORISM** — compressed claim, single-sentence beat
- **PIVOT** — directional turn (now we look at X)
- **OBJECTION** — the friction handled, named and dissolved

Confirm the mix is right. All EVIDENCE reads academic; all APHORISM reads tweet-thready; all MECHANISM reads textbook. Variety matters — typically 30–40% CLAIM/REFRAME, 20–30% EVIDENCE/MECHANISM, 10–20% STORY/SCENE, 10–15% APHORISM, with PIVOT and OBJECTION as connective tissue.

### Pass 4: SEQUENCE

Order beats by reader flow. Each beat's OPENED question becomes the next beat's TENSION.

Watch for:
- Broken sequences (beat N opens a question beat N+1 doesn't answer)
- Premature reveals (payoff lands before setup primes the anticipation)
- Stacked openings without payoff (keeps promising, never delivers)
- Stacked payoffs without new tension (peaks then flatlines)

The right sequence is dopamine-optimal — each beat hands the reader to the next.

### Pass 5: COMPRESSION

State each beat as ONE sentence. No constraint budget at this layer (no channel slot type yet). The test: if you can't compress a beat to one sentence, it's mush OR it's two beats stuffed in one. Split or cut.

## Final artifact

After all 5 passes: a flat sequenced list of typed beats (5–30, depending on piece scope), each one sentence, each categorized. The Beat Map.

Stored in OpenWriter as `Beats — <Doc Name>` per `openwriter-surface.md`.

## When to skip extraction

- **Operator already has tight beats locked elsewhere** — load them, skip to write
- **Single-paragraph piece** — extraction is overhead the piece can't earn back
- **Pure paraphrase / rewrite of existing prose** — go straight to `/authors-voice` rewrite mode
- **Seed content provided as a draft** — treat the seed as DUMP material; run Pass 2–5 only

For everything else (new piece, major rework, scattered ideas): extract first. Drafting without extraction produces shapeless prose that's hard to refactor into any channel later.
