# ADR: Manuscript Engine

Status: accepted (2026-06-15). Implementation in progress on `feat/manuscript-engine`.

## Context

OpenWriter holds book-scale work as hundreds of small, atomic docs (one prose
beat per `.md`, organized into workspace containers). Publishing — to KDP or to
an agent/publisher — requires assembling those atoms into one elegant file
(EPUB/DOCX/PDF). The naive path (flatten beats into ever-larger docs) destroys
everything the atom model buys: per-block node identity, the agent-writes /
human-reviews loop, granular versioning, cross-channel reuse.

This is also the "book-export pipeline" that [docs/footnotes.md](../docs/footnotes.md)
and [adr/footnote-system.md](footnote-system.md) explicitly deferred to
"book-export time" (cross-chapter footnote renumbering, EPUB/PDF output).

## Decision (architecture)

A book is a **binding, not a file**: an ordered manifest of pointers to existing
docs, projected through a render step into a single output. The engine provides
only **docs + pointers + compile/render**. It encodes **no book semantics** —
"beat", "weld", "chapter-as-idea", and the assembly *methodology* are
[/book-writer](../../..) skill convention, not engine concepts. The same way
OpenWriter already doesn't know what a "chapter" is (the skill organizes
containers and calls them chapters), the engine doesn't know what a "book" is.

### Current invariants

1. **The manifest is a normal doc** of `content_type: manuscript`, whose body is
   an ordered list of `[text](doc:DOCID)` pointers grouped under `##` headings,
   plus an optional `::: meta` render-config block and a `{{toc}}` directive.
   Order = line position. Reorder = move the line. No per-doc sequence numbers.
2. **Pointers resolve by stable docId, never by title.** `filenameByDocId` →
   `readFrontmatter().content`. Rename-safe by construction; location-independent
   (a referenced doc may live in any workspace/container, or none).
3. **Compiled bodies are canonical/accepted only.** The on-disk `.md` body is the
   accepted text; pending agent suggestions live in the `_pending/<docId>.json`
   sidecar and never reach a compiled manuscript.
4. **The compiler core is pure and renderer-agnostic.** `parse` (manifest →
   model) and `assemble` (model + body map → one master markdown) do no I/O and
   are unit-tested without a server. `resolve` is the only disk-touching step.
   Every render target (EPUB/DOCX/PDF/HTML-preview) consumes the same master
   markdown — so **preview and export are one pipeline**, differing only in the
   final step (this guarantees preview never lies about the export).
5. **Footnotes are namespaced at assembly, not renumbered.** Each doc's `[^n]`
   labels (numeric or mnemonic) are made globally unique (`[^fn<ordinal>-<label>]`)
   so ref↔def matching survives concatenation; *display* numbering is left to the
   renderer (markdown-it-footnote / pandoc number sequentially by encounter).
   This realizes the cross-chapter renumbering deferred in adr/footnote-system.md.
6. **Heading demotion** shifts each doc's internal headings down one level so they
   nest under the chapter heading (rendered at h1). Code fences are skipped.
7. **Render/presentation is a separate layer built after the engine.** Aesthetic
   choices (typography, trim, chapter openers, running heads) are applied at
   render via a swappable theme stored in `manuscriptContext` — never baked into
   content. Semantics live in the atom; aesthetics live in the render.
8. **No exclusive UI for roles the general mechanism serves.** A "weld"
   (transition prose) is just an ordinary doc linked at a seam — no weld type, no
   weld container, no weld syntax. Position in the manifest is the only thing that
   makes a doc a transition.

### Surfaces (engine)

- Compiler core: `server/manuscript/{parse,assemble,resolve,index}.ts`.
- Render adapters (later phase): reuse `export-routes.ts` markdown-it config +
  `@turbodocx/html-to-docx`; EPUB needs a pure-JS generator (no external binary
  like pandoc — OpenWriter ships via `npx` and cannot assume system binaries).
- Content type `manuscript` (later phase): right-rail Review-slot takeover on
  manuscript docs (carries pending review, then Manuscript / Compile / Preview /
  Settings), main-canvas Manifest⇄Preview toggle. No new rail icon.
- MCP: `compile_manuscript` / `export_manuscript` (later phase).

## Decision log

- **2026-06-15** — Engine/skill line drawn: engine = docs + pointers +
  compile/render; all book semantics + assembly methodology are /book-writer
  convention. Welds collapse to "ordinary docs linked at a seam" (no engine
  support). Render/theme split out as a post-core layer. Footnote namespacing
  chosen over sequential renumbering (renderer owns display numbers).
- **2026-06-15** — Phase 1 landed: pure compiler core (`parse` + `assemble` with
  footnote namespacing, heading demotion, fenced-code-aware transforms, `{{toc}}`
  generation, unresolved-pointer surfacing) + `resolve` (docId→canonical body) +
  orchestrator, with `scripts/test-manuscript-assemble.mjs`.
- **2026-06-15** — Phase 2 landed: render adapters (HTML book page, EPUB3 via
  jszip, DOCX) over the master markdown; the same default-theme CSS feeds preview
  and EPUB (WYSIWYG). Proven end-to-end on real chapters (16 beats → valid EPUB3).
- **2026-06-15** — Render polish: the HTML *preview* follows the reader's OS dark
  mode while the EPUB stays print-light (e-readers do their own inversion);
  default theme switched to spaced paragraphs. Future direction (deferred): a
  manuscript "publish" target that hosts the HTML render as a shareable
  web-readable book draft — same render, a new output sink, reusing the
  connections/publishing machinery.
- **2026-06-15** — Manifest owns the heading hierarchy. The manifest's heading
  levels map to book levels (`## chapter` → h1, `### section` → h2, … = level − 1,
  clamped); headings with no beats still render (structural dividers); a beat's
  own headings are demoted to nest just below its enclosing manifest heading.
  Beats stay pure prose — section structure lives in the binding, never on the
  atom. `## = chapter` preserves the prior convention, so existing `##`-only
  manifests render byte-identically (verified on the live book: 8 chapters
  unchanged); deeper levels are purely additive. Nav (TOC + tick-rail) stays
  chapter-level (book-h1) by choice; sub-sections render in the book + EPUB nav.

- **2026-09-07** — Extracted manuscript MCP tools into the manuscript module, preserving their behavior before adding the editing-draft action.

- **2026-09-07** — Added **Create editing draft**: compile accepted manuscript
  content into a new ordinary document with fresh identity, independent body,
  source reference, and an original-copy commit in Versions. This is an explicit
  editorial edition; assembly and source beats retain their existing identities
  and never receive copy edits. Pending source proposals are excluded, unresolved
  pointers stop creation, and later source edits cannot change the copy.
  HTTP and MCP share one creation function. MCP returns identity and chapter
  headings without returning the manuscript body. The copy opens with a compact
  chapter outline in the existing sidebar; Files remains available on demand.
  Existing bounded reads, pending review, and version restores serve the edition.

- **2026-09-08** — Replaced standalone editing-draft placement with a Revision
  variant under the manuscript. Accepted-only compilation, independent body,
  references, and original-copy version remain. The normal document editor and
  Focus mode replace draft-specific Chapters/Files navigation. The old MCP and
  HTTP creation names call the common revision service for compatibility.
