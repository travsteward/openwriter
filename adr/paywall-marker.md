# ADR: The site paywall is a marked horizontal rule, `<!-- paywall -->` on disk

Referenced by `server/markdown-parse.ts`, `server/markdown-serialize.ts`, `server/compact.ts`,
`src/editor/Paywall.ts` and `plugins/publish/src/site-wall.ts` (`adr:` markers at each site).

## Context

Writer sites (`<name>.openwriter.io`, backend repo `openwriter-publish`) copy Substack's wall: the
writer places one wall block anywhere in a post and everything above it is the free preview. The
backend stores the post as sanitized HTML plus `wall_at`, the number of top-level HTML blocks above
the wall, counted by a tag scanner that fails closed (`openwriter-publish/adr/site-access-rule.md`).

The desk needs a wall that (a) survives OpenWriter's markdown parse → serialize round trip and the
node-identity matcher, (b) is invisible and harmless anywhere else the `.md` goes (other editors,
GitHub, static blogs, newsletters, HTML export), and (c) a writer or agent can insert and move like
any block.

Options considered:
- A new `paywall` node type. Clean in the schema, but every block-type table in the server and the
  editor (fingerprints, node-blocks, three LEAF_BLOCK_TYPES copies, compact, peek outline, pending
  attributes, UniqueID) would need a new entry, and a missed one silently drops or mis-tracks it.
- A text line such as `--- paywall ---` or a custom fence. Visible and confusing in every other
  markdown reader.
- A `horizontalRule` carrying `paywall: true`, written as an HTML comment line. Every table already
  handles horizontalRule (an atomic leaf block with identity tag `hr`), the comment is invisible to
  every markdown renderer, and markdown-it parses it as a standalone `html_block`, which is where
  the parser already recognises its other comment sentinel (`<!-- -->` empty paragraphs).

## Current invariants

- On disk the wall is exactly the line `<!-- paywall -->` (parse accepts any case and inner
  whitespace; serialize writes the canonical form). In TipTap it is
  `{ type: 'horizontalRule', attrs: { paywall: true } }`.
- Agents read it in compact output as `[hr:<id>] <!-- paywall -->` and write it by putting the
  `<!-- paywall -->` line in markdown content.
- The editor registers `paywall` as a global attribute on `horizontalRule` (`src/editor/Paywall.ts`)
  so the browser keeps it, and draws it as a labelled dashed divider. The toolbar's paywall button
  keeps one wall per doc: it moves an existing wall to the cursor instead of adding a second.
- Publishing (`plugins/publish/src/site-wall.ts`): the doc is rendered to HTML with the comment
  still in it; `wall_at` is the count of top-level elements before the comment, using the same
  counting rule as the backend's `htmlBeforeWall` (a top-level element ends when its closing tag
  returns to depth 0; void elements count on their own); the comment is then removed.
  - More than one marker is an error the tool reports. A marker inside a list or quote (depth > 0)
    is an error. No marker sends `wall_at: null` (backend: wall at the top for walled audiences).
  - The count holds after the backend sanitizes because the desk only emits markdown-it output of
    known block types (the parser drops raw HTML blocks), all of which are on the sanitizer's
    allowlist at top level.

## Decision log

- **2026-10-06 — Marked horizontal rule, HTML comment on disk.** Chip F of the publication platform
  mission. Chosen over a new node type to stay inside the block tables that already exist, and over
  a visible text marker so the `.md` stays clean everywhere else.
