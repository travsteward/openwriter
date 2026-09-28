# ADR: create_document placement contract

## Context

`create_document` is the entry point agents use to make a doc and (optionally) file it into a workspace/container. Historically it addressed placement by **name**: `workspace` = workspace *title* (auto-created), `container` = container *name* (auto-created). Every other workspace tool in the MCP surface (`move_item`, `get_workspace_structure`, `browse_docs`, `link_to`) addresses by **id**: `workspaceFile` (the `*.json` manifest filename) + `containerId`/`targetContainerId` (8-hex).

Both MCP registration paths wrap tool schemas in plain `z.object(shape)` (`server/index.ts`, and the stdio `server.tool` in `server/mcp.ts`), which **strips unknown keys** — a misnamed param is silently discarded, not rejected.

## The failure this prevents

An agent, working from the id-convention every other tool uses, called `create_document({ workspaceFile, container: <id> })`. Result:
- `workspaceFile` was unknown to the old schema → silently stripped.
- `container` "requires workspace"; no `workspace` was given → the placement branch never ran.
- The doc was created with **no workspace association at all** (orphaned in `~/.openwriter`), and the result string reported success with no placement clause — because the placement clause was gated behind the very params that got dropped.
- `get_workspace_structure` cannot show an orphan (it only renders the tree), so the miss was invisible to the caller's normal verification. Six docs were orphaned before anyone read the workspace JSON on disk.

The root cause is **contract divergence + silent-strip + placement-silent success** stacking: the natural call was wrong, the wrongness was swallowed, and the swallow was concealed.

## Current invariants

- `create_document` accepts **both** addressing conventions:
  - name-based auto-create: `workspace` (title) + `container` (name) — unchanged behavior.
  - id-based targeting of existing items: `workspaceFile` + `containerId` — must already exist.
- Precedence: an explicit id (`workspaceFile` / `containerId`) wins over the name form when both are given.
- A placement param that **cannot be honored is a hard error**, never a silent drop:
  - unknown `workspaceFile` → error.
  - unknown `containerId` (not in the resolved workspace) → error.
  - `container`/`containerId` given with no resolvable workspace → error.
- The result string **always** states final placement: either `→ workspace "X" / Container` or `(UNFILED — not added to any workspace; lives at ~/.openwriter)`. An unplaced doc can never read as a bland success.

Net effect: any reasonable placement call either lands the doc (and says where) or errors loudly. Silent orphaning is not reachable from any argument combination.

## Not done here (deliberately)

Global schema strictness (`.strict()` on every tool so *any* unknown param hard-errors surface-wide) was considered and declined: LLM callers frequently pass stray/hallucinated params that lenient parsing harmlessly drops, so surface-wide strict carries broad regression risk. This ADR fixes the one tool where a dropped param silently produced orphaned data reported as success. Revisit global-strict as its own decision if a second silent-drop bug appears on a different tool.

## Decision log

- **2026-07-09** — Unified the placement contract (accept id-based `workspaceFile`+`containerId` alongside name-based `workspace`+`container`), added hard errors for unhonorable placement, and made the result always state placement/UNFILED. Fixes the silent-orphan class in `create_document`. Verified: id-based call lands + reports; bad `containerId` errors; container-without-workspace errors; no-placement reports UNFILED. Frontend `src/` tsc errors are pre-existing and unrelated.
- **2026-09-28** — `empty: true` now writes the file through the same no-switch path as the two-step create (`createDocumentFile`), minus the spinner. Placement handling is unchanged. The result says "ready" and tells the agent to write by docId. See adr/per-tab-view.md.
