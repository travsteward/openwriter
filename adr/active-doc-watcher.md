# Active-doc fs.watch subscription

## Context

The active doc lives at a real filesystem path. Three actors can write
to it:

1. **openwriter itself** — via `writeToDisk` (auto-save, MCP write_to_pad,
   reject/accept). Server-side: state mutates first, disk follows.
2. **The browser** — via WS `doc-update` messages from TipTap onUpdate.
   Server-side: state mutates from browser payload, then debounced
   auto-save flushes to disk.
3. **An external tool** — agent's `Edit` tool, VSCode, a manual `echo > file`,
   a `git checkout` of an underlying revision. Server-side: it has no
   idea this happened. State and disk diverge silently.

The third case used to produce a specific high-impact bug. Concrete
scenario from the inbox brief:

- A user opens `~/.claude/skills/openwriter/SKILL.md` in openwriter
  (an "external" doc — not in the openwriter data dir).
- The agent edits the same SKILL.md directly via the `Edit` tool to
  refine the skill content (faster than routing through the MCP for
  every change).
- The browser autosave fires later (45s–2min after its last user edit
  produced a debounce). It sends the TipTap state from *before* the
  external write. The server accepts (no MCP writes have occurred,
  so `docVersion` is unchanged from when the browser captured it).
  `writeToDisk` runs; the `loadedMtime` guard didn't refresh because
  there was no in-band trigger to refresh it.
- Result: the agent's external edits are silently overwritten by stale
  in-memory state. Hours of work disappear with no notification.

The pre-existing partial fixes did not close this hole:

- `loadedMtime` mtime guard in `writeToDisk`: pull-based, only fires on
  a save. By that point, in-memory state has already been mutated from
  the stale autosave; the guard merely refuses to flush. The user sees
  no UI feedback; they think their autosave succeeded.
- `docVersion` counter check on `doc-update`: only advances on MCP
  writes. External writes don't bump it, so a stale browser version
  matches the unchanged server version and the autosave passes the
  check.

The right model is push-based. The OS already knows when a file
changes. We subscribe to that signal and route every external write
through a single reload pathway. The reload bumps `docVersion`, which
makes the *existing* version check reject stale autosaves; nothing
else in the WS handler needs to change.

## Current invariants

- A single `FSWatcher` watches at most one file at a time —
  `state.filePath`, the active doc.
- `startActiveDocWatcher()` is called from `setActiveDocument` and from
  `load()` on startup. It tears down any prior watcher before opening
  the new one.
- `clearAllCaches()` (profile switch) calls `stopActiveDocWatcher()` so
  the watcher never points at a path the new profile doesn't own.
- Watcher events are debounced 80ms before processing — editors often
  write through a temp-file + rename pattern that fires multiple
  events for one logical save.
- On debounce flush, the handler verifies `state.filePath` still equals
  `activeWatcherPath`. If the user switched docs during the debounce
  window, the event is dropped (the new active doc has its own
  watcher).
- The handler compares the live disk mtime against `state.loadedMtime`.
  Equal mtime means the event was triggered by our own
  `atomicWriteFileSync` (which re-stamps `loadedMtime` after every
  successful own write). Only `diskMtime !== loadedMtime` proceeds.
- On real external writes, the handler calls `reloadActiveDocFromDisk`,
  calls `bumpDocVersion`, and fires `onDocumentReloaded` listeners.
  The WS layer subscribes that listener and broadcasts a
  `document-reloaded` message containing the new state plus orphan +
  stale-baseline counts from the pending overlay merge.
- The pre-existing `writeToDisk` mtime guard remains as a backstop. In
  the normal case the watcher reloads first, so the guard never fires.
  If the watcher misses an event (fs.watch is best-effort on some
  filesystems), the guard catches the next save.

## Decision log (append-only)

### 2026-05-17 — initial implementation
- Bug: external Edit to an open SKILL.md is overwritten by stale
  browser autosave; loadedMtime + docVersion are both pull-based and
  do not detect external writes proactively.
- Architectural fix: push-based fs.watch on the active doc. External
  writes flow through `reloadActiveDocFromDisk` → `bumpDocVersion` →
  `onDocumentReloaded` broadcast. The existing `isVersionCurrent`
  check on the WS `doc-update` path now rejects stale autosaves
  because the version actually advanced when the external write
  landed.
- Why fs.watch and not chokidar: single-file watching is reliable on
  all three Node platforms (inotify / FSEvents /
  ReadDirectoryChangesW). Chokidar's value is recursive directory
  trees and event normalization; both are irrelevant here. Avoiding
  the dependency keeps the npm package leaner.
- Files changed:
  - `server/state.ts` — added watcher module
    (`startActiveDocWatcher`, `stopActiveDocWatcher`,
    `handleWatcherEvent`, `onDocumentReloaded` listener registry,
    `DocumentReloaded` interface). Wired into `setActiveDocument`,
    `load`, `clearAllCaches`. Imported `watch, FSWatcher` from `fs`.
  - `server/ws.ts` — subscribed `onDocumentReloaded`; broadcasts
    `document-reloaded` to clients with reloaded doc state + orphan
    counts. Imported `DocumentReloaded` type.
  - `scripts/test-active-doc-watcher.mjs` — new regression test:
    external write fires reload (with version bump), self-write
    doesn't, pending overlay survives reload, watcher swaps on doc
    switch, burst writes coalesce into one event.

### 2026-09-07 — Manuscript editing drafts

Creating a manuscript editing draft leaves the active document untouched. The UI explicitly switches afterward through the existing document-switch path and watcher lifecycle.
