# ADR: Document history & author attribution

## Context

OpenWriter docs interleave human-authored and agent-authored content with no way,
after the fact, to tell which is which. The need is git-style **attributed edit
history** — per-span human-vs-agent blame, replayable layers, doc "voice-shape" —
*and* the existing whole-doc version **restore**, from one system.

Three systems already exist and are folded here rather than duplicated:
- **Version snapshots** (`server/versions.ts`) — whole-doc `.md` copies, the commit/restore unit.
- **Activity log** (`server/activity-log.ts`) — agent-attributed event stream (humans are intentionally unlogged), the "who/what".
- **Node-identity matcher + per-sentence fingerprints** (`server/node-matcher.ts`, `node-fingerprint.ts`) — already compute, every save, which sentence in which block changed; that delta was discarded.

Full design + the multi-agent design pass that produced it: `chip-notes/author-attribution-design.md`.

## Current invariants

1. **Blame is anchored to `sentenceHash`, never to nodeId or matcher mutation labels.**
   A sentence's author follows its content hash (`simpleHash(text+terminator)`, the
   same hash the fingerprint/enrichment path uses). This is what makes blame survive
   split, merge, type-change, heavy-rewrite-that-re-mints-an-id, and paste-back —
   node-id keying and `mutation='split-first'` labels only cover zero-edit cuts.
2. **One capture point: `writeToDisk()` in `state.ts`.** Actor + per-sentence delta are
   computed there (the same `harvestSentenceHashes(newBlocks)` already used for
   enrichment staleness) and written to Tier B + Tier A before `snapshotIfNeeded`.
3. **Actor is a save-scoped, REQUIRED value — never a module-global shim.** It is threaded
   `save(actor)` → `writeToDisk(actor)`. The human default lives at exactly one site (the
   WS `doc-update` door); every agent door passes `'agent'` explicitly. A module-level
   `currentActor` would race under interleaved saves and corrupt attribution — banned.
4. **Three tiers, cross-referenced not embedded.**
   - Tier C = `.versions/{docId}/{ts}.md` (commit/restore, unchanged in spirit).
   - Tier B = `_history/{docId}.jsonl` (append-only attributed `EditEvent`s; per-doc, NOT the global `activity.log`).
   - Tier A = `_blame/{docId}.json` (materialized current blame; the instant heatmap; rebuildable from B+C).
   `EditEvent.versionTs` binds each event to the snapshot cut it folded into.
5. **Accept does not launder.** Accepting an agent's pending change keeps agent origin —
   origin is decided at write time, not at accept. autoAccept agent writes are stamped at
   `applyChangesToDoc` (the site that omits `pendingStatus`), so capture still sees agent.
6. **Sidecars live in the profile data dir, never beside user content.** `_history/{docId}.jsonl`
   and `_blame/{docId}.json` are written under `getDataDir()` (alongside `_pending/`, `_marks/`,
   `.versions/`), keyed by docId — NOT next to an external/vault `.md`. So a user's own git repo
   is never polluted, and the data dir is local-by-default (not a tracked repo). No `.gitignore`
   management is required in this codebase. (The design doc's "ensureGitignore reconcile" task
   referenced a different codebase's assumption; OpenWriter has no such helper.)
7. **Prune-driven compaction.** Before `pruneVersions` unlinks a snapshot, the current
   blame is preserved (folded into Tier A); only ancient granular layer-history is compacted.
   Blame must never silently vanish when versions prune (`max(50, 7-day)`) or `activity.log` rotates.
8. **Pre-feature content is `unknown`, not `human`.** A doc-level `attributionSince` marker
   disambiguates legacy from genuinely human.

## Decision log

- **2026-06-13** — Design ratified (5 forks decided by owner: human edits emit a lightweight
  event; per-doc sidecars gitignored; going-forward only, no backfill; binary `lastBy` flip).
  Chosen architecture: hybrid three-tier over one capture point, with content-addressed
  (sentence-hash) blame grafted in for durability. Phase 1 = capture + restore parity +
  voice-shape heatmap. Build started this commit.
- **2026-06-13** — Phase 1 landed on `chip/design-block-level-author-attribution`:
  `server/attribution.ts` (pure core + sidecar IO), capture wired into `writeToDisk`
  (active door) + `flushDocToFile` (door 3) + `saveDocToFile` (routed browser) with the
  save-scoped actor (`debouncedSave(actor)` flush-on-actor-change; agent doors in `mcp.ts`,
  human door in `ws.ts`), collision-safe snapshot ts in `versions.ts`, `get_attribution`
  MCP tool + `/api/attribution/:docId`, and the heatmap (`attribution-plugin.ts` + App
  toggle + CSS). Tested: 25 unit + 11 integration assertions (incl. no-launder + paste-back
  + split-survival through the real save path). Integration surfaced + fixed a real bug:
  pending-only saves left the canonical body byte-identical, short-circuiting the body-write
  guards and the tail capture — moved capture beside `saveOverlay` (where merged state
  persists). OUTSTANDING: live-browser verification of the heatmap (chip worktree isn't the
  served build — do post-merge); Tier B `_history/*.jsonl` rotation (Phase 3+); replayable
  layers UI (Phase 3).
- **2026-06-13** — Merged to `main` (local, not pushed) and LIVE-VERIFIED in the running
  browser per `/openwriter-testing`. All channels agreed: agent `populate_document` → endpoint
  100% agent + `_blame`/`_history` correct; human Accept-all of the agent content kept origin
  `agent` at endpoint + sidecar + visually (no-launder confirmed live); a hand-typed paragraph
  landed as `human`, yielding 72% agent / 28% human / 0% unknown char-weighted, with the
  `_history` log recording `seq1 agent` + `seq2 human`. Heatmap toggle renders, tints agent
  blocks amber + the human block blue, and shows the % legend. One test-only wrinkle (not a
  defect): the human paragraph's blame lagged ~minutes because a *second* browser tab editing a
  large chapter held the agent write-lock / triggered destructive-update guards — a known
  multi-client save-contention landmine; capture is correct, it just runs when the save flushes.
  RESOLVED the prior "live-browser verification OUTSTANDING" item.
- **2026-06-13** — Heatmap UI refined per owner feedback: (a) the in-editor decoration is a
  per-block background WASH only — dropped the gutter `::before` bar (it sat over the text);
  `unknown` paints nothing so untracked docs stay clean. (b) The toggle moved from a floating
  bottom-left pill to an ICON button in the RightRail topbar beside Focus/Toolbar — it is a
  boolean overlay toggle, which matches the topbar toggle pattern, not a tab/panel. `VoiceIcon`
  added to `right-rail/icons.tsx`; RightRail takes `heatmapOn`/`onToggleHeatmap`/
  `heatmapAvailable`/`heatmapTitle` (threaded from App.tsx like `focusMode`). The % composition
  moved from an inline legend into the button tooltip. Pill JSX + its CSS removed. State + the
  capture/fetch wiring are unchanged (surface-independent, keyed on `heatmapOn`).
- **2026-06-13** — Phase 2 model decided (owner). The headline feature was never the heatmap;
  it is the Versions panel as ATTRIBUTED GIT-HISTORY (the heatmap is just the live current-blame
  lens). Decisions:
  (a) VERSION MODEL = boundary **commits**, not the 30s auto-snapshots. Auto-snapshots are
  demoted to a hidden restore safety-net (unchanged). A *commit* bundles the `_history`
  edit-events since the prior commit into a manifest entry: `{ ts, parent, actors[],
  changeset (per-node added/edited/removed by actor), note?, snapshotTs }`.
  (b) COMMIT TRIGGERS = agent-finishes-writing (`ws.ts` writing-finished, actor=agent),
  accept / accept-all (the `ws.ts` resolve action=accept path), and a manual "Save version"
  button (+ optional note). Author-handoff is NOT a trigger (covered by the others).
  (c) PANEL = a commit LIST (row: time + author badges + one-line changeset) → click → an
  ATTRIBUTED DIFF (the commit's snapshot vs its parent's, diffed via the node matcher, spans
  coloured by `_history` authorship) — i.e. "what changed in this commit and who did it".
  Builds entirely on the Phase-1 `_history` / `_blame` / `versionTs` substrate — no capture
  changes. NEW: server `commits.ts` (manifest + changeset rollup + attributed diff), the three
  commit-trigger hooks, a rewritten `right-rail/tabs/VersionsTab.tsx`, and a `/api/commit` +
  `/api/commits/:docId` + `/api/commit-diff` surface. Phasing: 2a = server core + triggers
  (unit-tested); 2b = the panel UI.
- **2026-06-13** — Phase 2 BUILT + LIVE-VERIFIED; three weight/retention gaps closed.
  RETENTION: `_history` rotates at 5MB (roll to `.1`); commit snapshots dedup
  (writeSnapshotMarkdown reuses identical content) + obey `pruneVersions`; redundant
  `_blame` rewrites are skipped when a save produced no authorship change. The docs
  themselves are never touched — all footprint is in profile sidecars.
  TRIGGER RELOCATION (a live test caught this): the agent-finished commit was first
  hooked to `broadcastWritingFinished`, which only commits the ACTIVE doc AND is not
  fired by `write_to_pad` — so the most common agent tool, writing to a non-active
  doc, never committed. Moved to the CAPTURE site (`state.ts` writeToDisk +
  flushDocToFile via `scheduleAgentCommit(docId, filePath)`), the only place every
  agent write is seen with its exact target. `commits.ts` dropped its `documents.js`
  import (now `commitFromFile(docId, filePath, opts)`) to avoid a
  state→commits→documents→state cycle. LIVE-VERIFIED in the browser: write_to_pad to
  a non-active doc → an agent-finished commit on the correct doc (`+6 agent`); the
  Versions panel shows the commit list (time + author badge + changeset), expands to
  trigger + per-actor breakdown + Restore, with a Save-version button; manual no-op
  guard + commit-detail confirmed. 55 unit assertions green.

### 2026-09-07 — Manuscript editing drafts

Manuscript copies capture their initial text as unknown origin and create an Original manuscript copy commit through existing attribution/history APIs, preserving a visible restore point without claiming fresh authorship.
