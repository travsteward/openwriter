# Agent write lock — per-document

## Context

The agent write lock blocks browser `doc-update` messages for a short
window after an agent write, so the server's authoritative state can't
be overwritten by a stale browser save that captured the pre-write
document.

The first version of the lock was a single global timestamp
(`lastAgentWriteTime`). Any agent write — to *any* document, in *any*
workspace — set the same lock, and the WS handler rejected every
browser `doc-update` while it was active.

The cross-doc collateral damage that motivated this rewrite:

- User is typing in Document A in the browser.
- Agent does an MCP write to Document B (a different doc — could even
  be in a different workspace).
- Server fires `setAgentLock()` → global 3s lock active.
- Browser fires its debounced save for Document A → server rejects it
  with `BLOCKED by agent lock`.
- For the next 3 seconds, every keystroke save the user fires on
  Document A is thrown away.

The user's edits aren't necessarily lost — ProseMirror keeps them in
browser memory, and the next save after the lock expires will carry
them up — but they sit unsynced during the lock window, and any browser
event that pushes the server's state back to the editor (e.g., a
`document-switched` broadcast for Document A from an unrelated cause)
would overwrite them silently.

The fix: scope the lock to the document the agent actually wrote to.
A write to Document B no longer blocks saves for Document A.

## Current invariants

- Locks are keyed by the same identifier the browser sends in
  `doc-update.filename` — basename for docs inside `DATA_DIR`, full
  canonicalized path for external docs. Both sides run through
  `canonicalizeIdentifier` so separator/case drift can't desync them.
- `setAgentLock(filename)` requires an explicit filename. Empty
  filename falls back to the global lock (defensive — should not
  happen in practice).
- `setAgentLockActive()` locks whatever doc is currently active (per
  `state.filePath`). Used when the caller is mutating via
  `updateDocument`/`applyChanges` rather than an explicit filename.
- `setAgentLockGlobal()` locks every document for one TTL window.
  Used only as the empty-filename fallback. Never called from MCP tool
  paths, and not at server init (see 2026-09-29).
- `isAgentLocked(filename)` returns true if either the global lock is
  active OR the per-doc lock for `filename` is active.
- Lock TTL: 3000ms. Each new write to the same doc resets the doc's
  expiry (not extends — last write wins).
- Map cleanup is lazy: expired entries are removed when
  `isAgentLocked` reads them. There is no periodic sweep — the map
  stays small in practice (only docs touched in the last 3 seconds).

## Decision log (append-only)

### 2026-05-17 — Initial per-doc lock

- Trigger: events.log showed ~15 `BLOCKED by agent lock` rejections in
  a single session with browser node-counts diverging from server
  node-counts. User was typing in the active doc while a background
  MCP write held the global lock. Logged in
  `~/.openwriter/profiles/Default/events.log` between 22:11Z and
  23:17Z on 2026-05-17.
- Change: replaced single `lastAgentWriteTime: number` with
  `lockExpiry: Map<string, number>` + a separate `globalLockExpiry`
  for startup. Added `setAgentLockActive()` and
  `setAgentLockGlobal()`. `setAgentLock()` now takes a required
  filename. `isAgentLocked()` now takes a required filename.
- Files: `packages/openwriter/server/state.ts` (lock section + two
  call sites), `packages/openwriter/server/ws.ts` (two call sites),
  `packages/openwriter/server/mcp.ts` (three call sites),
  `packages/openwriter/server/index.ts` (one call site).
- Note: same-doc live collaboration (agent and user editing the same
  document concurrently) is still resolved by lock-and-reject — the
  user's saves to the same doc the agent is writing to are still
  blocked. A real merge/CRDT story is a separate decision, tracked
  outside this ADR.

### 2026-09-29 — no startup lock

The server used to lock every doc for 3s at startup so a reconnecting tab
could not push a copy from before the restart. That dropped the one push
that matters: edits typed while the server was down, resent on reconnect.
The server logged the drop and told no one, so the tab believed it had
saved. The browser now owns this decision (adr/per-tab-view.md, same
date): on reconnect it resends its copy only when the server's copy is
exactly what the tab last sent, and otherwise takes the server's copy and
warns the user. The startup call is removed; `setAgentLockGlobal` remains
only as the empty-filename fallback.
