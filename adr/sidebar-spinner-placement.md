# Sidebar Writing Spinner Placement

## Context

When the MCP `create_document` (or `declare_writes`) tool runs with a `workspace` + `container` target, the server emits two WebSocket messages back-to-back: `workspaces-changed` (so the browser knows the new container exists) and `writing-started` (carrying `{ wsFilename, containerId }` so the sidebar knows where to render the spinner placeholder).

The sidebar renders that spinner placeholder in three possible places:

1. Inside a specific container (`SidebarDefault.tsx` ~line 411, `SidebarFiles.tsx` ~line 533) — match on `wsFilename + containerId`.
2. At the workspace root (`SidebarDefault.tsx` ~line 524, `SidebarFiles.tsx` ~line 622) — when `containerId === null`.
3. In the unassigned-documents section — when no workspace matches.

The race that makes this non-obvious: `workspaces-changed` only bumps a refresh key (`App.tsx:273`), which fires an **async** HTTP refetch in `useSidebarData`. `writing-started` updates `writingTarget` **synchronously**. React re-renders before the refetch settles, so on first paint `writingTarget.containerId` points to a container that isn't in the client's workspace tree yet.

## Current invariants

- **The spinner only renders at the workspace root when `containerId === null`.** No defensive fallback that promotes a container-targeted spinner up to the workspace root when the container appears absent — that fallback exists nowhere in `SidebarDefault.tsx` or `SidebarFiles.tsx`. If the container isn't in the client tree yet, the spinner waits one render cycle for the workspace refetch to complete, then renders inside the container.
- **The server is the authority on container existence at broadcast time.** `create_document` and `declare_writes` run `findOrCreateContainer` before broadcasting `writing-started`, so a `containerId` in the payload is guaranteed valid on disk. Client-side "is this container real" checks are redundant at best and bug-causing at worst.
- **`broadcastWorkspacesChanged()` MUST fire before `broadcastWritingStarted()` on the server.** Same WS, same connection, in-order delivery — the client sees the workspace-tree refresh kick off first, then the spinner-placement message. Reversing this order would break even with the right client-side logic.
- **The spinner placeholder MUST carry the same inline `paddingLeft` as its sibling docs in `SidebarFiles`.** SidebarFiles uses inline `paddingLeft` per item (computed as `12 + depth * 16` inside `renderNode`, hardcoded `28` for unassigned/workspace-root docs) because `.files-children` itself has no CSS padding rule. A `.sidebar-item` without an inline padding falls back to the base `padding: 8px 10px` and visually slams against the sidebar's left edge — looking like the spinner is at the parent (workspace root) indent level even though its DOM parent is the correct container. SidebarDefault is unaffected: it uses `.sidebar-container-list` (which has its own CSS padding) and renders items without inline padding, so spinner + siblings align naturally.

## Decision log (append-only)

### 2026-09-08 — Variant disclosure controls

Moved variant toggles to the leading edge and split title opening from row
expansion. Existing placeholder placement and indentation remain unchanged.

The follow-up visual pass replaces the parent's document icon with its chevron
in one aligned slot; spinner placement and child indentation remain unchanged.

### 2026-05-17 — Add inline `paddingLeft` to SidebarFiles spinner placeholders (the actual user-visible bug)

- **Trigger.** The user: *"this didnt' work btw. New docs always placeholder/spinner create at parent level, even if in a container."* The earlier `!hasContainer` fix had no visible effect because it addressed a latent race condition, not the bug the user was reporting.
- **Root cause.** SidebarFiles renders doc rows with `style={{ paddingLeft: indent }}` (44px for a doc inside a container at depth 1). The spinner placeholder rendered with NO inline padding, falling back to `.sidebar-item`'s base `padding: 8px 10px`. Visually the spinner sat 34px to the left of every chapter doc — at the same x-position as the workspace section labels — making it look like the doc was being created "at parent level" even though the DOM parent was the correct container.
- **Verification (live).** Playwright headless captured the spinner DOM during `writing-started`. Pre-fix: `spinnerPaddingLeft: "10px"`, sibling `paddingLeft: "44px"` — 34px misalignment. Post-fix: both `"44px"`, perfectly aligned. DOM parent in both cases was correctly `DIV.files-children[c=5446004e]` (the Chapters container) — confirming the placement logic was right, only the indent was wrong.
- **Change made.** Three sites in `packages/openwriter/src/sidebar/SidebarFiles.tsx`:
  - **Container spinner** (~line 543): `style={{ paddingLeft: 12 + (depth + 1) * 16 }}` — mirrors `renderNode`'s `12 + depth * 16` formula for children at depth+1.
  - **Unassigned-docs spinner** (~line 569): `style={{ paddingLeft: 28 }}` — matches `renderDocWithVariants(doc, 28)`.
  - **Workspace-root spinner** (~line 624): `style={{ paddingLeft: 28 }}` — matches `renderNode(node, 1, ...)` → `12 + 1*16 = 28`.
- **SidebarDefault left untouched.** Its container uses `.sidebar-container-list` which has its own CSS padding; items render without inline padding, so spinner + siblings align naturally.
- **Invariant for future edits.** Any new spinner placeholder render site in SidebarFiles must explicitly set inline `paddingLeft` matching the sibling items at that level. The CSS-only path (the way SidebarDefault works) is NOT available in SidebarFiles because `.files-children` provides no padding.

### 2026-05-16 — Drop the `!hasContainer(wsRoot, containerId)` fallback

- **Trigger.** The user: *"When create_doc mcp runs in openwriter, it doesn't match the parent/child level the doc is being created in. So if the doc level its being made in is in a container, under a workspace, it shows it being created at the parent level."* Repro: any `create_document` with workspace + container — spinner renders at workspace root, then jumps into the container ~100–200ms later once the workspaces refetch lands.
- **Root cause.** `SidebarDefault.tsx:524` and `SidebarFiles.tsx:622` carried a fallback condition `writingTarget.containerId === null || !hasContainer(wsRoot, writingTarget.containerId)`. The `!hasContainer(...)` half was reasoned as "if the container doesn't exist, show the spinner somewhere sensible." But the only realistic way `!hasContainer` returns true is the async-refetch race — exactly when the spinner is meant for a brand-new container that the client hasn't fetched yet.
- **Change made.** `SidebarDefault.tsx:524` and `SidebarFiles.tsx:622` reduced to `writingTarget.containerId === null`. Also removed the now-unused `hasContainer` helper at `SidebarDefault.tsx:21`. Files: `packages/openwriter/src/sidebar/SidebarDefault.tsx`, `packages/openwriter/src/sidebar/SidebarFiles.tsx`. Parent commit before fix: 39d24ac.
- **Trade-off accepted.** The spinner is invisible for the ~100–200ms window between `writing-started` and the workspaces refetch settling. That's better than a flicker into the wrong location and back. If this window is later considered too long, the right fix is to send the workspaces snapshot inline with the `writing-started` payload — NOT to reintroduce the workspace-root fallback.
- **Invariant for future edits.** Do not add "show the spinner somewhere visible if its container can't be found" defensive code to either sidebar. A missing container in the client tree means a refetch is in flight — wait it out.
