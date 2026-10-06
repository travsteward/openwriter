# Pipeline

End-to-end workflow when `/beat-writer` is invoked. Phases run in order; each commits before the next.

## Phases

```
1. INTENT     — what's the operator writing about?
2. EXTRACT    — 5-pass from operator's head
3. SHAPE      — beat map (commitments locked, sequence locked)
4. WRITE      — /authors-voice Apply Protocol (operator's default anchor)
5. POLISH     — /polish to 90/100 per beat
6. ANTI-AI    — /anti-ai scrub
7. CONGRUENCE — naive-reader pass (inline)
8. (OPTIONAL) REFACTOR — hand off to channel-master if a channel becomes obvious
```

## Phase detail

### 1. INTENT

What's the operator writing about? Why now? Who's the (loose) audience?

Reading signals (in priority order):
- Topic clear from the prompt → start extraction
- Seed content provided (an idea, a draft, a paste) → use as DUMP seed (Pass 1 collapsed)
- Open-ended ("write me something") → ask ONE clarifying question

If genuinely ambiguous, ask one focused question. Don't menu-dump.

### 2. EXTRACT

5-pass per `extraction.md`. Output: 5–30 typed beats in sequence, stored in `Beats — <Doc Name>` in OpenWriter.

### 3. SHAPE

Lock the beat map per `beat-method.md`. Each beat = type + job + slot commitment.

No channel template at this stage — the beat list is the shape. Channel-masters re-shape later if refactor happens.

### 4. WRITE

Delegate per-beat to `/authors-voice` Apply Protocol with operator's default anchor. No anchor swap (this skill = personal voice).

For each beat:
- Assemble TASK brief (semantic commitments, optional cadence prescription, preservation scope)
- Spawn `/authors-voice` minion (opus, general-purpose subagent)
- Patch any NEVER violations on returned prose
- Integrate into Draft doc by `docId`

Editor never writes prose; every beat-to-prose pass is a minion dispatch.

### 5. POLISH

For each section / load-bearing beat, invoke `/polish`. Score 0–100; rewrite to 90+. Delegate, don't duplicate.

### 6. ANTI-AI

Run `/anti-ai` on the full draft. Strip em-dash density, contrastive formulas, AI fingerprints.

### 7. CONGRUENCE

Read the draft as a newcomer: flag jargon, broken flow, undefined terms.

### 8. REFACTOR (optional)

When the draft's destination becomes clear, hand off to the appropriate channel-master per `refactor.md`:
- `/blog-writer` (long-form post)
- `/x-writer` (thread or article)
- `/newsletter-writer` (email section or full newsletter)
- `/copy-writer` (web copy — only if you have it installed; not bundled with OpenWriter)
- `/book-writer` (chapter / vignette in a book project)

OR stay as a personal doc / journal / note in OpenWriter.

## Internal dispatch logic

| Operator says | Phases that run |
|---|---|
| "write something about [topic]" | 1 → 2 → 3 → 4 → 5 → 6 → 7 |
| "I have this idea: [seed]" | 1 → 2 (seed = dump start) → 3 → 4 → 5 → 6 → 7 |
| "extract beats from [topic]" | 1 → 2 → 3 only |
| "pour these beats: [list]" | 4 → 5 → 6 → 7 (skip 1–3) |
| "polish this draft" | 5 → 6 → 7 only |
| "turn this into a blog post / thread / newsletter / page / chapter" | 8 (refactor handoff) |
| "/beat-writer" alone | 1 → ask one clarifying question |

## Reshape loops

Beat reshape → re-pour. If the operator wants to change the beat structure:
- Update the Beats doc (Phase 3)
- Re-run Phase 4 ONLY for affected beats
- Re-run Phase 5 on those beats
- Skip 6–7 unless the change was material

Don't re-pour the whole draft when one beat changed. Two-doc separation makes targeted re-pours cheap.

## Phase gates (block until satisfied)

- Phase 3 cannot start without Phase 2 output (no beats → no shape)
- Phase 4 cannot start without locked beats (no commitments → shapeless prose)
- Phase 5 cannot start without a draft (nothing to polish)
- Phase 8 (refactor) requires Phase 7 complete (don't refactor an unpolished draft — the channel-master gets garbage)

## When phases collapse

- **Single-beat write** (one paragraph from a clear commitment): skip 2–3 → run 4–5 only
- **Polish-only request**: run 5–7
- **Refactor-only**: skip everything except Phase 8

## What to do on the FIRST draft of a project

The first draft in a new project carries setup cost:

1. INTENT: clarify topic + scope
2. EXTRACT: full 5-pass
3. SHAPE: lock beat map
4. WRITE: full /authors-voice pour per beat
5. POLISH every beat
6. ANTI-AI + CONGRUENCE

The next draft in the same project skips workspace setup. Drafting takes 10–30 minutes depending on scope.
