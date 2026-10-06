# Footnotes — Author Guide for Agents

OpenWriter supports CommonMark / Pandoc footnote syntax for citation-heavy
long-form writing. The editor renders inline references as superscript
chips and corrals definitions into an end-of-doc "Footnotes" section.

This doc explains how to write footnotes via MCP tools and what to expect
on disk and in the editor.

## The syntax (Pandoc / CommonMark)

Two parts:

- **Reference** (inline): `text[^N]` — appears in the prose
- **Definition** (block): `[^N]: footnote text` — appears at end of doc

Labels can be numeric or mnemonic:

```markdown
The body repairs itself during deep sleep[^1] too.

Per Sapolsky[^sapolsky2017], stress responses follow a pattern.

[^1]: Eibl-Eibesfeldt 1973, replicated and extended by Galati et al. 2003.

[^sapolsky2017]: Sapolsky, R. (2017). *Behave*. Penguin Press.
```

The author label (`1` or `sapolsky2017`) is what pairs reference to
definition. **Display numbering is automatic** — the editor's CSS counter
shows sequential `[1] [2] [3]` regardless of label. Mnemonic labels stay
on disk for human-readable file diffs.

## How to write footnotes from MCP

Just include the syntax in your markdown content — no special tool needed.

### populate_document (initial draft)

```ts
populate_document({
  docId: "abc12345",
  content: `# Chapter 1

Theory of mind develops late[^1] in non-human primates.

[^1]: Premack & Woodruff (1978), Behavioral and Brain Sciences 1: 515–526.
`
})
```

The parser handles `[^1]` references and `[^1]: ...` definitions. The
editor renders the reference as a superscript chip and the definition
inside an end-of-doc "Footnotes" section.

### write_to_pad (adding to existing doc)

To add a new footnote to existing prose, you have two paths.

**Append a new reference + definition together** (recommended):

```ts
// Step 1: rewrite the paragraph to add the reference
write_to_pad({
  docId: "abc12345",
  changes: [
    {
      operation: "rewrite",
      nodeId: "para_id",
      content: "The same sentence now with a new claim[^2]."
    }
  ]
})

// Step 2: append the definition. If the doc already has a footnoteSection,
// you can insert the definition inside it via afterNodeId pointing at the
// last definition. If the doc has no footnotes yet, the parser auto-creates
// the section when it sees `[^N]: ...` at the end of the markdown body.
```

**Simpler: just include both the reference and the definition in one
write_to_pad call**:

```ts
write_to_pad({
  docId: "abc12345",
  changes: [
    {
      operation: "rewrite",
      nodeId: "para_id",
      content: "Sentence with new claim[^2]."
    },
    {
      operation: "insert",
      afterNodeId: "end",
      content: "[^2]: Smith et al. (2020), Nature 580: 142–148."
    }
  ]
})
```

The serializer normalizes definitions to the end-of-doc `footnoteSection`
regardless of where they're inserted in the tree.

## What you see in `read_pad`

```
title: My Chapter
id: abc12345
words: 423
pending: 0
---
[h1:aa0001] Chapter 1
[p:bb0002] Theory of mind develops late[^1] in non-human primates.
[fnsec:cc0003]
  [fndef:dd0004] [^1]: Premack & Woodruff (1978), Behavioral and Brain Sciences 1: 515–526.
```

The `[^N]` in the body is the inline reference. `[fnsec:...]` is the
end-of-doc section. `[fndef:...]` is each definition.

## Per-doc scope — important

**Footnote labels are local to each doc.** Chapter 3's `[^1]` does not
refer to Chapter 4's `[^1]`. Each chapter is its own `.md` file with its
own numbering. Cross-chapter references are not supported at the editor
level (a future book-export pipeline will handle global numbering at
typeset time).

If the author writes "see Ch 1 note 4" they're writing prose, not a
cross-doc footnote link.

## Multi-paragraph definitions

Pandoc allows multi-paragraph footnotes via 4-space-indented continuation:

```markdown
[^1]: First paragraph of the definition.

    Continuation paragraph, indented 4 spaces.

    Another continuation.
```

The editor preserves the multi-paragraph structure inside the definition.
Use this for footnotes that need substantial explanation (lengthy
methodology notes, multi-source citations, etc.).

## What's NOT supported (yet)

- **Cross-doc footnote references.** Each doc has its own numbering.
- **Bibliography auto-generation.** Authors manage citation text inline.
  Zotero / Mendeley / BibTeX integration is a future enhancement.
- **DOI auto-resolution.** Footnote text is plain — paste a DOI manually.
- **Per-page footnotes (Phase 3).** The editor uses end-of-doc placement;
  per-page placement is a print-layout concern handled at book-export
  time, not in the editor.

## When to use footnotes vs inline parentheticals

Use footnotes when:
- The citation count exceeds ~3 per ~500 words (inline parentheticals
  start visibly disrupting the prose at that density)
- The audience expects an academic register (popular nonfiction in the
  Sapolsky / Wrangham / Pinker lineage)
- The work targets book-class output (cumulative citation load at book
  scale destroys readability under inline parentheticals)

Use inline parentheticals when:
- Citations are sparse (<1 per 500 words) and short
- The author prefers a journalistic register
- The work is short-form (tweet thread, blog post) where there's no
  end-of-doc section to defer to

## Reference docs (for the editor maintainers, not agents)

- `docs/footnotes.md` (in the openwriter repo): full architecture
- `adr/footnote-system.md`: load-bearing invariants + decision log
