# X Article Format — Evaluate & Optimize

Score and fix X Article formatting for scroll-stop engagement. Articles are read on mobile in a feed — every formatting decision is a retention decision.

## Modes

### EVALUATE — Score an article

Read the article via `read_pad`. Score each dimension 0-10. Report the total and flag the weakest areas.

| # | Dimension | 10/10 Looks Like | 0/10 Looks Like |
|---|-----------|-----------------|-----------------|
| 1 | **Title** | Bold claim that STATES the thesis. Forces reaction from every reader. No mystery, no curiosity gaps. Use Ad Legends technique (score 0-100 across top 10 ad practitioners, don't stop until 90+). | Generic label. Mystery bait. "What I Learned About..." Requires reading to understand. |
| 2 | **Opening Hook** | Most provocative line in first 3 paragraphs. Grenade structure: context → blockquote/punch → stakes. | Scene-setting. Background. "In [year], [person] did [thing]..." |
| 3 | **Blockquote Usage** | Pull-quotes from the article's own strongest lines + source quotes. ~1 per 500 words. Visual scroll-stops. | Quotes buried in paragraph text. No blockquotes at all. |
| 4 | **Subheading Quality** | Subheadings form an **argument spine** — reading ONLY the subheadings in sequence tells the article's complete thesis. Each is a condensed claim, not a label. | Generic labels: "Background", "Analysis", "Conclusion". |
| 5 | **Paragraph Density** | 2-4 sentences max. White space everywhere. Mobile-native. | 5+ sentence walls. Academic paragraph structure. |
| 6 | **Bold Strategy** | 1-2 bold thesis phrases per section. Scanners get 80% of the argument from bold + subheadings alone. | No bold, or everything bold. Bold on irrelevant words. |
| 7 | **Closing Strength** | Callback to opening image/quote, or identity/tension statement. Lands with weight. | Summary paragraph. "In conclusion..." Fades out. |

**Output format:**
```
ARTICLE FORMAT SCORE: [title]

1. Title:              X/10 — [one-line reason]
2. Opening Hook:       X/10 — [one-line reason]
3. Blockquote Usage:   X/10 — [one-line reason]
4. Subheading Quality: X/10 — [one-line reason]
5. Paragraph Density:  X/10 — [one-line reason]
6. Bold Strategy:      X/10 — [one-line reason]
7. Closing Strength:   X/10 — [one-line reason]

TOTAL: XX/70

PRIORITY FIXES: [top 2-3 issues, in order]
```

### OPTIMIZE — Fix the article

Fix in strict priority order. Stop after each fix and show the user what changed.

**Priority order:**
1. Title (biggest impact — determines whether anyone clicks at all. Use Ad Legends technique.)
2. Opening (50% of readers decide here)
3. Blockquotes (visual scroll-stops, zero effort to add)
4. Subheadings (curiosity hooks for scanners)
5. Paragraph density (split walls)
6. Bold strategy (reward scanners)
7. Closing (callback or tension)

**Workflow:**
1. `create_checkpoint` — safety snapshot before any edits
2. `read_pad` — get current article state
3. Fix priority #1, show user what changed
4. Continue through priorities, batching small fixes (3-8 changes per `write_to_pad` call)
5. Final `read_pad` — confirm structure, re-score

## The 10 Rules

These are the formatting laws. Every EVALUATE score and every OPTIMIZE edit is grounded in these rules.

### 1. Title Rule
The title is a bold claim that STATES the thesis. No mystery. No curiosity gaps. No "What I Learned About..." The reader must know the article's position before clicking. Use the **Ad Legends technique**: generate candidates through the lens of top advertising practitioners (Ogilvy, Halbert, Schwartz, Caples, Hopkins, Bernbach, Kennedy, Sugarman, Lois, Burnett), score each 0-100, don't stop until you hit 90+. The title that forces a reaction from every reader — agree or disagree — is the right one.

**Anti-patterns:** Mystery bait ("The System Nobody Talks About"), generic labels ("The Marsh People"), questions ("What If Women Were Always In Charge?"), anything that requires reading the article to understand the claim.

### 2. Grenade Rule
The most provocative line must be in the first 3 paragraphs. Not paragraph 5. Not after "context." The opening is a grenade: pull the pin in sentence one, let it explode by paragraph three. Background and scene-setting come AFTER.

**Structure:**
- P1: One-sentence context that creates tension
- P2: Blockquote or punch line (the grenade)
- P3: Stakes — why this matters, what it changes

### 3. Scanner Rule
Title + opening + subheadings + blockquotes + bold + closing = 80% of the argument. Most people scan. If a scanner gets nothing from your formatting, you lost them. The article must work at TWO speeds: scanning and reading.

### 4. Mobile Rule
No paragraph over 4 sentences. X Articles are read on phones. A 6-sentence paragraph is a wall on mobile. Break it. White space is not wasted space — it is pacing.

### 5. Blockquote Rule
Two types of blockquotes, both mandatory:
- **Pull-quotes**: The article's own strongest lines, extracted and placed as standalone `>` blockquotes between paragraphs. These are the lines that hit hardest — fragment closers, thesis punches, identity statements. They reward scanners and create visual breathing room.
- **Source quotes**: Primary source quotes in `>` blockquotes. Signal evidence.

Minimum 1 blockquote per 500 words across both types. Blockquotes are visual scroll-stops — the eye catches them even while scrolling fast.

### 6. Subheading Rule — Argument Spine
Subheadings are not labels. They are **the argument in condensed form**. Test: read ONLY the subheadings in sequence. They should tell the article's complete thesis — a reader who sees nothing else should understand the core claim.

Each subheading is a short declarative statement of what that section proves. Not a curiosity hook (that's clickbait). Not a topic label ("Background", "Analysis"). A claim.

**Example (from "Caffeine Is Not Energy"):**
- "Adenosine Is The Debt"
- "Caffeine Blocks The Signal"
- "The Debt Compounds Anyway"
- "The Afternoon Crash"

Scan those four lines. You get the entire argument without reading a word of body text. That is the argument spine.

### 7. Bold Rule
1-2 bold phrases per section. Bold the thesis sentence — the one claim that section exists to make. Never bold names, dates, or transitions. Bold is for arguments.

### 8. Closing Rule
End with a callback to the opening image or quote, OR an identity/tension statement that lingers. Never summarize. Never "in conclusion." Never fade out. The last paragraph should hit as hard as the first.

### 9. "Read That Again" Rule
Never tell the reader what to feel or do. No "Read that again." No "Let that sink in." No "Think about that." If the line is powerful, it doesn't need a sign pointing at it. If it's not powerful, the sign won't save it.

### 10. Scene-Setting Rule
Background goes AFTER the hook, never before. The opening is not the place for "In [year], [historical figure] did [historical thing]." That's a textbook. The opening is the place for the most provocative claim, quote, or tension in the entire article. Context earns its place only after the reader is already committed.

## Examples

### Bad opening (violates Rule 1, 9):
> In 208 AD, the Roman Emperor Severus invaded Scotland and got bogged down fighting the Caledonians. The Roman senator and historian Cassius Dio, writing from Rome, recorded what the campaign revealed about these people.

### Good opening (follows Rule 1, 9):
> A Caledonian woman said this to the Roman empress. In 208 AD. To her face.
>
> > "We consort openly with the best men, whereas you let yourselves be debauched in secret by the vilest."
>
> **She wasn't boasting. She was describing a mating system.** One that the DNA now confirms.

### Bad subheadings:
- The Hybrid Mating System
- The DNA Confirms It
- The Pendulum
- But the Framework Is Gone

### Good subheadings:
- Three Layers
- The DNA Doesn't Lie
- The Return
- The System Without the Village
