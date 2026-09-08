# Browser-Write Fidelity — content_type owns the surface; the write boundary refuses body-collapse

## Context

A document accumulates ancillary per-channel metadata blobs as it is
repurposed across channels. A blog post reused for an X article gains an
`articleContext` blob (cover images, mark-posted tracking) while keeping
`content_type: "blog"` and its full `blogContext`. The on-disk frontmatter
then carries BOTH `blogContext` and `articleContext`.

OpenWriter's editor surfaces are not interchangeable. They use different
TipTap extension sets:

- The blog / newsletter / plain surfaces use the full `padExtensions`
  schema (tables, task lists, code blocks, footnotes, all heading levels).
- The X-article (`articleExtensions`) and tweet (`tweetExtensions`)
  compose surfaces use a deliberately NARROWER schema — what those
  channels can actually render. `articleExtensions` drops tables, task
  lists, code blocks, footnotes, highlight/sub/superscript, and heading
  levels beyond H3.

All surfaces edit the SAME doc body and autosave to the SAME `.md` file.

**The incident (2026-05-31, doc `5839a494`).** A `content_type:"blog"` pillar
(2,590 words) that also carried `articleContext` rendered in the X-article
compose surface, which mounted empty/near-empty (it could not faithfully hold
the body), then autosaved that empty surface back over the file. The body
collapsed from ~50 nodes to a single node on disk; the node-identity matcher
faithfully recorded the total wipe by moving the entire prior node set into
`graveyard:`. Version history shows `19408 → 3378 → 920 bytes`. Pure silent
data loss, recoverable only because a prior autosave snapshot survived.

Two coupled architectural defects produced this:

**A. View selection ignored the canonical type.** `App.tsx` chose the editor
surface purely from which `*Context` blob was present, in the precedence
`article > blog > newsletter > tweet > plain`. It never read `content_type`
— the field that declares what the doc IS. So a blog that had accumulated
`articleContext` was routed into the narrower article surface.

**B. The no-clobber guard sat on one of several writer functions.** A
destructive-collapse guard already existed inside `updateDocument`
(`incomingNodes < currentNodes * 0.3` → block). It even fired in the incident
log (`BLOCKED destructive updateDocument: 1 nodes would replace 60 nodes`).
But the clobber still reached disk, because browser doc-updates reach
canonical/disk through THREE functions and the guard was on only one:
`updateDocument` (current-version, guarded), `syncBrowserDocUpdate`
(stale-version, unguarded — sets `state.canonical` directly), and
`saveDocToFile` (wrong-filename race, unguarded — writes disk directly). A
guard at one consumer cannot protect a class of writes that reach disk through
sibling paths.

## Current invariants

- **`content_type` is the single source of truth for which editor surface
  OWNS the body.** `App.tsx`'s `resolveContentType(metadata)` returns the
  explicit `content_type` (snake_case `content_type` or camelCase
  `contentType`) when present; otherwise it derives from `*Context` presence
  with **body-bearing types first** (blog → newsletter → article → tweet →
  linkedin → document). The view selector keys off this resolved type, not
  off raw `*Context` presence. A `content_type:"blog"` doc renders the blog
  editor regardless of any `articleContext`/`tweetContext` it carries.
- **`*Context` blobs are per-channel data, never surface selectors.**
  `articleContext.coverImages`, `tweetContext.mode`, etc. are read by their
  compose views for cover art and posting state — they do not decide which
  surface renders.
- **The tweet compose surface renders only when `content_type` designates a
  tweet type AND `tweetContext` is present** (`isTweet && metadata.tweetContext`).
  A malformed tweet doc missing its context falls back to the plain body
  editor (safe — no narrower-schema clobber), never crashes.
- **The no-clobber invariant lives at the BROWSER-WRITE BOUNDARY, uniformly.**
  `wouldCollapseBody(current, incoming)` (`server/state.ts`) is called by all
  three functions that replace canonical from a browser-sent doc:
  `updateDocument`, `syncBrowserDocUpdate`, and `saveDocToFile`. A replacement
  that collapses a substantial body (`>5` nodes) to under 30% of its node
  count is treated as a view artifact, not an edit, and is REFUSED.
- **Refuse is checkpoint-then-refuse, never silent.** On collapse, the
  current good on-disk body is snapshotted via `forceSnapshot` (the file is
  untouched at that moment, so the snapshot captures the good content), the
  write is refused, and a `console.error` `[State] REFUSED body-collapse …`
  line is emitted. The populated body stays on disk and in memory.
- **Trusted paths are deliberately NOT gated by this invariant.**
  `restore_version`, MCP edits, and agent `applyChanges` mutate canonical
  through other functions (`setPrimaryFromMerged` / `restoreVersion` →
  `updateDocument`) and are trusted to shrink a doc intentionally. Note
  `restore_version` does route through `updateDocument`, but recovery-restores
  GROW the doc (incoming > current), so they pass the collapse check freely;
  only a restore to a much-smaller version is refused (acceptable, and the
  good content is checkpointed).
- **Do NOT move this invariant down to `writeToDisk`.** That chokepoint is
  shared by trusted shrinking paths (restore, agent rewrites); guarding there
  would block legitimate intentional shrinks. The browser-write boundary is
  the correct layer because it is exactly where untrusted, possibly-lossy
  surface content enters.

## Decision log (append-only)

### 2026-05-31 — content_type authority + boundary-consolidated clobber guard

- **Trigger.** Doc `5839a494` (`content_type:"blog"`, 2,590 words, also
  carrying `articleContext`) rendered in the X-article compose surface, which
  mounted empty and autosaved over the body — collapsing it to one node on
  disk (`19408 → 920 bytes`). Setting `articleContext: null` flipped it back
  to the blog editor and the body reappeared, confirming the trigger was
  `*Context`-presence view selection.
- **Diagnosis (rejected the brief's "add a clobber guard" framing).** Two
  coupled patterns: (A) the view selector inferred the surface from ancillary
  `*Context` blobs instead of canonical `content_type`; (B) a no-clobber guard
  already existed but on only one of three browser-write functions — the
  incident log proved it fired on `updateDocument` yet the clobber still
  landed via a guardless sibling path.
- **Fix A.** `App.tsx`: replaced `hasArticleContext/hasBlogContext/
  hasNewsletterContext` presence checks with `resolveContentType(metadata)`
  (explicit content_type first; body-bearing derivation fallback). View
  selection and the `data-view` attribute key off the resolved type.
- **Fix B.** `server/state.ts`: extracted the inline `updateDocument` guard
  into a shared `wouldCollapseBody()` + `checkpointActiveBody()`, and applied
  checkpoint-then-refuse at all three browser-write paths (`updateDocument`,
  `syncBrowserDocUpdate`, `saveDocToFile`). Trusted restore/MCP/agent paths
  are unaffected; recovery-restores grow the doc and pass.
- **Why not the brief's prescription.** The brief proposed adding a guard to
  reject empty-surface saves. A guard already existed and was bypassed; adding
  another at the symptom site would repeat the mistake. The architectural move
  was (A) make `content_type` govern the surface so a blog body never mounts a
  narrower schema, and (B) consolidate the invariant onto the browser-write
  boundary so no sibling path can bypass it.

### 2026-09-07 — Manuscript editing drafts

Editing drafts explicitly use content_type document and the full PadEditor schema; their provenance changes navigation only.

### 2026-09-07 — UX audit closure

All five PadEditor surfaces receive stable metadata docId; auto-title rename preserves current editor text and history. Reading views render accepted text without joining the writing session.

### 2026-09-07 — Shared browser mutation bookkeeping

Stale-version merges retain their incoming-body fidelity check and install the merged view through updateDocument. This shares persistence version bookkeeping with current-version edits; it does not weaken body-collapse checks.
