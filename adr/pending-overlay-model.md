# Pending state lives in a sidecar, not in frontmatter

## Context

Pending changes (agent rewrites/inserts awaiting user review) used to live
in the .md file's YAML frontmatter as `meta.pending`. That model
collapsed three different bugs into one shape:

- **Round-trip corruption on restore_version.** The frontmatter was a
  lossy projection of the in-memory pending tree. Round-tripping through
  serialize → write → read → deserialize lost the `originalBaseline`
  needed to revert a rewrite. Restore-version then wrote a partially-
  reverted body back to disk, corrupting the canonical content.
- **Silent overwrites on external edits.** Any tool that touched the
  .md file (VSCode, scripts, `Edit`) had to know to preserve the
  `meta.pending` block or it would silently drop pending state.
- **Pending leakage into derived views.** The frontmatter pending blob
  appeared in every grep, every backup, every diff. It was on-disk noise
  that didn't belong in the canonical document.

Architectural move: split pending state out of the canonical file
entirely. Canonical .md files contain only accepted content. Pending
state lives in `~/.openwriter/profiles/<profile>/_pending/{docId}.json`
sidecars that travel alongside the canonical file but are read/written
through their own pathway.

## Current invariants

- **Disk = canonical only.** No `pending:` or `meta.pending` field in
  frontmatter. The body holds only accepted content. `tiptapToMarkdown`
  reverts pending nodes to their `originalBaseline` before serializing.
- **Sidecar = overlay.** `_pending/{docId}.json` holds one entry per
  pending node, keyed by nodeId (not position). Entry shape:
  - `nodeId` — the canonical ID the entry attaches to
  - `status` — `insert` | `rewrite`
  - `originalBaseline` — full TipTap node for revert (rewrites only)
  - `newContent` — full TipTap node for accept (the agent's proposed
    content)
  - `afterNodeId` / `parentNodeId` — anchor for inserts (positional
    intent without positional dependence)
- **In-memory = merged.** `state.document` carries pending attrs on the
  affected nodes (canonical merged with overlay). The browser sees the
  merged form; only the persistence boundary is split.
- **NodeId-keyed.** Entries survive structural edits because they
  attach by canonical nodeId, not by position. The matcher maintains
  nodeId continuity across content changes; the overlay attaches to
  whatever node ends up carrying the ID.
- **Sidecar lifecycle mirrors canonical lifecycle.** Every write path
  that emits a canonical .md must paired-write the overlay:
  - `writeToDisk` (active doc) — extracts overlay from `state.document`,
    writes sidecar in the same pass as the .md write
  - `flushDocToFile` (non-active doc — populate, write_to_pad,
    edit_text, applyChangesToFile, applyTextEditsToFile all funnel
    through this) — same contract
  - `saveDocToFile` (browser doc-update for non-active doc) — same
    contract
  - `stripPendingAttrsFromFile` (accept-all / clear path) — deletes
    sidecar (not just clears it; absence means "no overlay")
- **Legacy migration.** On load, if the file has a legacy `meta.pending`
  block, `migrateLegacyPending` converts it to the sidecar form and the
  next save emits canonical .md (no `pending:`) + sidecar. One-time
  migration; subsequent loads find the sidecar directly.
- **No sidecar means no overlay.** Absence of the JSON file is the
  canonical "no pending changes" signal. Empty entries array also
  works but absence is preferred (smaller filesystem footprint).
- **Sidecar shape carries two slots, not one.** Block-level pending
  (entries) and frontmatter-level pending (metadata) share the same
  per-doc JSON file but live under separate top-level keys (`entries:`
  and `metadata:`). Each is written through its own module
  (`pending-overlay.ts` and `pending-metadata.ts`) and preserves the
  other's slot via read-modify-write through `readSidecarRaw` /
  `writeSidecarRaw`. The sidecar is deleted when BOTH slots are empty.
- **Title renames are gated.** Agent-initiated `rename_item`
  (type=document) and `set_metadata` (when a title field is passed)
  stage the proposal in the sidecar's `metadata.title` slot —
  `{from, to, addedAtVersion}` — without modifying the .md file's
  frontmatter. Accept promotes the proposal through `updateDocumentTitle`
  (writes frontmatter, clears slot); reject discards without touching
  disk. Hot-write title paths preserved: HTTP `PUT
  /api/documents/:filename` (user typed in title bar), `populate_document`
  (creation), `promoteTempFile` (temp-file first-titling), browser
  `title-update` WS message (also auto-rejects any agent proposal — the
  user's direct edit supersedes).
- **Workspace + container renames stay hot.** They live in workspace
  manifest JSON, not per-doc sidecars; no natural fit. Out of scope for
  the document-title gating decision.

## Decision log (append-only)

### 2026-05-17 — initial split (foundation commit e2e0944)
- Moved pending state from `meta.pending` (frontmatter) to
  `_pending/{docId}.json` sidecars.
- Built `pending-overlay.ts` with `extractOverlay`, `applyOverlay`,
  `saveOverlay`, `loadOverlay`, `deleteOverlay`, `migrateLegacyPending`.
- Wired the active-doc save path (`writeToDisk`) to extract + persist.
- Added legacy migration on load.
- ADR file slot reserved (`adr/pending-overlay-model.md`) but the file
  was not created in that commit — referenced from 8 callsites without
  the linked document existing.

### 2026-05-17 — symmetric overlay save for non-active write paths
- Bug: `populate_document` / `write_to_pad` / `edit_text` /
  `applyChanges` on a non-active doc dropped pending content silently.
  The canonical write fired (`atomicWriteFileSync` on stripped body),
  but no overlay was persisted. Result: 25-word populate produced a
  0-word file with no sidecar. Reproduced during live testing of the
  versioning fixes.
- Root cause: the foundation commit established the
  "canonical-write + overlay-write" contract on the active-doc path
  (`writeToDisk`) but missed the parallel non-active write paths
  (`flushDocToFile`, `saveDocToFile`, `stripPendingAttrsFromFile`).
  All three serialize through `tiptapToMarkdown` / `tiptapToBody`
  which revert pending — and then wrote only the canonical without
  the overlay sidecar.
- Architectural fix: every write path that emits a canonical .md must
  paired-write the overlay in the same pass. `flushDocToFile` and
  `saveDocToFile` now call `saveOverlay(docId, extractOverlay(doc))`
  after `atomicWriteFileSync`. `stripPendingAttrsFromFile` calls
  `deleteOverlay(docId)` because the strip path's contract is "no
  pending anywhere" — absence of the sidecar is the canonical signal.
- Files changed:
  - `server/state.ts` — added `saveOverlay` / `deleteOverlay` calls to
    `flushDocToFile`, `saveDocToFile`, `stripPendingAttrsFromFile`.
    Added inline ADR pointers and explanatory comments at each site.
  - `scripts/test-nonactive-overlay-symmetry.mjs` — 26-assertion
    regression test covering all three paths plus the transitive
    `populateDocumentFile`, `applyChangesToFile`, `applyTextEditsToFile`
    that funnel through `flushDocToFile`.
  - `adr/pending-overlay-model.md` — created (this file). Foundation
    commit reserved the slot; this commit fills it in.
- Verification: full unit suite green (25 files, 575 assertions, +26
  from the new symmetry test). Live integration test on docId
  `82712ff4` (non-active): populate sent 33 words → disk body 64 bytes
  frontmatter-only → sidecar JSON had 3 insert entries with full content
  → switch_document re-attached all 3 pending paragraphs as expected.
- Out of scope (filed as follow-up): `delete_document` /
  `archive_document` / `rename_item` lifecycle paths also need
  sidecar-paired actions. Currently delete leaves an orphan sidecar.

### 2026-05-17 — lifecycle invariant: sidecar bound to docId existence
- Bug: `delete_document` left an orphan `_pending/{docId}.json` after
  moving the .md to OS trash. Observed live during the previous fix's
  verification (delete of docId 82712ff4 left its sidecar behind).
- Survey turned up four lifecycle paths that touch the .md file:
  delete, archive, unarchive, promoteTempFile. Reporter framing was
  "add deleteOverlay() to all four." Wrong framing — only delete
  actually retires the docId.
- Architectural framing: pending state is bound to the docId's
  *existence in the workspace*, not to the .md's filesystem path or
  the doc's active/archived flag. Sidecar lives as long as the docId
  does. The four paths split cleanly:
    - **delete** retires the docId → sidecar removed
    - **archive** hides but doesn't retire → sidecar persists (so
      unarchive can resume the review queue)
    - **unarchive** restores → sidecar already correct (no action)
    - **promoteTempFile** renames the .md, docId is stable, sidecar
      is docId-keyed → no action (and a test that locks this in)
- Files changed:
  - `server/documents.ts` — read docId from frontmatter before
    `trash()`, call `deleteOverlay(docIdToRetire)` after. Added
    `deleteOverlay` import.
  - `scripts/test-lifecycle-overlay.mjs` — 20-assertion test pinning
    the invariant for all four paths plus a no-op-clean defensive
    test (delete with no sidecar).
- Verification: full unit suite green (26 files, 595 assertions, +20
  from the new lifecycle test). Live test: created docId fc272d6f,
  populated with pending content (sidecar written with 2 insert
  entries), deleted → .md moved to trash AND `_pending/fc272d6f.json`
  removed. `_pending/` directory now sits empty.
- Rejected alternative: aggressive "call deleteOverlay() on every
  lifecycle path that touches the .md" — would silently destroy
  review state on archive/unarchive. The architectural test ("does
  this path retire the docId?") gates the action.

### 2026-05-17 — preview-swap echoes its own swap to the server (CORRUPTION)
- Bug: clicking "Show original" on a pending rewrite in the review
  panel emits a doc-update to the server with the original content
  in the node and pendingStatus=rewrite preserved. The server can't
  distinguish this from a real user edit. Result: state.document's
  node content gets overwritten with the originalBaseline content
  while pendingStatus stays. Next save extracts the overlay and
  writes a sidecar entry where newContent === originalBaseline — a
  degenerate "identity rewrite" with no actual change to review.
- Why it didn't always fire: the WS doc-update handler has a stale-
  version check (`browserVersion < serverVersion`) which blocked
  the corrupted echo most of the time, since the agent's rewrite
  bumped server's version before the browser had picked it up.
  After server restart, both versions reset to 0, and the corrupted
  echo lands.
- Root cause: in `ReviewPanel.tsx togglePreview`, the swap-to-
  original branch called `replaceNodeContent` (which fires a
  ProseMirror transaction → TipTap's onUpdate) BEFORE calling
  `setPreviewState(true)`. The onUpdate guard
  `if (isPreviewActive()) return` therefore saw `false` when the
  swap's transaction fired, and emitted a doc-update carrying the
  original content as if the user typed it.
- Architectural framing: preview swaps are visualization, not edits,
  and must never reach the server. The order-of-operations was the
  symptom; the architectural rule is "the preview-suppress flag
  must be active for every transaction the preview machinery
  dispatches."
- Fix (this commit): flip the order in both the single-node and
  group branches of `togglePreview` — set preview state FIRST, then
  swap. Roll back the preview state if the swap fails so the user
  can retry. The swap-back-to-modified path was already correct
  because preview state is already true at entry; the
  `restoreIfPreviewing` helper unsets it after the swap.
- Diagnostic logging shipped alongside (see `pending-overlay.ts`
  `diagLog`): every overlay save logs a before/after diff, every WS
  doc-update logs the pending-state shape it carries (with an
  `IDENTITY!` flag when newContent === originalBaseline), every
  document-switched broadcast logs the pending state being sent.
  Logs go to `~/.openwriter/profiles/<profile>/diagnostic.log` —
  our own file handle, so they survive MCP kill+restart.
- Files changed:
  - `src/review/ReviewPanel.tsx` — order flip in `togglePreview`
    for single-node and group cases, with roll-back on swap
    failure.
  - `server/pending-overlay.ts` — added `diagLog`, `nodeTextPreview`,
    `entrySummary`; instrumented `saveOverlay`, `applyOverlay`,
    `IDENTITY-REWRITE` warning.
  - `server/ws.ts` — instrumented doc-update handler (BEFORE/AFTER
    diff, IDENTITY flag), document-switched broadcast.
  - `server/state.ts` — instrumented `setAgentLock`.
- Verification: live test with browser MCP control. Pre-fix: clicking
  "Show original" produced `[WS] doc-update BLOCKED by stale version
  ... IDENTITY!` in diag log. Post-fix: clicking "Show original" and
  back to "Modified" produced ZERO doc-update echoes. Sidecar
  unchanged through both toggle directions.
- Open follow-up: defense-in-depth guard at `saveOverlay` that
  refuses to persist a rewrite entry where newContent ===
  originalBaseline. Today's fix prevents the corruption from being
  generated; the defense-in-depth would prevent any future variant
  from being persisted. Not shipping in this commit.

### 2026-05-18 — Idempotent apply + canonical cache + startup repair

- Incident: User's Beat Map doc rendered 4 copies of a single
  agent-inserted paragraph ("2.0 BRIDGE from the prior chapter..."),
  with the sidecar `_pending/c28f34d6.json` accumulating up to 14
  copies of the same nodeId entry. Subsequent delete operations on
  the duplicates had no effect (`appliedCount:1` but render
  unchanged). Cross-referenced inbox brief
  `2026-05-18-write-to-pad-duplicate-inserts-from-stacked-pending.md`.
- Root cause: `applyOverlay` mutated its input canonical doc and
  was not idempotent — the insert path called
  `parent.splice(loc.index + 1, 0, newNode)` without checking
  whether a node with that ID already existed at the splice
  location. Combined with `cacheActiveDocument` storing the
  merged-view doc (canonical + overlay applied) and
  `setActiveDocument`'s strip-and-reapply path on cache restore,
  every switch-away/switch-back to the doc doubled the count of
  insert-pending nodes. The duplicate nodes in the doc tree then
  produced duplicate entries on the next `extractOverlay` call,
  which were persisted verbatim by `saveOverlay`. The chain
  compounded over multiple switches; the brief's "delete had no
  effect" observation traced to the re-apply path immediately
  re-inserting whatever a delete had just resolved.
- Fix: three changes that enforce the architectural rule
  "applying the same overlay twice produces the same result as
  applying it once" by construction.
  1. **`applyOverlayPure`** in `server/pending-overlay.ts` —
     pure function returning a new merged tree. Insert path
     looks up `nodeById.get(entry.nodeId)` before splicing; if
     present, refreshes the pending marker on the existing node
     and skips the splice. Replaces the mutating `applyOverlay`
     at the cache-restore and load paths.
  2. **`splitMergedDoc`** in `server/pending-overlay.ts` —
     inverse of apply. Takes a merged doc and returns
     `{canonical, overlayEntries}`. Used at cache write time
     (`cacheActiveDocument`) so the cache stores canonical +
     overlay separately, never the merged view. Re-apply runs
     on clean canonical, never on its own output.
  3. **`saveOverlay` dedupes by nodeId** before writing. Map
     collapse keeps first occurrence (preserves the original
     anchor over the self-referential anchors that propagated
     through the compounding bug). Defense in depth: even if a
     future path produces duplicate entries, they can't reach
     disk.
- Healing: **`repairOverlaysOnStartup`** in
  `server/pending-overlay.ts` runs once during `load()` before
  any doc opens. Walks every `_pending/*.json`, dedupes by
  nodeId, rewrites. On the user's machine: 29 entries → 7 clean.
- Files changed:
  - `packages/openwriter/server/pending-overlay.ts` —
    `applyOverlayPure`, `splitMergedDoc`, `stripPendingFromDoc`,
    `repairOverlaysOnStartup`, dedup in `saveOverlay`.
  - `packages/openwriter/server/state.ts` — `getCanonical()`
    and `getOverlayEntries()` derive on demand via
    `splitMergedDoc`. `CachedDoc` now stores
    `canonical + overlayEntries` separately. `cacheActiveDocument`,
    `updateCacheEntry`, `reloadActiveDocFromDisk`, and
    `mergeOverlayOnLoad` all route through the new split + apply
    pure path. Startup hook calls `repairOverlaysOnStartup`.
- Architectural diagnosis: the original refactor moved canonical
  storage out of frontmatter into a separate sidecar, but the
  in-memory representation kept `state.document` as the
  merged-hybrid (canonical + overlay applied). The cache cloned
  that hybrid. The re-apply path used `stripPendingAttrsFromDoc`
  to "go back to canonical," but strip only removed pending
  marker attrs — not the inserted nodes themselves. The result
  was a doc that was neither canonical nor merged: original
  canonical plus orphan insert content that looked canonical.
  Re-applying overlay onto that hybrid added another copy.
  This commit closes the asymmetry on the read side
  (canonical/overlay derived via splitMergedDoc whenever the
  system needs canonical), and on the cache write side (stores
  the split, not the merged). The full split of `state.document`
  into separate in-memory `state.canonical` + `state.overlay`
  fields (the elegant end-state) is deferred to a future
  decision — this commit lands the bug fix structurally without
  changing the active-state representation.
- Verification: restart openwriter, switch to Beat Map, `read_pad`
  returns ONE BRIDGE node. Sidecar collapsed from 29 → 7
  entries. Commit `e9475ab`.
- Related inbox briefs (probably resolved by the same root):
  - `2026-05-17-restore-version-reject-pending-deletes-doc.md`
  - `2026-05-17-restore-version-safety-checkpoint-captures-wrong-state.md`
  - `2026-05-18-restore-version-resets-autoaccept-flag.md`
  These share the "code expected canonical view, got merged
  hybrid" shape. Should be re-tested before closing.

### 2026-05-18 — Canonical + overlay as primary state

- Trigger: continuation of the earlier "land the architecture the
  documentation already claims" plan. The previous commit made the
  read-side (cache writes, save path) consistent by deriving canonical
  on demand from `state.document` via `splitMergedDoc`. This commit
  flips the in-memory model so canonical and overlay become the actual
  primary state, with `state.document` derived from them.
- Change: `PadState` gains `canonical: PadDocument` and
  `overlay: Map<string, PendingEntry>` as primary fields.
  `state.document` is now a synced mirror updated by `recomputeMerged()`
  whenever primary state changes. All mutators route through sanctioned
  helpers (`setCanonical`, `setOverlayFromEntries`, `setPrimaryFromMerged`);
  direct assignment to `state.document` is forbidden.
  Existing readers via `getDocument()` continue to see the merged view
  unchanged, so the migration didn't require touching all 79 callsites.
  Save path now persists `state.overlay` directly (no extraction from
  the merged view).
- Regression caught and fixed mid-implementation: the `load()` function
  used `state.document = parsed.document` direct assignment, bypassing
  the new helpers. This left `state.canonical = DEFAULT_DOC` after
  startup, and the first save with empty `state.overlay` deleted the
  active doc's sidecar via `saveOverlay`'s "no entries → delete"
  branch. Cost: the user's 7 pending entries on the Beat Map doc were
  permanently lost (the disk markdown was intact; only the pending
  overlay layer was destroyed). Fix: route the initial load through
  `setPrimaryFromMerged` too. Moved `repairOverlaysOnStartup` to run
  BEFORE the file-walk so sidecars are deduped before any load reads
  them.
- Files: `packages/openwriter/server/state.ts` (the data model
  change + all the mutator updates).
- Verification: full test suite — 326 passed, 0 failed across
  state-integration, pending-integration, lifecycle-overlay,
  pending-classification, restore-version-pending,
  nonactive-overlay-symmetry, versions-integration, id-rewrite-*,
  save-time-matcher, matcher-preserves-ids, active-doc-watcher,
  comments-integration, sync-check.
- Commit: `fb666e6`.

### 2026-05-18 — Sync-merge replaces stale-version reject

- Trigger: the same-doc concurrent collaboration story discussed
  during the architectural analysis. The old behavior — server
  rejects browser doc-updates when browserVersion < serverVersion —
  preserved agent work but silently discarded the user's in-flight
  typing. The user kept editing, the server kept rejecting, the
  edits piled up in browser memory hoping a sync round would land.
- Change: `syncBrowserDocUpdate(browserDoc, browserVersion)` replaces
  the reject path. Browser's canonical view is authoritative for
  content. Server overlay entries with `addedAtVersion > browserVersion`
  are agent additions the browser hadn't seen yet — preserved
  unconditionally. Conflicts (both have an entry for the same nodeId)
  → server wins, on the principle that an explicit pending proposal
  outranks a browser save that didn't see it. The user can reject
  via the normal review UI if they disagree.
- New field on `PendingEntry`: optional `addedAtVersion: number`,
  stamped by `setOverlayFromEntries` on first sight of an entry,
  preserved across re-splits. Sidecars without the field (legacy)
  effectively count as "always recent" — preserved on merge rather
  than dropped, which is the direction we want errors to land.
- Files: `packages/openwriter/server/pending-overlay.ts` (new field),
  `packages/openwriter/server/state.ts` (`syncBrowserDocUpdate` +
  version stamping), `packages/openwriter/server/ws.ts` (calls sync
  merge instead of rejecting).
- New test: `scripts/test-sync-merge.mjs`. Two scenarios — disjoint
  touches preserve both sides; in-sync submissions apply directly.
  5 passed, 0 failed.
- Limitations: does NOT handle character-level merge inside a single
  paragraph. If two cursors are typing in the same sentence, the
  server-wins-on-conflict rule means one of them lands and the other
  is buried in version history. The architectural bet is that this
  case is rare in agent collaboration (agents tend to rewrite whole
  paragraphs; users tend to edit different paragraphs). If real usage
  shows the bet wrong, a per-paragraph CRDT layer can swap in without
  changing the surrounding system.
- Commit: `338fe8b`.

### 2026-05-18 — Autosave diff-gate + single server debounce timer

- Trigger: live integration test surfaced phantom saves firing on
  refactor-test-doc 47 seconds after the last user activity, with no
  content change. Root cause analysis: TipTap's `onUpdate` fires on
  every transaction that bumps `docChanged`, including server-pushed
  state (document-switched, document-reloaded, node-changes),
  reconnect rehydration, decoration plugin transactions, and React
  re-renders that pass new `initialContent`. Each of those triggered
  the 1s client autosave, which round-tripped back to the server as
  if it were a real edit — and in the worst case resurrected overlay
  entries the server had already resolved.
- Change 1 (client diff-gate): `App.tsx` keeps `lastSentDocJson`
  (string) representing what we last successfully synced with the
  server. The 1s autosave timer compares the current editor JSON to
  this and SKIPS the send when they match. `lastSentDocJson` is
  reset to authoritative state on `document-switched` and
  `document-reloaded`, and updated whenever a doc-update is actually
  sent (via the timer or `flushCurrentDoc`).
- Change 2 (server consolidation): two independent `debouncedSave`
  timers (one in `state.ts` at 500ms, one in `ws.ts` at 2s) collapsed
  into the single timer in `state.ts`. `ws.ts` now imports
  `debouncedSave` and `cancelDebouncedSave` from `state.ts`. The
  duplicate-timer arrangement made save timing unpredictable: a save
  armed by one path could be reset by the other and fire on a delay
  that matched neither documented value.
- Files: `packages/openwriter/src/App.tsx` (diff-gate refs + checks),
  `packages/openwriter/server/state.ts` (export `debouncedSave`),
  `packages/openwriter/server/ws.ts` (drop local timer, import shared).
- New test: `scripts/test-debounced-save.mjs` — verifies single fire
  on debouncedSave, coalescing under rapid calls, and
  cancelDebouncedSave aborts a pending save. 5 passed, 0 failed.
- Live verification: hard-refreshed browser on a doc with 3 pending
  entries, waited 8s. ZERO doc-update events emitted (rehydration
  no longer round-trips). Typed real edit → exactly one doc-update
  fired with the new content. Both behaviors confirmed.
- Limitations: diff-gate is structural equality on stringified JSON.
  Doesn't catch the case where the editor's TipTap state drifts from
  the server's view via a path that we DON'T receive a message for
  (e.g. local-only optimistic updates that never round-trip). Those
  would still leak through as "real edits." Not aware of such paths
  currently; if one is added, the diff-gate baseline needs an explicit
  update at that point too.
- Commit: `88db2c2`.

### 2026-05-18 — splitMergedDoc now restores canonical content for rewrites

- Trigger: after the diff-gate landed, dotted-underline `.pending-stale`
  indicators still showed on rewrite paragraphs in refactor-test-doc even
  though the sidecar's `originalBaseline` content matched the on-disk
  canonical body. Root-cause walk: `stripPendingFromDoc` (used by
  `splitMergedDoc`) stripped pending attrs from rewrite nodes but left
  the rewrite TEXT in `node.content`. Any path that round-tripped a
  merged doc back into canonical via splitMergedDoc (browser
  doc-update via syncBrowserDocUpdate, cache rebuilds, switchDocument
  flush) produced a canonical that contained rewrite text instead of
  original text. The next merge then ran sameContent(canonical=rewrite,
  baseline=original) → different → flagged stale-baseline.
- Asymmetry: the on-disk serializer's `revertPendingForSerialization`
  in `markdown-serialize.ts` already did the right thing (restore from
  pendingOriginalContent on rewrites, drop inserts, keep deletes).
  The split path silently diverged and produced corrupt in-memory
  canonical that the serializer would have cleaned up on the next
  disk write — but the merge logic ran first against the corrupt
  state, so the dotted-underline indicator appeared to the user even
  when nothing had actually drifted.
- Change: `stripPendingFromDoc` now mirrors the serializer's logic.
  For rewrites with a captured `pendingOriginalContent`, the node's
  content is restored from the baseline before pending attrs are
  stripped. Type and id remain from the current node — only
  `node.content` swaps.
- New test: `scripts/test-split-merged-roundtrip.mjs`. Verifies:
  rewrite split → canonical reverts to original text; round-trip
  idempotency (split→apply→split→apply produces the same merged with
  no stale flags); delete keeps the node + clears markers; insert is
  dropped from canonical but preserved in overlay; missing-baseline
  rewrites don't crash; mixed overlays round-trip cleanly. 27/27 pass.
- Live verification: server killed and restarted, browser navigated
  to refactor-test-doc (which had a sidecar with the pre-fix corrupt
  state). Live TipTap state inspection shows all three nodes with
  `pendingStaleBaseline: null`; visual confirms the amber dotted
  underline is gone. Before the fix, the same sidecar produced
  `pendingStaleBaseline: true` and the dotted indicator.
- Downstream: the existing `[Overlay] IDENTITY-REWRITE` warning in
  saveOverlay should now be unreachable rather than load-bearing — it
  was firing because of this same drift bug. Left in place as a
  tripwire if a future change reintroduces the issue.
- Commit: `d7f4b17` (architectural fix). Preceded by `50a3bf2` (diff-gate
  + single server timer), which closed the resurrection-via-rehydration
  path but couldn't fix the underlying split-path drift.

### 2026-05-18 — Bandaid downgrades after architectural close

- Trigger: audit of the decision log after the `stripPendingFromDoc`
  fix landed. Several pieces of defensive / healing code in
  `pending-overlay.ts` were load-bearing for drift-class bugs that
  are now architecturally closed. Leaving them framed as "active
  defense" is misleading — they should be framed as tripwires so a
  future regression is visible as a tripwire firing, not as silent
  cleanup.
- Reclassifications (code unchanged in behavior; comments + log
  labels updated to match new reality):

  1. **`saveOverlay` dedup-by-nodeId** (introduced 2026-05-18, idempotent
     apply). Was protecting against the non-idempotent applyOverlay
     producing duplicate entries. With `applyOverlayPure` and the
     split-path symmetry, no generator should produce dups anymore.
     Dedup stays (cheap, atomic, safe) but the log line is now
     `[Overlay] TRIPWIRE ... generator regressed, investigate`. If it
     ever drops anything, that's signal of a new generator path.
  2. **`saveOverlay` IDENTITY-REWRITE warning** (introduced 2026-05-17,
     preview-swap). Was firing regularly while the splitMergedDoc
     drift was producing identity rewrites under load. Both known
     generators (preview-swap echo, splitMergedDoc drift) are now
     closed. The log line is now `[Overlay] TRIPWIRE ... IDENTITY-
     REWRITE ... generator regressed, investigate`. If it fires
     post-fix, a third generator exists — find and close it at the
     source, do NOT add an auto-resolve bandaid downstream.
  3. **`repairOverlaysOnStartup`** (introduced 2026-05-18, idempotent
     apply). One-time healing pass for sidecars that were corrupted
     by the non-idempotent generator. Now backward-compat only — heals
     pre-fix corruption that may still exist on profiles updated from
     older builds. Log line is now `[Overlay] TRIPWIRE STARTUP-REPAIR
     ... should be unreachable post-fix, investigate`. Leave in place
     a few weeks then revisit removal.

- Items explicitly NOT shipping:

  1. **Defense-in-depth refuse-to-persist guard at saveOverlay**
     (proposed as "Open follow-up" in the 2026-05-17 preview-swap
     entry). Would refuse to write a rewrite entry where
     `newContent === originalBaseline`. With identity rewrites now
     unreachable through the known generators, this guard is at best
     redundant and at worst data-destructive — a legitimate rewrite
     can converge to identity later via canonical evolution and
     should be allowed to clear naturally at next save, not silently
     rejected at the persistence layer. Mark obsolete; do not ship.
  2. **Auto-resolve identity rewrites at apply time**, **server-side
     resolve-window guard against doc-update resurrection**, and
     **stale-baseline auto-recovery** — three follow-ups discussed
     in chat during the architectural-fix analysis. All addressed
     symptoms of the splitMergedDoc drift. With the drift closed at
     the source, none are needed. Mark obsolete; do not ship.

- Architectural framing: each downgrade follows the same pattern —
  defensive code that was load-bearing under a real bug becomes
  tripwire code once the bug is structurally closed. The behavior
  doesn't change; the FRAMING does. A future reader picking up the
  log line should immediately understand "this should never fire;
  if it does, treat it as a regression signal" instead of "this
  fires routinely as part of normal corruption cleanup."

- Files: `packages/openwriter/server/pending-overlay.ts` — comments
  + log labels updated on `saveOverlay` (dedup + identity warning)
  and `repairOverlaysOnStartup`. No behavior change. Commit: `8eb613f`.

### 2026-05-18 — Containers become first-class overlay entries

- **Trigger:** Inbox brief 2026-05-18-populate-document-on-empty-doc-marks-content-as-orphans.
  Populates of fresh docs containing nested content (lists, blockquotes,
  task lists) came back rendered with purple `pendingOrphan` decorations
  instead of green `pending-insert`. Three repro doc IDs (33181710,
  90a9d2ec, c97014d0) — all populated through the two-step
  create_document → populate_document flow with markdown bodies that
  included bullet lists, ordered lists, or blockquotes.

- **Architectural pattern that produced the bug:** The overlay model
  treated only leaf block types (paragraph, heading, codeBlock,
  horizontalRule, table, image) as first-class entries. Container types
  (bulletList, orderedList, listItem, taskList, taskItem, blockquote)
  were assumed to always pre-exist in canonical. For a fresh populate,
  this assumption fails: the containers exist briefly in the populated
  `doc` but never become overlay entries; on serialize the empty
  containers vanish because markdown has no representation for them; on
  reload the leaves' `parentNodeId` references point at containers that
  no longer exist anywhere. `applyOverlay`'s anchor-resolution loop
  falls through to the orphan branch and dumps the leaves at the end of
  the doc with `pendingOrphan: true`.

- **Architectural fix (not a workaround):** Containers are now
  first-class participants in the overlay. The populate-path marker
  (`markAllBlockNodesAsPending`, replacing the leaf-only walker for the
  populate entry point only) stamps `pendingStatus: 'insert'` on every
  block — leaves and containers — and generates IDs for any container
  that doesn't have one. `extractOverlay` picks up the container
  entries for free because it already records every node with
  `pendingStatus`. `applyOverlayPure` places container subtrees in
  pre-order so child entries' `parentNodeId` references resolve through
  entries placed earlier in the same batch.

- **Companion fix in `applyOverlayPure`:** The pre-existing
  `nodeById` cache only indexed the placed node itself, not its
  descendants. When a container's subtree lands in canonical, the
  descendants land too — but the subsequent child-entry idempotency
  check (`nodeById.get(entry.nodeId)`) didn't see them and would
  re-splice duplicate copies. Added `indexSubtree` that walks the
  placed node and registers every ID (including nested IDs) so
  subsequent entries hit the idempotent stamp-marker branch instead
  of the re-place branch. Without this, container coverage produces
  double-rendered lists.

- **Granularity preserved:** write_to_pad's existing pending-marker
  path (`markLeafBlocksAsPending`) is unchanged — only the populate
  entry point routes through the new walker. write_to_pad's first-node
  top-level mark and extras-leaf-mark behavior is intact, so callers
  that build content incrementally see the same per-entry granularity
  they always saw.

- **Existing on-disk purples are NOT auto-repaired.** The fix prevents
  new populates from going orphan; old sidecars with insert entries
  whose `parentNodeId` references vanished containers will continue
  to render as purple-at-end until the user accepts or rejects them.
  The information needed to reclassify (container IDs + tree shape
  preserved in `nodes:` frontmatter) is on disk, but the repair pass
  was deliberately out of scope for this commit — separate work if
  reclassification becomes a recurring ask.

- **Verification:**
  - 31-assertion regression test
    `packages/openwriter/scripts/test-populate-container-overlay.mjs`:
    populate with bulletList / blockquote / taskList → sidecar holds
    entries for both wrapper and inner leaves; applyOverlayPure on
    empty canonical reconstructs the nested tree with zero
    pendingOrphan flags and no duplicate IDs.
  - Live: populated a fresh doc with 6 block types (bulletList,
    orderedList, taskList, blockquote + plain paragraphs and
    headings); browser DOM shows 29 `.pending-insert` decorations
    and 0 `.pending-orphan`.
  - Existing test suites pass: pending-classification (37),
    split-merged-roundtrip (27), non-active-overlay-symmetry (26),
    lifecycle-overlay (20).

- **Files:** `packages/openwriter/server/state.ts` (new
  `CONTAINER_BLOCK_TYPES`, `markAllBlockNodesAsPending`),
  `packages/openwriter/server/pending-overlay.ts` (`indexSubtree`
  helper in `applyOverlayPure`),
  `packages/openwriter/scripts/test-populate-container-overlay.mjs`
  (new regression test). Commit: `f6247ae`.

### 2026-05-18 — Server-side save no-op gate (lastSavedDocVersion)

- **Trigger:** noticeable doc-switch lag with a periodic "every ~4th
  click" spike (300-700ms). Earlier session fixes — slim-array
  walker, doc-tags refresh decoupling, sidebar CSS transition
  removal — landed real perf wins but didn't address the spike.
  the user identified the root: zero-change switches still pay the
  full save pipeline.
- **Architectural pattern:** `writeToDisk()` assumed every call was
  a real save. The full pipeline ran on every invocation: clone
  document, read frontmatter from disk, run matcher, walk tree,
  write sidecar overlay, run sync-verifying serializer (~50ms
  baseline). Only at the very end did `existing === markdown` check
  skip the disk write. The 30-second `snapshotIfNeeded` interval
  ran downstream of the write, so every Nth switch crossed the
  threshold, triggering a second full-file read + hash + timestamped
  snapshot write — the 4th-click spike. The client-side diff-gate
  (commit `50a3bf2`) blocked phantom round-trips from the browser,
  but the server-side save() had no version gate of its own.
- **Architectural fix:** introduce `lastSavedDocVersion`,
  process-global, paired with the existing `docVersion` counter.
  `writeToDisk()` bails immediately when
  `existsSync(filePath) && docVersion === lastSavedDocVersion` —
  no serialize, no matcher, no sidecar write, no read-for-snapshot,
  no mtime bump (which would otherwise invalidate the doc cache).
  Updated at end of successful write, at the byte-equality skip,
  and on `resetDocVersion()` (which fires on doc switch — new doc
  was just loaded from disk so memory matches disk by definition).
- **Browser doc-update completion:** initial implementation broke
  real edits — browser `doc-update` flows through `updateDocument()`,
  which mutates state but did NOT bump `docVersion`. Only
  `applyChanges` (MCP write path) was bumping. The gate then saw
  "clean" state and silently swallowed the user's typing. Fixed by
  adding `bumpDocVersion()` at the end of `updateDocument()` after
  `setPrimaryFromMerged()`. The canonical contract is now: any path
  that mutates `state.document` MUST bump `docVersion`. Detected by
  live integration test — typed marker visible in editor, mtime
  unchanged, marker absent from disk grep.
- **Reload coordination:** `reloadActiveDocFromDisk` legitimately
  needs its internal `writeToDisk` to run (refreshes stale
  frontmatter against new body fingerprints). Moved
  `bumpDocVersion()` from `handleWatcherEvent` to inside
  `reloadActiveDocFromDisk` immediately before the internal
  `writeToDisk`. Single source for the reload-bump, gate sees dirty
  state and allows the refresh, and the bump still serves its
  stale-browser-rejection purpose via the WS handler's version
  check.
- **Verification:**
  - Unit: 7-assertion regression test
    `scripts/test-no-op-save.mjs` (first save writes, second save
    no-ops, content-mutating save advances mtime, many no-op saves
    leave mtime alone, reload triggers internal save, save after
    reload no-ops). All pass.
  - Live: killed and respawned openwriter, hard-refreshed browser.
    5 rapid sidebar clicks (Concept Dump → Source Material →
    Open Questions → Audience & Reader Journey → Thesis): zero
    mtime changes on any of the 5 files. Typed LIVETESTMARKER into
    active doc: mtime advanced + grep found marker. External Edit
    tool removed marker: fs.watch reload banner appeared + grep
    confirms marker gone. Real saves still work end-to-end.
  - No regressions: unit test counts identical to main pre-change
    (test-state-integration 39/12, test-pending-integration 22/5,
    test-backlinks-integration 20/3, test-id-rewrite-convergence
    6/4 — all pre-existing failures unchanged).
- **Files:** `packages/openwriter/server/state.ts`
  (`lastSavedDocVersion` global, gate at top of `writeToDisk`,
  recorded at write success + byte-equality skip,
  `resetDocVersion` resets both counters, `bumpDocVersion()` added
  to `updateDocument`, moved to inside `reloadActiveDocFromDisk`,
  removed from `handleWatcherEvent`),
  `packages/openwriter/scripts/test-no-op-save.mjs` (new). Commit:
  `26853c2`.

### 2026-05-25 — Title renames gated through pending overlay

- **Trigger:** Agent renamed a document mid-session via `rename_item`
  (type=document); the title swapped instantly in the browser with no
  accept/reject step. Body edits in the same session staged as pending
  with green decorations. Title — arguably the doc's primary identity,
  visible in workspace lists, shares, and newsletter sends — bypassed
  the entire agent-safety contract.
- **Change:** Extended the pending sidecar with a top-level `metadata:`
  slot alongside `entries:`. Agent-initiated rename_item and
  set_metadata (when a title field is passed) now stage the proposal
  there as `{from, to, addedAtVersion}` rather than writing through to
  frontmatter. The user reviews via an inline diff in the title bar
  (strikethrough[from] → green[to] with ✓/✗ buttons) and accepts or
  rejects with the same visual + interaction language as body edits.
  Accept promotes through `updateDocumentTitle`; reject discards without
  touching disk. Hot-write paths preserved for user-typed titles
  (HTTP PUT, browser title-update), creation-time titling
  (populate_document), and temp-file promotion. User-typed renames in
  the title bar additionally auto-reject any pending agent proposal —
  direct edits supersede.
- **Why:** Body and metadata mutations were architecturally split for
  the agent-safety contract: agents propose, user disposes. Letting
  titles land hot was an unprincipled carve-out — and arguably the
  highest-visibility one to gate. The sidecar already lived per-docId
  and was already keyed to survive renames, making the extension a
  shape-fit rather than a refactor.
- **Why a sibling module, not a new entry shape:** The block overlay's
  PendingEntry is keyed by nodeId and assumes a TipTap tree. Title is
  a YAML frontmatter field — not in the tree. Forcing it into a fake
  "node" would have corrupted the overlay invariants (extractOverlay
  tree-walk, applyOverlayPure idempotency, splitMergedDoc). A parallel
  `pending-metadata.ts` module sharing the sidecar file but owning a
  separate slot keeps both invariants clean.
- **Out of scope:** Workspace + container renames stay hot (different
  storage — workspace manifests, not per-doc sidecars). Non-title
  metadata writes (tags, status, mark_enriched) also stay hot for this
  pass — title was the load-bearing visibility case the brief flagged;
  the other fields can be gated incrementally without further sidecar
  changes if a similar incident surfaces.
- **Files:** `packages/openwriter/server/pending-metadata.ts` (new —
  PendingMetadata type, sidecar I/O preserving entries slot),
  `packages/openwriter/server/pending-overlay.ts` (`readSidecarRaw` /
  `writeSidecarRaw` primitives; `saveOverlay` preserves metadata slot
  across entries-only writes; sidecar deleted only when both slots
  empty), `packages/openwriter/server/state.ts`
  (`state.pendingMetadata` field + getter/setter; rehydrated in
  `setActiveDocument` from sidecar `metadata:` slot),
  `packages/openwriter/server/documents.ts` (`stagePendingTitle`,
  `acceptPendingTitle`, `rejectPendingTitle`, `getPendingTitle`;
  read canonical title for non-active docs via gray-matter without
  touching state), `packages/openwriter/server/mcp.ts` (rename_item
  type=document forks through `stagePendingTitle`; set_metadata
  forks the title key through stage unless target is active+temp;
  result text reports the proposed pair instead of "Renamed"),
  `packages/openwriter/server/ws.ts`
  (`broadcastPendingMetadataChanged`; `accept-pending-title` and
  `reject-pending-title` handlers; `title-update` auto-rejects any
  pending proposal first; `broadcastDocumentSwitched` payload carries
  the active doc's `pendingMetadata` so the diff renders on connect /
  switch without a separate round-trip),
  `packages/openwriter/src/ws/client.ts`
  (`DocumentSwitchedPayload.pendingMetadata`; dispatches
  `ow-pending-metadata-changed` DOM events from
  `pending-metadata-changed` and from `document-switched`),
  `packages/openwriter/src/titlebar/Titlebar.tsx` (new `docId` +
  `sendMessage` props; subscribes to `ow-pending-metadata-changed`,
  filters by docId, renders strikethrough/arrow/green diff with
  ✓/✗ buttons; clears local state on docId change for safety),
  `packages/openwriter/src/App.tsx` (passes `metadata.docId` and
  `sendMessage` to Titlebar),
  `packages/openwriter/src/decorations/styles.css`
  (`.titlebar-title-pending` + `__old` / `__arrow` / `__new` /
  `__btn` variants; reuses existing `--color-pending-insert*` tokens
  for visual continuity with body green decorations). Commit:
  `d55d2df`.

### 2026-05-25 — applyChanges version bump precedes apply (silent-drop of MCP writes)
- **Incident:** Parent agent issued `write_to_pad` with 4 delete operations
  against heading nodes on docId `3889323e` (article "The Throne is Paid
  in Blood"). Server returned `appliedCount:4`; subsequent `read_pad`
  showed all four H2 nodes intact with no pending decoration. The user
  saw no strike-through in the browser. Re-issuing the same operations
  ~5 min later staged correctly. Non-deterministic by symptom; fully
  deterministic by mechanism.
- **Diagnosis:** `applyChanges()` ordered `applyChangesToDocument()`
  BEFORE `bumpDocVersion()`. `applyChangesToDocument` calls
  `setPrimaryFromMerged` → `setOverlayFromEntries`, which stamps new
  entries' `addedAtVersion` with the **pre-bump** `getDocVersion()` (V).
  The version then bumps to V+1 and the broadcast goes out at V+1.
  When a stale browser doc-update arrives with `browserVersion = V`
  (captured just before the broadcast hit), the WS handler routes it
  through `syncBrowserDocUpdate`. Its preserve filter is
  `addedAtVersion > browserVersion`. For the just-added entries
  `V > V` is FALSE → `preservedServerEntries = 0` → server overlay
  wiped → debounced save persists `[]` → sidecar deleted. The
  `appliedCount` response was accurate at response-time; the silent
  drop happened ~34 s later when the race fired.
- **Log evidence** (events.log on profile `Default`, 2026-05-26 UTC):
  ```
  01:31:19.271  [Overlay] SAVE docId=3889323e entries=4
                changes=[+bee457b0/delete | +ea772528/delete |
                +a6d29383/delete | +f9a55baa/delete]
  01:31:44.573  [WS] doc-update SYNC-MERGED stale v60→v62
                preservedServerEntries=0
  01:31:45.573  [WS] doc-update SYNC-MERGED stale v60→v62
                preservedServerEntries=0
  01:31:53.966  [Overlay] SAVE docId=3889323e → DELETE (was 4 entries)
                (no requestId — debouncedSave, not user-resolve)
  ```
  The DELETE-without-requestId is the architectural tell: every
  user-driven resolve carries `requestId=ws-pending-resolved-*`; a
  bare DELETE is debouncedSave overwriting a wiped overlay.
- **Fix:** Reorder `applyChanges()` so `bumpDocVersion()` (and
  `setAgentLockActive()`) runs BEFORE `applyChangesToDocument(changes)`.
  Now `setOverlayFromEntries` sees the post-bump version when stamping
  new entries' `addedAtVersion`. A stale browser doc-update at
  `browserVersion = preBump` satisfies `addedAtVersion (preBump+1) >
  browserVersion (preBump)` as TRUE → entries preserved → no silent
  drop.
- **Why this is the architectural fix, not a workaround:** The
  invariant `addedAtVersion = the version at which this entry first
  becomes visible to clients` is what `syncBrowserDocUpdate` depends
  on. Stamping with the pre-bump version violates the invariant —
  the entry isn't visible to clients until the post-bump broadcast.
  Reordering aligns the stamp with what the field is documented to
  mean. The alternative (relaxing the filter to `>=`) would paper
  over the off-by-one without fixing the invariant violation.
- **Out of scope (deferred):**
  - `updateDocument()` (browser-doc-update path) has the same
    bump-after-apply pattern but is lower-risk: the browser is the
    source of any new entries there, so a same-browser stale race is
    structurally rare. Leave for a follow-up if it bites.
  - `appliedCount` success-response semantics. The count is accurate
    at response-time; the silent-drop window opens only after the
    response. A server-side read-back assertion in `write_to_pad`
    (e.g. confirm `loadOverlay(docId).length` includes the new
    nodeIds after the debounce window) would harden the contract.
    Not done here — the race is closed; the contract question is a
    separate decision.
- **Verification:**
  - Build: vite + `tsc -p tsconfig.server.json` clean.
  - Live test deferred: the chip cannot re-link the global `openwriter`
    npm bin without killing the parent's running openwriter processes
    (see CLAUDE.md "Server Restart"). Reproduction protocol for the
    parent or a subsequent test run is in
    `~/.claude/skills/openwriter-testing/SKILL.md` — multi-delete on
    heading nodes against a doc with concurrent browser typing should
    now stage strike-throughs deterministically.
- **Files:** `packages/openwriter/server/state.ts:1217-1234`
  (reordered `applyChanges`). Commit: `d133912`.

### 2026-05-27 — read-side asymmetry: non-active doc loads ignored the sidecar

- **Incident.** Repro: `create_document(content_type:"document")` (which
  creates a stub on disk without switching the active view) →
  `populate_document(docId, content:"## A\n\npara\n## B\n\npara")` →
  server returns `Populated "X" — 18 words` → immediate
  `read_pad(docId, force:true)` returns `words: 0, pending: 0, [p:stub]`.
  Disk and sidecar inspected directly: the .md body had only the stub
  paragraph (correct — populate writes canonical-only); the sidecar at
  `_pending/{docId}.json` contained all 6 pending-insert entries with
  correct anchors (correct — populate writes overlay-to-sidecar). The
  data was on disk; the read couldn't see it.
- **Diagnosis (architectural, not a guard).** fb666e6 (May 17 refactor —
  "canonical + overlay as primary, document as derived") split persistence
  into two surfaces: the .md body holds canonical, the per-docId sidecar
  holds overlay. Every WRITE path (`writeToDisk`, `flushDocToFile`,
  `saveDocToFile`) was updated to write both halves atomically. The READ
  side was NOT updated symmetrically. `markdownToTiptap` continued to
  return canonical-only and the only callers that loaded the sidecar
  did so explicitly via the active-doc paths (`mergeOverlayOnLoad`,
  `setActiveDocument`). Every non-active read path —
  `resolveDocTarget`'s disk-fallback (mcp.ts), `populateDocumentFile`'s
  read-the-stub step, `applyChangesToFile`'s cache-miss,
  `applyTextEditsToFile`'s cache-miss — called `markdownToTiptap`
  directly and silently dropped the sidecar overlay.
- **Why this is the architectural fix.** The invariant fb666e6 introduced
  is: "the on-disk doc is the pair `(canonical .md, sidecar overlay)`."
  The function named "load the doc" must respect that pair. Adding
  guards or "use the right call site" patches keeps the broken default
  available; future callers reach for `markdownToTiptap`, get
  canonical-only, and re-introduce the bug class for their own surface.
  The fix renames the contract by addition: `loadDocFromDisk(filename)`
  in pending-overlay.ts is the read entry point for the full doc;
  `markdownToTiptap` is documented as canonical-only for persistence
  internals (matcher, sync-check, on-disk identity). User-facing
  readers route through the new function.
- **Why write_to_pad survived the bug accidentally.**
  `applyChangesToFile` calls `updateCacheEntry(targetPath, doc, ...)`
  after `flushDocToFile`. `updateCacheEntry` runs `splitMergedDoc` +
  `applyOverlayPure` and stores the merged view in the in-memory doc
  cache. The next `read_pad` hits the cache (mtime-validated) and gets
  the merged view back. `populateDocumentFile` skipped the cache
  update — so its writes were invisible to the very next read on cache
  miss. Both paths are now correct: read-from-disk-or-cache returns
  merged either way. The cache update remains a perf optimization but
  is no longer load-bearing for correctness.
- **Out of scope (intentional).** `markdownToTiptap` was not renamed.
  Renaming would touch ~80 call sites across production code and
  scripts (matcher tests, fingerprint tests, lifecycle tests, etc.),
  most of which legitimately want canonical-only. The function's
  JSDoc now declares the contract explicitly. A wider audit of
  whether any other production caller wants merged-view (candidates:
  search_docs, browse_docs, peek_doc body extraction, list_documents
  word counts) is a follow-up — they all currently call
  `resolveDocTarget` which is now correct, so the visible bug is
  closed. Direct callers of `markdownToTiptap` in production are
  limited to: persistence internals (state.ts active-doc load,
  reload, save-time matcher, version snapshot, restore_version,
  cleanupEmptyTempFiles, getDocTagsByFilename via the
  matter-only path, saveDocToFile's transfer-pending-from-disk),
  documents.ts's switchDocument cache-miss (which then routes
  through `setActiveDocument` → `mergeOverlayOnLoad`, so it correctly
  loads the sidecar one step later), and a handful of backlinks /
  workspace metadata reads where the canonical body IS what's
  semantically wanted. None of these surfaces are user-facing
  doc-read surfaces.
- **Verification.** Live reproduction against the running openwriter
  MCP: pre-fix, `create_document` + `populate_document(18 words)` +
  `read_pad` reported `words: 0, pending: 0`. Post-fix, same sequence
  reports `words: 18, pending: 6` with the six inserted nodes
  visible in compact format. Disk body unchanged (still canonical-only);
  sidecar unchanged (still has the entries); the only delta is that
  the read path now combines them.
- **Files:** `packages/openwriter/server/pending-overlay.ts` (added
  `loadDocFromDisk`), `packages/openwriter/server/mcp.ts:163-181`
  (`resolveDocTarget` disk-fallback), `packages/openwriter/server/state.ts`
  (`populateDocumentFile`, `applyChangesToFile` cache-miss,
  `applyTextEditsToFile` cache-miss), `packages/openwriter/server/markdown-parse.ts`
  (JSDoc on `markdownToTiptap` documenting the canonical-only contract).
  Commit: TBD.

- **2026-05-28 — False `pendingStaleBaseline` from a browser doc-update.**
  `syncBrowserDocUpdate` rebuilt `state.canonical` via
  `splitMergedDoc` → `stripPendingFromDoc`, which reverts a rewrite ONLY from
  the node's own `pendingOriginalContent` attr. When a browser doc-update's
  rewrite node had dropped that attr, the revert silently failed and the
  rewrite TEXT stayed in canonical. The next `applyOverlayPure` then compared
  canonical-as-rewrite to the (still-correct) server-preserved overlay
  baseline, saw a difference, and falsely set `pendingStaleBaseline` — the
  amber dotted-underline indicator — even though nothing had actually drifted.
  Cleared by `reload_from_disk` (re-reads clean disk canonical), which is how
  it was diagnosed live on the QT "Immigrant parents" doc. Clean-room
  server-only delete+rewrite (incl. the tweet hard-delete path) does NOT
  reproduce it; the browser round-trip is required. Fix:
  `reconcileCanonicalToBaselines(canonical, mergedEntries)` re-asserts each
  rewrite's authoritative `originalBaseline` into canonical inside
  `syncBrowserDocUpdate` — but ONLY when the canonical node currently equals
  the entry's `newContent` (the revert-failed signature). A canonical node
  holding anything else (a genuine out-of-band edit) is left untouched, so
  real stale-baseline drift is still surfaced. Reproduced + regression-guarded
  in `scripts/test-stale-baseline-repro.mjs` (6 assertions, incl. the
  genuine-drift-preserved case 5b). Files:
  `packages/openwriter/server/pending-overlay.ts`
  (`reconcileCanonicalToBaselines`),
  `packages/openwriter/server/state.ts` (`syncBrowserDocUpdate`). Commit: TBD.

- **2026-05-31 — Editable article/blog title became an auto-growing textarea
  (peripheral to this ADR; logged because the file carries the marker).** The
  `.article-title-input` (and sibling `.blog-title-input`) editable field was a
  single-line `<input>`, so long titles overflowed horizontally and clipped —
  the full title was never visible and never wrapped. Swapped both to
  auto-growing `<textarea>`s via a shared `src/hooks/useAutoGrowTitle.ts`
  (word-wraps, auto-grows height to fit, Enter blurs instead of inserting a
  newline, typed/pasted newlines collapse to a space so the saved title stays
  single-line). **No pending-overlay invariant touched:** the pending
  title-rename branches still render `<div className="...article-title-input
  article-title-input--pending...">` (NOT inputs), and the new CSS is scoped to
  `textarea.article-title-input` / `textarea.blog-title-input` so the pending
  `<div>` styling is unaffected. The "Title renames are gated" + hot-write
  paths (the `onTitleChange` callback → browser `title-update`) are preserved
  verbatim — only the element type and newline handling changed. **Watch-out
  for future maintainers:** the editable field and the pending-rename field
  share the `.article-title-input` class but are now DIFFERENT element types
  (textarea vs div) with different wrapping mechanisms; they look
  interchangeable in the CSS but aren't. Verified live on the worktree build
  (port 5051) against repro doc `5839a494` ("How to Monetize a Discord Server:
  Sell the Community, Not Access" — has both article + blog context, isArticle
  wins → renders `.article-title-input`): title renders as TEXTAREA, wraps to 2
  lines fully visible, `scrollWidth === clientWidth` (no horizontal clip),
  Enter commits without inserting a newline. Files:
  `packages/openwriter/src/hooks/useAutoGrowTitle.ts` (new),
  `packages/openwriter/src/article-compose/ArticleComposeView.{tsx,css}`,
  `packages/openwriter/src/blog-compose/BlogComposeView.{tsx,css}`,
  `packages/openwriter/src/article-compose/useArticleCopy.ts` (cast
  `HTMLInputElement` → `HTMLTextAreaElement`). Commit: TBD.

### 2026-06-01 — No-op gate front-runs save-pipeline logic; tests must mutate via `updateDocument`, not `setActiveDocument`

- **Trigger.** Three core-server unit tests were red on clean `main`
  (`8284f2c`): `test-external-write-guard.mjs`,
  `test-id-rewrite-convergence.mjs` (6/4),
  `test-restore-version-pending.mjs` (39/1). The brief framed them as three
  independent regressions in three subsystems.
- **Correction to the framing.** They are ONE root cause. All three were
  authored on 2026-05-17 (`c1011d9`, `0a8d662`, `bce8fd0`) and passed when
  written. The no-op gate (`26853c2`, 2026-05-18 — the entry above) was added
  the next day. Each test simulates an agent/browser edit by calling
  `setActiveDocument(...)` (the doc **load** path, which intentionally does NOT
  bump `docVersion`) and then `save()`. With no pending mutation,
  `docVersion === lastSavedDocVersion`, so `writeToDisk` bails at the no-op
  gate **before** the logic each test exercises ever runs — the external-write
  guard, the save-time matcher's id-rewrite broadcast, and
  `stripLegacyAgentCreated` all live downstream of the gate.
- **Correction to this ADR's own record.** The `26853c2` entry above claims
  *"test-id-rewrite-convergence 6/4 — all pre-existing failures unchanged."*
  That attribution is wrong: the gate itself caused those 4 failures. The
  author ran the test after applying the gate, saw 6/4, and assumed it was
  pre-existing without diffing against the immediately-prior state. Recorded
  here, not edited above (append-only log).
- **Why production is unaffected.** The canonical contract this ADR already
  states holds: *any path that mutates `state.document` MUST bump
  `docVersion`.* Every real edit path — `updateDocument` (browser doc-update),
  `syncBrowserDocUpdate`, `applyChangesToDocument` (MCP writes) — bumps it, so
  the gate passes and the downstream logic runs on every real save. Only a
  load-then-save-with-no-edit (a test artifact) is short-circuited, and that is
  correct: a zero-change save has nothing to write and therefore cannot clobber
  external content, mis-broadcast IDs, or persist a stale flag.
- **Invariant for future tests.** A unit test that means to exercise anything
  inside `writeToDisk` (guard, matcher, strip, sidecar, snapshot) must produce
  its document state through a `docVersion`-bumping path — `updateDocument`,
  `syncBrowserDocUpdate`, or `applyChangesToDocument` — NOT through
  `setActiveDocument`, which is load-only. Using the load path to fake an edit
  will silently no-op the save and the test will assert against unwritten disk.
- **Fix.** Stale-test corrections only; zero production-code change. Each test
  now routes its simulated edit through `updateDocument`. Assertions unchanged.
  `test-external-write-guard` 18/0, `test-id-rewrite-convergence` 10/0,
  `test-restore-version-pending` 40/0. See also `adr/external-write-guard.md`
  (created in the same change). Commit: TBD.

### 2026-06-09 — Pending-title decoration only rendered for article docs (phantom rename on blog/other views)

- **Incident.** Parent agent called `rename_item({type:"document",
  docId:"a013accf", newName:"..."})` on a live blog-type doc. The MCP returned
  the standard *"Staged title rename ... User will accept or reject in the
  editor"* message, but NO decoration rendered in the editor — the title looked
  untouched, and the proposed title was nowhere visible. Body edits
  (`write_to_pad`) in the same doc staged with the usual green decorations the
  user could accept/reject. The title — gated through this same overlay since
  2026-05-25 — staged a real pending record the server broadcast correctly, yet
  the editor showed nothing. The MCP's promise was a phantom for that doc type.
- **Reproduction (live, worktree build on port 5051, isolated from the parent's
  5050 + the live blog doc).** Fresh throwaway blog doc → `write_to_pad`
  body edit shows green pending decorations + Review `CHANGE 1/2` (baseline
  works). Then `rename_item`: the right-rail Review panel DID flip to a
  `TITLE 1/1` slot with Accept/Reject, but the editor title stayed the OLD text
  with no decoration. DOM confirmed: `document.querySelector('.blog-title-input')`
  was a plain `<textarea>` holding the old title;
  `hasPendingTitleDecoration === false` — the pending `<div>` never existed.
- **Root cause (architectural, not the trigger).** The 2026-05-25 entry gated
  titles through the overlay and rendered the inline diff in `Titlebar.tsx`. A
  later refactor (the 2026-05-23 right-rail work + the 2026-05-31 title-textarea
  change) moved the title-rename decoration OUT of the chrome and INTO the
  compose view's own editable-title element — but wired it into
  `ArticleComposeView` ONLY. `App` lifts the broadcast `pendingMetadata.title`
  into `pendingTitle` and hands it to `ArticleComposeView` and the `RightRail`,
  but NOT to `BlogComposeView` / `TextNewsletterView` / the plain `PadEditor`
  fallback. So every non-article title-bearing view rendered its plain title
  field regardless of a staged rename. The decoration + the
  `ow-pending-review-cursor` focused-slot gutter + Modified/Original preview
  lived as inline JSX inside one view; the moment a second title-bearing view
  existed (blog), the feature silently didn't apply to it. The class of bug is
  "a cross-view feature implemented inside a single view" — it can only ever
  cover the one view it was written in.
- **Fix (option a — make the rename produce a real decoration, consistent with
  body edits; chosen over truth-in-messaging because there is no architectural
  reason a non-article title can't decorate).** Extracted the pending-title
  render + the `ow-pending-review-cursor` listener into a shared, content-type-
  agnostic `src/components/PendingTitleField.tsx`. It takes `pendingTitle`,
  `docId`, and a `baseClass`; renders the proposed title with the same global
  `.pending-insert` / `.pending-original` tint + `${baseClass}--pending` box,
  applies the `.pending-active` gutter when the Review cursor focuses title, and
  swaps to the canonical `from` under the Modified/Original toggle. When no
  rename is pending it renders its `children` (the view's editable field)
  verbatim. `ArticleComposeView` now uses it (its duplicated state/effect/JSX
  deleted — single source of truth), and `BlogComposeView` adopts it (new
  `pendingTitle` + `docId` props, wired from `App`, plus a
  `.blog-title-input--pending` CSS rule mirroring the article one).
- **Why this is the architectural fix.** The decoration now belongs to a shared
  component every title-bearing view drops in place of its title field, so
  article and blog can't drift and any future titled view gets the decoration
  by using the same wrapper. The two views previously shared the
  `.{x}-title-input` class but diverged in whether they consumed `pendingTitle`
  at all — the shared component removes that divergence at the source.
- **Out of scope (intentional, documented so the gap is visible, not silent).**
  - **Newsletter (`TextNewsletterView`)** renders an email *subject* field that
    auto-syncs to the doc title, not a direct title element; decorating it
    cleanly requires reconciling the subject↔title sync and is a separate
    change. A staged rename on a newsletter doc still surfaces in the Review
    panel's TITLE slot (accept/reject works) but won't decorate the subject box.
  - **Plain `document`-type docs** have no editable title element in the editor
    body at all (title lives only in the lean Titlebar + sidebar). Their
    accept/reject surface remains the Review-panel TITLE slot. Re-introducing a
    Titlebar diff would partially revert the 2026-05-23/05-31 decision to keep
    the Titlebar lean; not done here.
  In both cases the Review-panel TITLE slot is the universal accept/reject
  surface, so the agent-safety contract holds for every doc type; only the
  inline editor-title decoration is article+blog for now.
- **Verification (live, cross-actor — server stage → WS broadcast → client
  render).** Worktree build on 5051. (1) Initial-load rehydration: the 5051
  server picked up the sidecar-persisted pending title and the blog title
  rendered the green `.blog-title-input--pending` `<div>` with the proposed
  text (computed color `rgb(34,197,94)`), editable textarea absent. (2) Review
  panel: `TITLE 1/1` + green focused-slot gutter bar now appear for the blog
  doc; Modified/Original toggle swaps the title between proposed-green and
  canonical-in-delete-tint. (3) Reject clears it → title reverts to the editable
  textarea + panel shows "All caught up". (4) Live broadcast path: a fresh
  `rename_item` via the 5051 server's `/api/mcp-call` immediately rendered the
  green decoration + gutter + Review slot with no reload. Pre-fix the same
  blog doc showed zero decoration; post-fix all four behaviors match
  `ArticleComposeView`.
- **Files:** `packages/openwriter/src/components/PendingTitleField.tsx` (new
  shared component), `packages/openwriter/src/article-compose/ArticleComposeView.tsx`
  (use shared component; remove duplicated state/effect/JSX),
  `packages/openwriter/src/blog-compose/BlogComposeView.tsx` (new `pendingTitle`
  + `docId` props; wrap title field),
  `packages/openwriter/src/blog-compose/BlogComposeView.css`
  (`.blog-title-input--pending`),
  `packages/openwriter/src/App.tsx` (pass `pendingTitle` + `docId` to
  `BlogComposeView`). No server-side change — the stage + broadcast path was
  already correct; the bug was purely client-side render coverage. Commit: TBD.

## 2026-06-10 — Startup pending scan read legacy frontmatter, not sidecars

- **Symptom.** Every server restart looked like a profile-wide accept-all:
  sidebar pending dots and the Review panel's pending-docs list came back
  empty, decorations gone across all docs — while every `_pending/{docId}.json`
  sidecar survived intact on disk and `get_pad_status` still reported the
  correct counts.
- **Root cause.** `populatePendingCache()` (state.ts), the once-on-startup
  disk scan that seeds `pendingDocCache`, still parsed the **legacy
  in-frontmatter `pending:` block** — which the sidecar migration emptied.
  The cache only repopulated per-doc on load, so until each doc was opened
  individually, the profile-wide pending view read as resolved.
- **Fix.** The scan now resolves each doc's `docId` from frontmatter and
  counts `loadOverlay(docId)` sidecar entries + a staged title rename via
  `loadPendingMetadata(docId)`, falling back to legacy `pending:` only when
  the sidecar is empty (`pendingCountForDoc()`). Applies to both data-dir
  and external docs.
- **Invariant.** Any new persistence layer for pending state must also be
  read by the startup scan — sidecar writes alone don't make pending survive
  a restart from the user's point of view; the index has to rehydrate too.

### 2026-09-07 — sidebar intent accompanies document switches

The document-switched envelope now carries navigation intent separately from its document and pending metadata. Browser deletion fallbacks preserve sidebar location; ordinary opens retain reveal behavior. The existing document, version, and pending-metadata fields remain intact. See [sidebar navigation intent](sidebar-navigation-intent.md).
