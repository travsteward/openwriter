# Shape Table (book-level project dashboard)

A flat, scannable table that renders the state of a book project at a glance. Columns capture the three layers the book runs on: chapters, beats, drafts. Each chapter gets one row. A totals row at the bottom rolls everything up to a single project % done.

This is the canonical project dashboard for any book project. Same structure across books — substrate-agnostic, intuitively readable, and tight enough to fit in a single screen.

## When to render

Render the shape table when the user asks:
- "Where are we"
- "Shape table" / "project shape" / "book status"
- "% done" / "how far along"
- "What have we done"
- "Status check" / "progress" / "dashboard"
- Any open-ended state-of-the-project question

Render proactively at the start of a session when picking up a book project that has been worked across multiple sessions — gives the user (and the agent) a shared map before any new work starts.

## Output structure

Three components, in order:

1. **The shape table** — one row per chapter + a totals row at the bottom
2. **The % derivation** — small table showing how the project-level % was computed
3. **Reading the table** — short narrative paragraph naming what stands out (complete pilots, in-flight chapters, untouched chapters, structural debt, fastest path forward)

## The shape table columns

| Column | What it captures |
|---|---|
| Chapter | "Ch N — Title" exactly as the chapter container is named in the workspace |
| Beats sheet | "locked (N beats)" where N is the count of beats in the chapter's Beats doc. Add version suffix if the doc has been rebuilt (e.g., "locked v3", "locked v4"). |
| Research Notes | "canonical (Nw)" if a Research Notes doc exists and is marked canonical. "MISSING" in caps if absent. |
| Beats drafted | "X / Y" where X is the count of beat-prose docs in the chapter's Drafts subcontainer and Y is the total beat count from the Beats doc. Add parenthetical for orphans (e.g., "(1 orphan B23)"). |
| Prose words | Sum of word counts of all docs in the chapter's Drafts subcontainer. "0" if empty. |
| Target | The chapter's word target range from the committed TOC (e.g., "5-6k", "10-12k"). |
| % done | Composite weighted, computed per the formula below. Bold this column for emphasis. |

## % done formula

Three-component composite per chapter:

| Component | Weight | What it measures |
|---|---|---|
| Beats sheet locked | 15% | Architectural commitment (1.0 if locked, 0 if not) |
| Research Notes canonical | 15% | Citation infrastructure ready (1.0 if canonical, 0 if missing) |
| Beats drafted | 70% | Prose progress (drafted / total beats, proportional) |

Per chapter:

```
% done = (beats_sheet × 0.15) + (research_notes × 0.15) + (drafts_ratio × 0.70)
```

Round to integer percent.

Project total uses the same formula applied at project level:
- Beats sheet share: chapters with locked beats / total chapters
- Research Notes share: chapters with canonical RN / total chapters
- Drafts share: total beats drafted across all chapters / total beats across all chapters

## Conventions

- **Bold** the % done column values for emphasis.
- ✓ checkmark next to 100% chapters.
- "MISSING" in caps for absent canonical artifacts.
- Use exact chapter titles as they appear in the workspace.
- Show totals row at the bottom with the project-level numbers, body cells in **bold**.
- Target word range mirrors the TOC commitment; do not invent it.
- If the project has versioned Beats docs (v1, v2, v3 supersession), show the current locked version (e.g., "locked v3").

## Data gathering

For each chapter, the agent needs:

1. **Beat count from Beats doc.** Read the chapter's Beats doc. Count beat headers (typical patterns: `**Bn —`, `### Bn`, `**Bn:**`, or `[h3] Bn —`). The Beats doc usually states the beat count in its preamble; verify by counting against the body since the preamble can be stale after revisions.

2. **Research Notes status.** Check the chapter container for a doc titled `Ch N — Research Notes`. Read its `status` metadata (canonical vs draft). Capture word count.

3. **Drafts inventory.** List the chapter's Drafts subcontainer. Count docs that match the `Ch N — Bk:` naming pattern. Sum word counts. Note any docs that look orphaned (e.g., a B23 sitting in a top-level Drafts container instead of inside the chapter container).

4. **Word target.** From the committed TOC doc. The TOC names each chapter and gives a target range. If the chapter doesn't yet appear in the TOC, mark target "TBD".

Use `get_workspace_structure` first to map the whole workspace. Then `read_pad` on each Beats doc for beat counts. Then aggregate.

## Example output (a sleep book mid-draft)

```
| Chapter | Beats sheet | Research Notes | Beats drafted | Prose words | Target | % done |
|---|---|---|---|---|---|---|
| Ch 1 — Why Sleep Exists | locked (15 beats) | canonical (865w) | 3 / 15 | 1,694 | 5-6k | **44%** |
| Ch 2 — Sleep Pressure | locked (26 beats) | canonical (393w) | 4 / 26 | 2,132 | 8-10k | **41%** |
| Ch 3 — Deep Time | locked (13 beats) | canonical (244w) | 0 / 13 | 0 | 8-10k | **30%** |
| Ch 4 — Dreaming | locked (17 beats) | MISSING | 0 / 17 | 0 | 7-8k | **15%** |
| Ch 5 — Two Clocks | locked (14 beats) | canonical (956w) | 14 / 14 | ~6,700 | 6-8k | **100%** ✓ |
| Ch 6 — The Modern Assault | locked (19 beats) | canonical (2,841w) | 19 / 19 | ~11,380 | 10-12k | **100%** ✓ |
| Ch 7 — Sleep Debt | locked v3 (22 beats) | MISSING | 9 / 22 | ~4,900 | 10-11k | **44%** |
| Ch 8 — Repayment | locked v4 (31 beats) | MISSING | 0 / 31 (1 orphan B23) | 0 | 10-11k | **15%** |
| Ch 9 — Frame | locked (20 beats) | MISSING | 0 / 20 | 0 | 7-8k | **15%** |
| Ch 10 — Tribal Regulation | locked (20 beats) | MISSING | 0 / 20 | 0 | 6-7k | **15%** |
| Ch 11 — Modern Animal | locked (15 beats) | MISSING | 0 / 15 | 0 | 5-7k | **15%** |
| **TOTAL** | **11/11 chapters** | **5/11 chapters** | **49 / 212 beats** | **~26,800** | **~85-98k** | **38%** |
```

Followed by the derivation table:

```
| Project layer | Status | Weight |
|---|---|---|
| Beats sheets locked | 11 / 11 chapters = 100% | × 15% = **15.0%** |
| Research Notes canonical | 5 / 11 chapters = 45% | × 15% = **6.8%** |
| Beat-level prose drafts landed | 49 / 212 beats = 23% | × 70% = **16.2%** |
| | | **38.0%** |
```

Followed by a short narrative naming what stands out: complete pilots, in-flight chapters, zero-draft chapters with structural debt, missing Research Notes, fastest path forward by % gain.

## Why this composite

The three-layer weighting reflects the actual cost distribution of book work:

- The beats sheet is the architecture commit. Cheap to produce, but everything downstream rests on it. 15% reflects that landing it is real progress and most of the work still remains.
- Research Notes is the citation infrastructure that lets the prose stand on real science. Also cheap. 15% same.
- Beat-level prose drafts are where the book actually exists as readable text. 70% reflects that the prose pour is the bulk of book work.

A chapter with locked beats and canonical RN but zero drafts sits at 30% — three of ten parts done. A chapter with the full pilot drafted and beats and RN locked sits at 100%. A chapter with locked beats, no RN, and partial drafts (e.g., 9 of 22 beats) sits in the 40s, capturing that the architecture exists but the prose is in flight.

## Anti-patterns

- Do not render this table when the user asks a narrower question ("how many beats are in Ch 5?", "is Ch 6 done?"). Answer the narrower question directly.
- Do not skip the totals row. The project-level number is the primary read.
- Do not invent target word ranges. If the committed TOC doesn't specify, mark "TBD".
- Do not count orphan drafts as in-chapter beats drafted. Note them as orphans in the row's cell and exclude from the X count.
- Do not render the table without verifying beat counts against each Beats doc body. The preamble line can be stale after revisions; the body is ground truth.
- Do not add columns the user did not ask for. The seven columns above are the canonical layout. If a project needs additional state (e.g., vignette inventory status), surface it in the narrative below the table, not as a new column.

## Companion: per-beat inventory (drill-down)

When the user wants to see exactly which beats have been drafted (not just counts), follow the shape table with a per-beat inventory: a flat list of every drafted beat across the book, one row per beat, columns `Chapter | Beat | Title | Words`. This is a drill-down view, not a replacement for the shape table. Render only when the user explicitly asks for beat-level detail.
