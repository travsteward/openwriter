# Manuscript Binding — stitching beats into a publishable book

How a book made of hundreds of atomic beat-docs becomes one elegant, publishable file (EPUB/DOCX/PDF for KDP or a publisher) **without ever flattening the atoms**.

**Terms.** The manifest doc this file describes is the book's **Outline** (create menu: "Book outline"; title "<Book> — Outline"). The **Manuscript** is the full text built from the outline once; after that it *is* the book. Read *After the manuscript is built* before touching a book that has one.

---

## The governing principle

**A book is a *binding*, not a file.** It is an ordered manifest of references to docs you already have, projected through a render step into a single output. The atoms (beats) stay atomic; composition happens at a layer *above* them. The single publishable file is an **output**, never the working form.

The anti-pattern — the obvious move — is to flatten beats into one chapter doc, then chapters into one book doc. That throws away everything the beat system buys: per-beat node identity, the agent-writes-one-beat / human-reviews-one-beat loop, granular versioning, clean diffs, cross-channel reuse. Flattening signs all of that away the moment before you publish. Don't.

### Why the atoms must stay atomic

The beat is an **atom** precisely because it is context-independent — it resolves its own move and doesn't know what sits beside it. The instant a beat's prose reaches forward ("…which brings us to the body clock"), it is coupled to its neighbour and stops being reorderable, cuttable, or reusable. Keep coupling out of the atom; let the **binding** own all cross-doc relationships (order, adjacency, transitions).

> **Transitions/bridges (welds) are a property of the EDGE between two beats, not of either beat.** Where the bridge actually originates — a binding-level weld doc, or a beat-level commitment written by the minion — is a separate, deferred writing-side decision (see *Deferred: the writing side*). The binding architecture supports either.

### Headings belong to the binding, never the beat

**A beat contains NO headings — no chapter title, no section header, not even its own title. It is pure prose: the move, nothing else.** All heading structure is declared in the **manifest** and applied at compile time. This is the same atomicity principle as "don't point forward": a title baked into a beat couples the atom to one position and one book, so the same beat reused elsewhere drags a wrong header with it.

The manifest owns the book's entire heading hierarchy, by level:

| In the manifest | Renders in the book |
|---|---|
| `## Chapter 1 — <Title>` | `#` (h1) — a chapter |
| `### <Section>` | `##` (h2) — a section within a chapter |
| `#### <Subsection>` | `###` (h3) |

(The mapping is *manifest level − 1*. `## = chapter` is the convention.) A header that should sit **above** a beat is written in the manifest, on its own line, at the level you want — never at the top of the beat. A manifest heading needs no beats of its own to render, so a bare "Part One" divider or a mid-chapter section title is just a manifest line. If a beat *does* carry an internal heading (e.g. an imported doc), the compiler demotes it to nest below its enclosing manifest heading — but the rule is: **don't author one there.** The manifest is the single place you control the whole heading tree, without ever touching prose.

---

## Where it lives (two distinct "wheres")

**1. The binding itself (per-book data) → an Outline doc in the book's Book Spine container.**
It is the **executable evolution of the committed `TOC` doc** the book already maintains. The TOC is plain text; the Outline is the same table of contents expressed as ordered `doc:` links, plus front/back matter and optional weld docs. Not a new alien object — the TOC, made compile-able. One per book (or one per render target — see *Multiple bindings*).

**2. The convention + compile mechanism (doctrine) → this doc, in `/book-writer`.**
The manifest is *shape* (structure + order), so it belongs to `/book-writer`, not `/authors-voice` (voice). The OpenWriter product surface that compiles it is documented in the OpenWriter repo (`adr/manuscript-engine.md`); the writing-process convention stays here.

---

## The reference primitive: `doc:` links, resolved by docId

OpenWriter does **not** have `[[wikilink]]` syntax. Its cross-doc primitive is a standard markdown link with a `doc:` href:

```markdown
[Ch 2 — B1: Adenosine](doc:9bee893b)
```

- **`docId`** is an **8-char lowercase hex** id, minted at doc creation, **stable across rename, edit, and move**. The filename equals the (renamable) title; the docId never changes.
- A `doc:` link is **resolved by docId**, never by title. The resolver scans each `.md`'s frontmatter for the `docId` field — there is no index file, an O(N) scan, trivial at book scale.
- Therefore **references survive renames for free** — this is inherent, not engineered. After a rename only the human-readable *link text* may read stale; the link still resolves. (Optionally refresh the text; resolution never breaks.)
- A `doc:` link in body prose also **registers the manifest as a connection source** → a backlink appears on the target beat (doc-level prose `doc:` links sync into the manifest's `references:` frontmatter; backlinks are computed live as the inverse of all `references:`).

This is *better* than wikilinks would have been: stable-by-construction, clickable in the UI, and backlink-generating.

---

## How order is marked

**Order = the position of the line in the manifest. Nothing else.**

The Outline doc lists member docs as `doc:` links, top to bottom, in reading order. To reorder, **move the line**. There are **no per-doc sequence numbers anywhere** — single source of truth, nothing to renumber, no drift.

### Manifest format

````markdown
# <Book Title> — Outline         ← the doc's title (frontmatter). content_type: manuscript.

## Front Matter
- [Title Page](doc:aaaaaaaa)
- [Copyright](doc:bbbbbbbb)
- [Dedication](doc:cccccccc)
{{toc}}                          ← generated contents (chapter headings), clickable

## Chapter 1 — Circadian Rhythms   ← chapter → renders as book h1
- [Ch 1 — B1: The body keeps time](doc:9bee893b)
- [Ch 1 — B2: Light sets the clock](doc:1a2b3c4d)

### The Master Clock             ← a section within the chapter → renders as book h2
- [Ch 1 — B7: The cave experiments](doc:5677f483)

## Chapter 2 — Sleep Pressure
- [Ch 2 — B1: Adenosine](doc:11223344)
…

## Chapter 7 — Sleep Debt
- [Weld: Ch 6 close → Ch 7 open](doc:77665544)   ← a weld is just an ordinary doc, linked at the seam
- [Ch 7 — B1: The all-nighter cold open](doc:99887766)
…

## Back Matter
- [Notes & Citations](doc:dddddddd)
- [About the Author](doc:eeeeeeee)
````

Element semantics (all interpreted by the **compile step** — the file is a normal markdown doc):
- `## Chapter N — <Title>` — a chapter heading. Renders as book `# <Title>` (h1) and drives `{{toc}}`.
- `### <Section>` / `#### <Subsection>` — section / sub-section headings (book h2 / h3). The manifest owns the *whole* heading hierarchy (level − 1). They render in the book and the EPUB's own nav; they are not listed in the chapter `{{toc}}`. **Beats carry no headings — see *Headings belong to the binding*.**
- `- [Text](doc:DOCID)` — a list item: "insert this doc's clean body here, in this position." Order = top-to-bottom. (The editor stores the href angle-bracketed, `[Text](<doc:ID>)`; the compiler tolerates both.)
- `{{toc}}` — a generated contents directive (clickable list built from the chapter headings).
- **Render meta** (title, author, paragraph style) lives in the doc's **frontmatter / `manuscriptContext`** — not a body block. Building copies it to the manuscript, whose Exports tab sets the paragraph style.
- A **weld** is just an ordinary doc linked at its seam, like any other beat — no special syntax.

### What the manifest unifies

- **Order + membership** are unified in the ordered `doc:` links: a beat is "in the book" iff it's linked here, in the position where it's linked. Single source of truth.
- **Backlinks** are a derived bonus: the manifest's `doc:` links light up "bound-in-manuscript" backlinks on each beat, so "which drafted beats aren't placed yet?" is answerable. *(Compile does NOT depend on backlinks — it parses the body links directly. If the on-save `references:` sync ever proves unreliable, seal membership explicitly with `link_to(outline, beat)`; order still lives only in the body.)*

### Properties that fall out for free

- **Canonical selection by inclusion.** Duplicate draft versions (e.g. a beat's v1 and v2) resolve with zero deletion: link the canonical one; the other simply isn't bound. *The manifest is where "which version is canonical" gets decided.*
- **The flat-folder problem disappears.** OpenWriter stores every workspace's docs flat in one profile directory (a book's beats sit beside unrelated project docs). The compiler **never globs** `*.md` — it follows the manifest, resolving exactly the named docIds in exactly the named order.
- **Reference, don't flatten — fully honored while drafting.** Edit a beat → the outline's compile updates. Atoms stay atomic, node identity survives, the review loop keeps working. Once the manuscript is built, beat edits no longer reach the book (see below).

---

## Building the outline

**Building the manifest** is agent work: walk the book workspace in order (`get_workspace_structure` → containers + filenames), resolve each beat to its docId (`browse_docs` / `get_doc_link` return docId), emit `[Title](doc:DOCID)` lines under `## Chapter` headings in TOC order.

The on-disk format already suits publishing: every doc is JSON frontmatter between `---` fences followed by a **clean markdown body** — node identity lives in frontmatter, and pending (unaccepted) suggestions live in a separate `_pending/<docId>.json` sidecar. So a compiled body is exactly the **canonical, accepted** prose. Compile never hand-edits output — edit atoms + manifest and recompile.

## The OpenWriter book (outline → manuscript)

The outline is a `content_type: manuscript` doc and opens in the normal editor; there is no preview view. Its Review panel builds the **Manuscript**: one ordinary document holding the outline's compiled accepted text, nested under the outline, with a "Built from outline, <date>" version that never ages out. Downloads (EPUB, Word, HTML, Markdown; spaced or indented paragraphs) live on the manuscript's Exports tab and use its accepted text. The outline has no downloads.

Agent tools:
- `create_editing_draft({ docId })` on an outline builds its manuscript. If one exists it refuses; pass `confirm: true` only when the author asked for a second.
- `compile_manuscript({ docId })` reports the structure, the manuscript, and which outline chapters the manuscript lacks or holds as pending changes.
- `add_chapter_to_manuscript({ docId, chapter })` inserts one missing chapter (see below).
- `export_manuscript({ docId, format })` writes the book to a file from the manuscript's accepted text.

Note: `import_gdoc` does the **inverse** — splits an H1-sectioned Google Doc into per-chapter `.md` files inside a "Chapters" container. Confirms the native model is doc-per-file + workspace-for-grouping; compile is its mirror image.

---

## After the manuscript is built

The manuscript is the book. All editing, review and downloads happen there.

- **Never edit beats to change the book.** Beat edits no longer reach it. A beat the manuscript already holds shows a banner saying so.
- **Never export from the outline.** Downloads come from the manuscript.
- **New chapters go through Add chapter.** Draft the chapter as beats under its outline heading as usual, then run `add_chapter_to_manuscript` (or the author clicks "Add <chapter> to manuscript" in the manuscript's Review panel). It compiles that chapter's beats and inserts them before the next chapter the manuscript holds, as one pending change the author accepts or rejects. Report what was inserted and where. It refuses a chapter already present, a chapter with footnotes, and one that would land before the manuscript's first block.
- **One manuscript per outline.** Building another asks first; never pass `confirm` on your own.
- **The original stays.** The "Built from outline" version is a permanent restore point.

## Multiple bindings (why "binding," not "the book file")

Because the binding only *references* atoms, one set of beats can carry **several manifests** — an ebook outline, a paperback outline (different front matter / trim), a serialized-newsletter manifest (different grouping), an audiobook-script manifest. Same atoms, different projections. Start with one Outline doc in Book Spine. Promote to a dedicated `Manuscript` container if/when a second binding appears.

---

## Deferred: the writing side

The beat-drafting pipeline is tuned against real drafts — **changes here are gated behind testing against existing drafts.** Recorded so the binding design stays coherent with it:

- **Principle:** a beat opens *tension* (dopamine; the implication hangs) but should not *point* (prose that names/depends on the specific next unit). Tension stays in the atom; the bridge belongs to the edge.
- **The author's refinement (the correct frame):** if bridging language exists at all, it is a **beat commitment** — author/editor-owned, written by the minion in normal flow — never a skill convention bolted on around the prose. This keeps it inside the tuned layer.
- **Consequence to test:** explicit "Handoff to Ch N" / Act-4 bridge beats either become terminating closers (bridge welded in the binding) or carry a bridge commitment (minion writes it). Test both against drafted chapters before changing doctrine.
- The binding works **either way**: weld docs present when the binding owns the bridge; absent when the beat does.

Cross-ref: when this is taken up, it amends `SKILL.md` (the minion brief at the delegation step — stop feeding "what comes after") and `docs/beats.md` (Pass 2 tension vs. pointing).

---

## Relationship to the other skills

- `/book-writer` (this skill) — owns the binding convention (SHAPE).
- `/authors-voice` — owns weld *prose* if/when welds are authored; owns beat prose. Voice, not structure.
- **openwriter** — holds the live Outline and Manuscript for any book (Book Spine) and compiles them. Point at them; never mirror the manifest elsewhere.

Engine internals (parse → resolve → assemble → render, EPUB/DOCX/HTML/MD renderers): `packages/openwriter/server/manuscript/` and `adr/manuscript-engine.md` in the OpenWriter repo.
