# External-write guard — block clobbering an externally-modified file

## Context

A document can be modified on disk by something other than openwriter
between the moment openwriter loads it and the moment openwriter next
writes it: the `Edit` tool, an editor (VSCode), a sync client, a script.
openwriter holds an in-memory copy of the document; if its next auto-save
blindly serializes that copy back to disk, it silently overwrites whatever
the external writer put there. The user never authored the loss and gets no
signal it happened.

Live evidence: inbox brief
`2026-05-17-open-file-autosave-clobbers-external-writes.md`. A doc opened via
`open_file` was edited externally; openwriter's next debounced save wrote its
stale in-memory body over the external content.

There are two independent mechanisms in play, and they must not be confused:

- **The active-doc watcher** (`adr/active-doc-watcher.md`) is the PRIMARY
  defense. `fs.watch` fires the instant the file changes on disk; openwriter
  reloads, re-attaches the pending overlay, bumps `docVersion`, and broadcasts
  a document-reloaded message. In normal operation the watcher reconciles the
  external write before any save can race it.
- **The external-write guard** (this ADR) is the BACKSTOP inside
  `writeToDisk`, for the cases the watcher cannot cover: `fs.watch` is
  unreliable on some filesystems (network mounts, ephemeral CI, certain
  Windows configs), and the guard then prevents the clobber on the next save.

## Current invariants

- **`state.loadedMtime` is openwriter's record of "the disk mtime as of our
  last load or successful own write."** Stamped in `setActiveDocument` at load
  (`0` when no file exists yet — a brand-new doc), and re-stamped to the
  post-write disk mtime after every successful `writeToDisk`. Exact-ms
  equality is the contract; filesystems guarantee monotonic per-file mtime on
  one host, so any difference at all means an external writer touched the file.
- **The guard lives in `writeToDisk`, gated on `state.loadedMtime > 0`.**
  Before writing, it stats the live disk mtime; if `diskMtime !==
  state.loadedMtime` it logs `[State] BLOCKED save`, fires
  `notifyExternalWriteConflict(filePath, diskMtime, loadedMtime)`, and returns
  WITHOUT writing. First save of a new doc (`loadedMtime === 0`) never trips
  the guard.
- **The guard runs DOWNSTREAM of the no-op gate.** `writeToDisk` bails at
  `docVersion === lastSavedDocVersion` (`adr/pending-overlay-model.md`) before
  the guard. This is correct, not a hole: a zero-change save writes nothing and
  therefore cannot clobber. The guard only needs to fire on a REAL save — one
  preceded by an in-memory mutation that bumped `docVersion` — which is
  precisely the save that would otherwise overwrite the external content. Every
  production mutation path (`updateDocument`, `syncBrowserDocUpdate`,
  `applyChangesToDocument`) bumps `docVersion`, so the guard is reachable on
  every real save with external drift.
- **`onExternalWriteConflict` is consumed in `ws.ts`.** The subscriber
  broadcasts an `external-write-conflict` message
  (`{filePath, filename, diskMtime, loadedMtime}`) to every connected client so
  the user is told to reload rather than losing work. The emitter is live; if
  it ever stops firing on a real conflicting save, that is a regression.
- **`getExternalMtimeDrift()` exposes the same drift without a save.** Returns
  `{diskMtime, loadedMtime}` when they differ, else `null`. The
  `get_pad_status` MCP tool reads it so an agent can detect "reload before your
  next save" proactively.
- **`refreshLoadedMtime()` re-stamps `loadedMtime` to the current disk mtime.**
  Called by `reload_from_disk` after re-reading the file, so freshly-adopted
  external content becomes the new baseline and the next save proceeds.
  `setActiveDocument` re-stamps on every (re)load for the same reason.
- **Recovery is: adopt then save.** After a conflict, the caller reads disk,
  adopts the external content into in-memory state via a `docVersion`-bumping
  path (`updateDocument` — `reload_from_disk` does this), calls
  `refreshLoadedMtime`, and the next save proceeds because the guard's mtime
  comparison now matches.

## Decision log (append-only)

### 2026-05-17 — initial guard (commit c1011d9)

- Added `state.loadedMtime`, the `writeToDisk` mtime guard,
  `onExternalWriteConflict` + `notifyExternalWriteConflict`,
  `getExternalMtimeDrift`, and `refreshLoadedMtime`. `ws.ts` subscribes and
  broadcasts `external-write-conflict` to clients. Regression test
  `scripts/test-external-write-guard.mjs` (Case 1 conflict + payload, drift
  surface, reload-then-save recovery, first-save edge case, back-to-back
  clean saves).

### 2026-06-01 — guard runs downstream of the no-op gate; ADR file created

- This ADR file was referenced by `# adr:` markers in `server/state.ts` and
  `server/ws.ts` since `c1011d9` but had never been written. Created now.
- Clarified the guard ↔ no-op-gate ordering. The no-op gate (`26853c2`,
  `adr/pending-overlay-model.md`) was added the day after the guard and sits
  ABOVE it in `writeToDisk`. A bare `save()` with no in-memory mutation
  short-circuits at the gate, so the guard's conflict event does not fire on a
  zero-change save — by design, because such a save cannot clobber.
- `test-external-write-guard.mjs` was a casualty of that ordering: it faked the
  auto-save with a bare `save()` after an external write and asserted the
  conflict fired. Corrected (stale-test, no production change) to mutate
  in-memory state via `updateDocument` (the production write path) before
  `save()`, so the guard runs exactly as it does on a real auto-save. 18/0.
  See `adr/pending-overlay-model.md` (2026-06-01 entry) for the shared root
  cause across the three affected tests. Commit: TBD.

### 2026-10-06 — A save writes the file once

`writeToDisk` merged prose `doc:` link targets into `references` with a second,
frontmatter-only write after the body write. That write landed after
`loadedMtime` was re-stamped, so the watcher took our own save for an external
write, reloaded, and the guard then blocked the next save. References are now
merged into the metadata before serializing, so they ride the one write.
