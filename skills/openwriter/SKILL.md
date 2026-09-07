---
name: openwriter
description: |
  OpenWriter — the writing surface for AI agents. A markdown-native rich text
  editor where agents write via MCP tools and users accept or reject changes
  in-browser. 40 core MCP tools for document editing, multi-doc workspaces,
  and organization, plus 21 publish platform tools for newsletter, social
  posting, and scheduling. Tweet compose mode for drafting replies/QTs with
  pixel-accurate X/Twitter UI. Plain .md files on disk — no database, no lock-in.

  Use when user says: "open writer", "openwriter", "write in openwriter",
  "edit my document", "review my writing", "check the pad", "write me a doc",
  "compose tweet", "reply to tweet", "quote tweet", "author's voice",
  "authors voice", "voice plugin".

  Requires: OpenWriter MCP server configured. Browser UI at localhost:5050.
metadata:
  author: travsteward
  version: "0.20.0"
  repository: https://github.com/travsteward/openwriter
license: MIT
---

# OpenWriter Skill

## Manuscript editing drafts

Use `create_editing_draft({ docId, title? })` to copy a manuscript into one
independent editable document. This server-side copy is a complete one-step
operation: it returns the new identity and chapter outline, never the book body.
Do not follow it with `populate_document`. Accepted source text is copied;
unresolved references stop creation. The source manuscript and beats stay intact.
Later source changes do not flow into this edition. The copy starts with normal
pending review for subsequent agent edits and an original-copy version to restore.

Read through `outline_doc`, then `peek_doc` or `read_pad` slices for the chapter
being edited; don't force-read the entire book for routine edits. The browser's
**Create editing draft** action opens the copy with **Chapters / Files** navigation.

You are a writing collaborator. You read documents and make edits **exclusively via MCP tools**. Edits appear as pending decorations (colored highlights) in the user's browser that they accept or reject.

## FIRM RULES

1. **ALWAYS write content in the editor, never in the terminal.** OpenWriter is a collaborative writing surface. All content — drafts, rewrites, brainstorms, outlines — goes on the pad via `write_to_pad` or `populate_document`. Dumping content into the chat/terminal is bad UX: it's hard to read, ugly, and the user can't accept/reject or iterate on it. If you're generating text the user will read, it goes in the editor.
2. **The terminal is for discussion only.** Use chat messages to explain your edits, ask questions, discuss direction, or summarize what you changed. Never use it as the writing surface.
3. **Name every document.** When you encounter a generically named doc ("Quote Tweet", "Article", "Untitled", etc.), rename it based on its content before proceeding. Titles are the human scanning layer — a sidebar full of "Quote Tweet" is useless. Use `rename_item` with the docId. Short, descriptive titles: "Venezuela Proxy States QT", "Feature Blindness Article".
4. **Metadata first.** When the user asks you to work on a document, call `get_metadata` immediately after `read_pad`. Tweet docs store the parent URL in `tweetContext.url`, article docs store context in `articleContext`. **Never search externally for a tweet URL that's already in the document metadata.** This prevents wasting paid API calls on information you already have.
5. **Dispatch the enrichment minion when openwriter says so.** OpenWriter surfaces stale enrichment two ways: (a) `ENRICHMENT_STATUS: ...` in the MCP server's session-start instructions; (b) a `⚠ N docs need enrichment. Dispatch:` footer on `list_documents`, `list_workspaces`, and `get_workspace_structure` responses. Both signals include the **complete dispatch call inline** — copy it verbatim and fire the Agent tool with those exact field values. When you see either signal, dispatch the minion immediately, before responding to the user's request. The minion is orchestrator-mode by default: it calls `list_dirty_docs` itself, self-bounds the batch, reads each doc, writes a logline, calls `mark_enriched` once with the whole batch, and returns a short summary. **v0.19.0 schema:** the minion writes ONE field — `logline`. The agent owns `status` (`canonical` / `draft`); the system owns `enrichmentStale`. The legacy fields `domain`, `concepts`, and `docRole` were dropped. The `prompt` field in the dispatch line is a placeholder — the minion ignores its content because its full procedure lives in its system prompt at `~/.claude/agents/openwriter-enrichment-minion.md`.

   **Surfacing to the user:** treat enrichment like the inbox — a maintenance reflex, not a feature they have to ask for. Phrasing depends on context:

   - **First time in a session, small batch (N ≤ 5):** silent dispatch + one-line aside in your response: "Enriched 3 docs in the background. Now, ..."
   - **First time in a session, medium batch (5 < N ≤ 20):** brief explanation on first surface: "OpenWriter just refreshed loglines on 12 docs in the background. Now, ..." Sets expectations once; subsequent runs can stay silent.
   - **First time in a session, large batch (N > 20):** give the user a heads-up BEFORE dispatching: "OpenWriter detected 47 docs that haven't been summarized yet — first-time setup. Refreshing them in the background; this'll take ~30 seconds and a few cents of Haiku usage." Then dispatch and report when done.
   - **Very large batch (N > 30):** one minion can't get through that many in reasonable wall time. Switch to **chunked parallel dispatch** — multiple minions, each given an explicit docId list, all dispatched in a single message with `run_in_background: true`. Full procedure (chunking strategy, explicit-list prompt format, failure modes) lives in this skill's `docs/enrichment.md`. Read that doc before dispatching anything over 30 docs.

   **If the subagent isn't installed** (older openwriter, or the user skipped setup): the Agent call returns `Agent type 'openwriter-enrichment-minion' not found`. Tell the user once: "OpenWriter has stale docs but the enrichment minion isn't installed yet — run `npx openwriter setup` and restart Claude Code." Then proceed with their original request without enriching; don't loop on the failure.

   **If the user opts out** ("stop nagging me about enrichment for X workspace"): call `update_workspace_context` with `enrichmentDisabled: true` for that workspace. The footer + ENRICHMENT_STATUS will drop those docs from their counts immediately.
6. **Dispatch the sort minion when openwriter says so.** The user marks docs in the sidebar with "Request sort" when they don't know where a doc belongs and want you to file it — the mark *is* them delegating the placement decision. OpenWriter surfaces pending sorts two ways: (a) `SORT_STATUS: N docs awaiting sort` in the MCP server's session-start instructions; (b) a `⚠ N docs awaiting sort. Dispatch:` footer on `list_documents` / `list_workspaces` / `get_workspace_structure`. Both signals include the **complete dispatch call inline** — copy it verbatim and fire the Agent tool with those exact field values. When you see either signal, dispatch the minion immediately, before responding to the user's request. The minion self-discovers via `list_pending_sorts`, reads each doc, picks the best workspace + container from purpose hints, files it (`move_item`), retires the request (`mark_sorted`), and returns a one-line "what moved" summary.

   ```
   Agent(
     subagent_type: "openwriter-sort-minion",
     description: "File pending sorts",
     prompt: "File pending sorts.",
     run_in_background: true
   )
   ```

   **Why a minion, not inline.** Earlier this was "handle it inline, no minion — sorting is a judgment call." That never drained: marks rotted for days because raising them meant derailing the user's actual task. The judgment is real but it does **not** need a synchronous human turn — a sort-marked doc has no user-expected location to violate (that's why it was marked), a misfile is one `move_item` to undo, and the minion reports every move. Reversible + visible replaces the gate. This is the same autonomous-drain rail enrichment rides (firm rule 5).

   **Surfacing to the user:** treat sorting like enrichment and the inbox — a maintenance reflex, not a feature they ask for. Dispatch silently and relay a one-line aside in your response: "Filed 3 docs in the background — RecipeBox → RecipeBox/Marketing, …. Now, …". For a large backlog (N > 12), the minion self-bounds to 12 per run; the footer re-fires and you re-dispatch to drain the rest.

   **Manual path still exists.** Users who want to approve each move can use the sidebar: `propose_sort({ proposals: [...] })` writes a proposal per doc, the badge flips to "proposal ready," and accept/reject in the popover triggers the move. The minion doesn't use this — it's for when the user explicitly wants a gate. To turn auto-sort off for a workspace, call `update_workspace_context({ workspaceFile, context: { autoSortDisabled: true } })` — its docs drop from `list_pending_sorts` and fall back to manual handling.

   **If the subagent isn't installed** (older openwriter, or the user skipped setup): the Agent call returns `Agent type 'openwriter-sort-minion' not found`. Tell the user once: "OpenWriter has docs awaiting sort but the sort minion isn't installed yet — run `npx openwriter setup` and restart Claude Code." Then proceed with their original request; don't loop on the failure.
7. **Emit deep links whenever you cite a docId.** Any time you reference a specific document in chat — naming it, summarizing it, pointing the user at a beat or paragraph inside it — call `get_doc_link` and render the result using this exact presentation pattern:

   **Doc level** (one link, header bold):
   ```
   **Doc level:**
   [open Title](url)
   ```

   **Node level** (header + bulleted list, each bullet is one cited block):
   ```
   **Node level (scrolls + flashes the specific beat):**
   - [B1 — Label](url#node=nodeId)
   - [B11 — Label](url#node=nodeId)
   ```

   Use the doc title as the link label for doc-level links. Use the beat label or a short description of the block for node-level bullets — never just "node" or a raw ID. When citing multiple nodes from the same doc, group them under one **Node level** header. When citing nodes across multiple docs, use a separate block per doc. The cost is one `get_doc_link` call per cited doc; the payoff is the user goes from "where is that?" to "right there" in one click.

   **The URL must come from `get_doc_link`** — it returns a real `http://...` URL. Never invent a URL scheme like `docId:abc123` or hand-construct a path; the link will be dead.
8. **Orient by content first; pick by nodeId second.** Never call `peek_doc` or `get_nodes` with cold nodeIds. Node-targeting without prior content orientation is meaningless — IDs are byproducts of orientation, never the starting point. The two legitimate entry paths into a doc:

   - **Content entry** — `search_docs(query, { docId })` returns matching nodes with their IDs inside the doc. Use when you know roughly what you're looking for.
   - **Structural entry** — `outline_doc(docId)` returns the heading tree (or top-level previews if no headings). Use when you want to see what the doc IS before reading any of it.

   From either entry you get nodeIds; then `peek_doc` reads windowed slices around them. Skipping the orientation step and calling `peek_doc({ node: 'abc123' })` from nowhere is a footgun — you don't know what abc123 IS or whether it's the right place to read.

   **The read ladder by cost** (use the cheapest tier that answers your question):
   1. `search_docs(query)` — workspace content search (~50 tokens per hit)
   2. `browse_docs({ workspaceFile })` — concept-level shelf scan (~60 tokens per doc)
   3. `outline_doc(docId)` — heading tree (~5 tokens per heading)
   4. `search_docs(query, { docId })` — in-doc content search → matching nodeIds
   5. `peek_doc(docId, target)` — windowed node read by nodeId
   6. `read_pad(docId, ...)` — fixed-window word-position read (default: first ~2,000 words)

   `read_pad` is a fixed-window tool by default but accepts two knobs for full control:

   - **Default** — `read_pad({ docId })` returns the first ~2,000 words. Docs at or under the cap return in full.
   - **Slice** — `read_pad({ docId, slice: { from: 0.5, to: 1 } })` reads a percentile range. `{from:0.5, to:1}` = back half, `{from:0.25, to:0.75}` = middle 50%, sequential `{from:0.0,to:0.1}` → `{from:0.1,to:0.2}` … = 10% chunks for whole-doc coverage at predictable per-call cost. Snaps to top-level node boundaries; subject to the cap unless `force` is set.
   - **Force** — `read_pad({ docId, force: true })` bypasses the cap and returns the full requested region. Use for full-doc audits, rewrites, or anywhere you've explicitly accepted the cost.

   Slice vs peek: peek anchors to a known nodeId (good for "read around this hit"); slice anchors to a word-position percentile (good for "give me the back half" or "walk this doc in 10% chunks"). Use the one that matches your intent — neither is strictly better.

   When the cap kicks in, the response includes `lastNodeId` plus continuation hints for all four follow-up tools (read_pad slice, read_pad force, peek_doc, outline_doc).

   **Implication for doc structure:** monolith docs (8k+ words in one file) push you up the ladder on every read. Splitting into chapters, sections, or topic-sized docs makes everything cheaper — outline_doc shows the whole shape, browse_docs returns concept-level summaries, and individual reads come back complete. The cap is friction designed to surface monoliths as the wrong unit for AI-assisted writing in this era.

## Setup — Which Path?

Check whether the `openwriter` MCP tools are available (e.g. `read_pad`, `write_to_pad`). This determines setup state:

### MCP tools ARE available (ready to use)

The user already has OpenWriter configured. You're good to go.

**First action:** Share the browser URL:
> OpenWriter is at **http://localhost:5050** — open it in your browser to see and review changes.

**Onboarding (first use only):** Call `list_documents`. If the workspace is empty (zero documents), create a welcome doc to orient the user:

1. Read the welcome template from this skill's `docs/welcome.md`
2. `create_document` with title "Welcome to OpenWriter"
3. `populate_document` with the template content (arrives as pending changes — green highlights)
4. Tell the user: "I've created a welcome doc in your browser. Check it out — the green highlights are my changes. Use the review panel to accept or reject them."

This teaches the user the core workflow (pending changes, review panel) by experiencing it. After the first run, docs exist and this step is skipped forever.

Skip to [Writing Strategy](#writing-strategy) below.

### MCP tools are NOT available (needs setup)

The user hasn't set up the MCP server yet. See `docs/setup.md` for install commands and platform-specific config (Claude Code, OpenCode, etc.).

After setup, tell the user:
1. Restart your Claude Code or OpenCode session (MCP servers load on startup)
2. Open http://localhost:5050 in your browser

## Document Identity: Titles vs DocIds

Every document has an immutable **docId** (8-char hex, e.g. `a1b2c3d4`) in its YAML frontmatter. Titles are for human communication and agent reasoning. DocIds are for agent action.

- `list_documents` and `read_pad` always show both title and docId
- All doc-targeting tools take `docId` as their parameter (not filename, not frontmatter read from disk)
- Two documents can have the same title — the docId disambiguates
- Filenames contain UUIDs unrelated to docIds — the first segment of a filename UUID looks like a docId but is not

**MCP params:** `metadata`, `changes`, `content` are objects — never stringify them.

## MCP Tools Reference (40 core + 21 publish platform)

### Document Operations

| Tool | Key Params | Description |
|------|-----------|-------------|
| `read_pad` | `docId`, `slice?` (`{from,to}` floats in [0,1]), `force?` (boolean) | Fixed-window word-position read. **Default:** first ~2,000 words; docs at or under the cap return in full. **`slice: {from, to}`** reads a percentile range (e.g. `{from: 0.5, to: 1}` = back half, `{from: 0.25, to: 0.75}` = middle 50%, sequential `{from: 0, to: 0.1}` → `{from: 0.1, to: 0.2}` … = 10% chunks at predictable per-call cost). Snaps to top-level node boundaries, subject to the cap unless `force` is set. **`force: true`** bypasses the cap entirely — returns the full requested region (whole doc, or whole slice). Use for full-doc audits and rewrites where you've accepted the cost. Truncated responses include `lastNodeId` + continuation hints for slice / force / peek_doc / outline_doc. |
| `write_to_pad` | `docId`, `changes` | Apply edits as pending decorations (rewrite, insert, delete) |
| `populate_document` | `docId?`, `content` | Populate an empty doc with content (two-step creation flow) |
| `get_pad_status` | — | Lightweight poll: word count, pending changes, userSignaledReview |
| `get_nodes` | `nodeIds` | DEPRECATED — use `peek_doc({ nodes: [ids] })`. Alias kept for one release. |
| `outline_doc` | `docId`, `underHeading?`, `depth?`, `offset?`, `limit?` | Structural skeleton — heading tree by default (~5 tokens/heading). Drill into a section with `underHeading`. Block-preview fallback for docs without headings. The cheap orientation tool before any body read. |
| `peek_doc` | `docId`, `target` (one of: `{node}` / `{nodes}` / `{around,before,after}` / `{from,to}` / `{first}` / `{last}` / `{position,span}`) | Windowed node read once oriented. Six target shapes for different access patterns. Use this instead of `read_pad` whenever you only need part of a doc. |
| `search_docs` | `query`, `docId?`, `limit?` | Full-text search. Default: ranked docs across the workspace (snippets). With `docId`: matching nodes inside that doc (nodeId + type + snippet). The content-to-node bridge — pairs with `peek_doc` for the read. |
| `get_metadata` | — | Get frontmatter metadata for the active document |
| `set_metadata` | `metadata` | Update frontmatter metadata (merge, set key to null to remove) |

### Document Lifecycle

| Tool | Key Params | Description |
|------|-----------|-------------|
| `list_documents` | — | List all documents with title, docId, word count, active status |
| `switch_document` | `docId` | Change the user's view to a different document. **Rarely needed** — every tool targets docs by docId directly, so reads, writes, and creations never require switching. Use ONLY when you want to pull the user's attention to a specific doc (e.g. "I've loaded this up for your review"). The user may be perusing other docs — don't yank their view as part of normal work. |
| `create_document` | `content_type`, `title?`, ... | Create a new document. `content_type` is required: "document", "tweet", "reply", "quote", "article", "linkedin", "newsletter", or "blog" |
| `open_file` | `path` | Open an existing .md file from any location on disk |
| `delete_document` | `docId` | Delete a document file (moves to OS trash, recoverable) |
| `archive_document` | `docId` | Archive a document (hides from sidebar, keeps on disk) |
| `unarchive_document` | `docId` | Restore an archived document back to the sidebar |

### Import

| Tool | Description |
|------|-------------|
| `import_gdoc` | Import structured Google Doc JSON (auto-splits multi-chapter docs) |

### Workspace Management

| Tool | Description |
|------|-------------|
| `list_workspaces` | List all workspaces with title and doc count |
| `create_workspace` | Create a new workspace |
| `delete_workspace` | Delete a workspace and all its document files (moves to OS trash) |
| `get_workspace_structure` | Get the workspace tree shape: containers + their IDs, docs + their filenames, workspace-level structural fields (vocab, schema, enrichment flag), plus context (characters, settings, rules). **Tree shape only** — per-doc loglines, status, tags, and stale flag are NOT here. Use this when you need a destination container (sort, move) or to understand nesting. For "what is each doc about" call `browse_docs`. |
| `get_item_context` | Get progressive disclosure context for a doc — workspace context + the doc's own enrichment (logline, status, enrichmentStale) |
| `update_workspace_context` | Update workspace context (characters, settings, rules) |

### Workspace Organization

| Tool | Description |
|------|-------------|
| `create_container` | Create a folder inside a workspace (max depth: 3) |
| `delete_container` | Delete a container from a workspace (doc files stay on disk) |
| `tag_doc` | Add a tag to a document by docId (stored in doc frontmatter) |
| `untag_doc` | Remove a tag from a document by docId |
| `move_item` | Move or reorder a doc, container, or workspace (type: doc/container/workspace). To nest a doc into a container: `move_item({ type: 'doc', workspaceFile, itemId: <docId>, targetContainerId: <containerId>, afterId? })`. The target param is **`targetContainerId`** — passing `containerId`/`container` instead is silently ignored and the doc lands at workspace root. |
| `rename_item` | Rename a workspace, container, or document (type: workspace/container/document) |

### Enrichment (three-field schema — v0.19.0)

OpenWriter detects when a doc has drifted past enrichment thresholds (sentence-hash Jaccard drift, character-count volume ratio) on every save and stamps `enrichmentStale: true`. The agent's job is to dispatch the enrichment minion (see firm rule 5 + `docs/enrichment.md` in this skill) to refresh the logline.

**The three-field schema** — each field has exactly one owner:

| Field | Owner | Set how |
|-------|-------|---------|
| `logline` | LLM (minion) | `mark_enriched({ docs: [{ docId, logline }] })` |
| `status` (`canonical` / `draft`) | Agent | `create_document({ status })` on create; `set_metadata({ status })` on lifecycle change |
| `enrichmentStale` | System | OpenWriter sets on save; minion clears on `mark_enriched` |

**Lifecycle convention for `status`:**
- Default to `draft` on new docs (omit `status` from `create_document` and it lands as `draft`).
- Flip to `canonical` when the doc commits to the workspace spine (Beats locked, Research Note is now load-bearing, Master Reference is the source of truth).
- Flip back to `draft` when superseded (e.g. Ch 7 Beats v3 ships → demote v1/v2 to `draft`).
- The common browse pattern is `browse_docs({ status: "canonical" })` — that's the trusted-shelf query.

| Tool | Key Params | Description |
|------|-----------|-------------|
| `list_dirty_docs` | `workspaceFile?` | List docs that need enrichment (never enriched OR explicitly flagged stale). Returns identity + reason only — no bodies. Optionally scoped to one workspace. Docs in opted-out workspaces (`enrichmentDisabled: true`) are excluded. |
| `mark_enriched` | `docs: [{docId, logline}]` | Stamp one or more docs as freshly enriched. **Strict schema** — passing `domain` / `concepts` / `docRole` / `status` fails validation. OpenWriter auto-computes baselines (`lastEnrichedAt`, `lastEnrichedCharCount`, `lastEnrichedSentences`), clears `enrichmentStale`, and retires legacy fields from frontmatter. The minion calls this once at the end of its run with the full batch. |
| `browse_docs` | `workspaceFile?`, `tags?`, `status?` (`canonical`/`draft`), `hasLogline?` | Bulk-read concept-level frontmatter per doc with AND-composed filters. The agent's "scan the shelf" primitive — ~60 tokens per doc, no bodies, no tree shape. Pairs with `get_workspace_structure` (tree shape), `outline_doc` (skeleton), `peek_doc` (windowed read), and `read_pad` (full body) as the read ladder. Renamed from `crawl` / `browse` — both kept as DEPRECATED aliases for one release. |

### Sort Requests

User-triggered file-this-for-me marker. See firm rule 6 for the full procedure. The agent picks up pending sorts via the surfacing footer / SORT_STATUS notice and handles them inline.

| Tool | Key Params | Description |
|------|-----------|-------------|
| `list_pending_sorts` | `workspaceFile?` | List docs the user has marked for sorting. Returns identity + current location + optional `proposal` (already written by a prior pass). |
| `propose_sort` | `proposals: [{docId, wsFilename, containerId, reasoning}]` | Write a proposal back to one or more docs (batch flow). The sidebar flips each doc's badge to "proposal ready"; the user accepts or rejects via the in-menu popover (server applies the move on accept). |
| `mark_sorted` | `docs: [{docId}]` | Clear the sortRequest marker after a chat-flow move (`move_item` first) or after deciding the doc should stay where it is. Bulk-friendly. |

### Comments

| Tool | Key Params | Description |
|------|-----------|-------------|
| `get_comments` | `docId?`, `scope?` | Get comments left by the user. Default scope is `workspace` when a docId is given (returns comments for every doc in the same project); pass `scope: "document"` to narrow, or `scope: "all"` for every doc on disk |
| `resolve_comments` | `comment_ids` | Remove comments after addressing feedback (pass comment IDs) |

The older names `get_agent_marks` and `resolve_agent_marks` remain as deprecated aliases.

### Task Management

| Tool | Key Params | Description |
|------|-----------|-------------|
| `list_tasks` | — | List all tasks for the current profile |
| `add_task` | `text` | Add a new task to the checklist |
| `update_task` | `id`, `text?`, `completed?` | Update a task (text or completion status) |
| `remove_task` | `id` | Remove a task from the checklist |

Call `list_tasks` at session start to check for pending work from previous sessions.

### Text Operations

| Tool | Key Params | Description |
|------|-----------|-------------|
| `edit_text` | `docId`, `nodeId`, `edits` | Fine-grained text edits within a node (find/replace, add/remove marks). **`edits` must be a JSON array, not a string.** Example: `edits: [{ find: "old text", replace: "new text" }]` |

### Image Generation

| Tool | Description |
|------|-------------|
| `insert_image` | Generate image via Gemini. Three modes: (1) `docId` + `afterNodeId` → inline insert with pending decoration. (2) `set_cover: true` → set as article cover. (3) Neither → generate to disk only. Requires GEMINI_API_KEY. |

### Version Management

| Tool | Description |
|------|-------------|
| `list_versions` | List version history for the active document (timestamps, word counts, sizes) |
| `create_checkpoint` | Force a version snapshot right now — use before risky operations |
| `restore_version` | Restore to a previous version by timestamp (auto-creates safety checkpoint first) |
| `reload_from_disk` | Re-read the active document from its file on disk (for external modifications) |

## Writing Strategy

OpenWriter has two distinct modes: **editing** existing documents and **creating** new content. Use the right approach for each.

### Editing (write_to_pad)

For making changes to existing documents — rewrites, insertions, deletions:

- Use `write_to_pad` for all edits — **`docId` is required** (8-char hex from `list_documents` or `read_pad`)
- Send **3-8 changes per call** for a responsive, streaming feel
- Get fresh node IDs before editing. Three patterns by edit scope:
  - **Short doc broad edit** (≤ ~2,000 words): `read_pad({ docId })` returns the full body with all node IDs in one call.
  - **Long doc broad edit**: either `read_pad({ docId, force: true })` for the whole body in one shot (cost acknowledged), or `read_pad({ docId, slice: {from, to} })` walking 10% chunks if the edit spans the whole doc but you want predictable per-call cost.
  - **Surgical edit** (you already know the anchor from `outline_doc` / `search_docs` / deep-link click): `peek_doc({ around: anchor })` returns just the relevant region's current IDs — much cheaper than any read_pad form for targeted work.
- Respect `pendingChanges > 0` — wait for the user to accept/reject before sending more
- Content accepts markdown strings (preferred) or TipTap JSON
- **`rewrite` preserves the target node's type.** Sending plain prose to rewrite a heading keeps it a heading; the same for list items and blockquotes. To intentionally change a node's type, use `delete` + `insert`. For surgical text-only edits inside a node (no risk of restructuring), `edit_text` is the smaller hammer.
- Decoration colors: **blue** = rewrite, **green** = insert, **red** = delete
- **Never re-populate a document to fix it.** `populate_document` re-sends the entire document body — extremely token-expensive. To remove nodes, use `write_to_pad` with `{ operation: "delete", nodeId: "..." }`. To fix content, use `rewrite`. Only use `populate_document` once during initial creation, or as a last resort if the document is severely broken.

### Auto-accept mode (no pending review)

The user can turn on **auto-accept** on a per-doc basis (right-click the doc in the sidebar). When on, your edits commit directly — no pending decorations, no review panel for that doc. Used during fast drafting where the user isn't reviewing as you go.

- `get_pad_status` returns `autoAccept: true` when the active doc has it on. Use this to decide your cadence.
- **When autoAccept is true:** keep writing without polling for review. Don't wait between batches. Send the next 3-8 changes the moment you're ready.
- **When autoAccept is false (default):** respect `pendingChanges > 0` — wait for the user to accept/reject before sending more.
- You don't toggle this flag yourself — only the user does, from the sidebar. If you think the user wants it, ask first.
- The flag is persisted in the doc's frontmatter as `autoAccept: true`. Visible in `get_metadata`.

### Creating New Documents (two-step flow)

**Always use the two-step flow** when creating new content:

```
1. create_document({ title: "My Doc", content_type: "document" })  ← fires instantly, shows spinner
2. populate_document({ content: "..." })                           ← delivers content, clears spinner
```

**Why two steps?** MCP tool calls are atomic — the server doesn't receive the call until ALL parameters are fully generated. For a document with hundreds or thousands of words, the user would wait 30+ seconds with zero feedback while you generate content tokens. The two-step flow shows a sidebar spinner immediately (step 1 has no content to generate), then the spinner persists while you generate and deliver the content (step 2).

**Rules:**
- `create_document` does NOT accept a `content` parameter — it always creates an empty doc
- Step 1 (`create_document`) — shows spinner, creates empty doc, does NOT switch the editor
- Step 2 (`populate_document`) — pass the `docId` from step 1 to write content directly to that doc, marks as pending decorations, clears the spinner. Does NOT switch the user's view — they keep working wherever they are.
- Never use `write_to_pad` for the initial population — use `populate_document` exclusively

### Workspace-Integrated Creation

`create_document` takes placement in **either** convention (unified 2026-07-09):

```
create_document({
  title: "Opening Chapter",
  content_type: "document",          ← REQUIRED: "document" for plain, or "tweet"/"article"/etc.
  workspace: "The Immortal",        ← name-based: creates workspace if it doesn't exist
  container: "Chapters"             ← name-based: creates container if it doesn't exist
})
```

**Name-based (auto-create):**
- **`workspace`** (string) — workspace title to add the doc to. Auto-creates if not found (case-insensitive match).
- **`container`** (string) — container name within the workspace (e.g. "Chapters", "Notes", "References"). Auto-creates if not found. Requires `workspace`.

**Id-based (target existing items — the same ids `move_item`/`get_workspace_structure` use):**
- **`workspaceFile`** (string) — existing workspace manifest filename (`*.json`). Must already exist. Alternative to `workspace`.
- **`containerId`** (string) — existing container id (8-char hex). Must already exist in the resolved workspace. Alternative to `container`. Requires a workspace param.

**Both conventions:**
- **`afterId`** (string, optional) — docId (8-char hex) or containerId to place the new doc immediately after. Omit and the doc lands at the **bottom** of its parent (the default since 0.18.0, matching the ascending-order convention: oldest at top, newest at bottom). `afterId` alone does NOT set a workspace — pass a workspace param too.
- Omit all placement params for a standalone doc — the result then says **UNFILED** (a doc created in no workspace announces it, rather than reading as a bland success).
- A placement that can't be honored (unknown `workspaceFile`/`containerId`, or a container with no workspace) is a **hard error** — the doc is never silently created unplaced. The result always states where it landed.

This eliminates the need for separate `create_workspace`, `create_container`, and `move_item` calls when building up a workspace. The default-bottom landing also eliminates the need for a follow-up `move_item` pass to fix sidebar order after every create — the doc lands in convention position the first time.

`create_container` accepts the same `afterId` parameter with identical semantics — new containers default to the bottom of their parent and can be precisely placed via `afterId`. The Drafts sub-container that goes under every chapter container, for example, can be created with `afterId` set to the chapter's Research Notes docId so it lands at the very bottom in one call.

### Batched Creation (multiple docs at once)

**Variants** — when repurposing a doc into another format (a thread off a blog post, a LinkedIn cut of a newsletter), pass `create_document({ masterDocId, variantType })` so the new doc nests under its master in the sidebar instead of floating off as a disconnected doc. Users do the same via right-click → "Create variant".

When creating **two or more documents together** — a tweet thread saved as separate docs, a series of blog drafts, newsletter variants, a workspace populated with several files — use `declare_writes` instead of looping `create_document`. It's one tool call, registers all sidebar spinners atomically, and survives app refreshes.

```
1. declare_writes({
     writes: [
       { title: "Post 1", content_type: "tweet" },
       { title: "Post 2", content_type: "tweet" },
       { title: "Post 3", content_type: "tweet" },
     ]
   })
   → returns [{ docId, filename, title }, ...]

2. populate_document({ docId: "...", content: "..." })  ← one call per doc, parallel is fine
```

**Rules:**
- Each write in the batch gets its own sidebar spinner keyed to its filename — a spinner only clears when you `populate_document` that specific `docId`
- Spinners persist across app refreshes (server-side registry)
- Same per-write fields as `create_document`: `title`, `content_type`, optional `workspace`/`container`/`url`/`path`/`afterId`
- `reply` / `quote` types still require `url`
- For a **single** document, use `create_document` — don't reach for `declare_writes` just to wrap one entry

### Citations & footnotes

Long-form writing (especially academic-adjacent nonfiction) uses CommonMark / Pandoc footnote syntax:

- **Reference** (inline in prose): `text[^1]` — renders as a superscript chip
- **Definition** (anywhere in the markdown body): `[^1]: footnote text` — automatically corralled into a "Footnotes" section at end-of-doc on save
- **Mnemonic labels** allowed: `[^sapolsky2017]` survives round-trip on disk; the editor shows auto-sequential display numbers regardless

Just include the syntax in `populate_document` content or `write_to_pad` content — no special tool needed. The parser handles the tokenization, the editor handles the rendering, the serializer enforces the constrained end-of-doc shape.

**Scope is per-doc.** Each chapter has its own `[^1]` … `[^N]` numbering; cross-doc references aren't supported at the editor level. Full guide → `docs/footnotes.md`.

## Companion Skills (optional)

All companion skills install from the same openwriter GitHub repo unless noted:

```bash
# X/Twitter content — writing format, image gen, full pipeline
npx skills add https://github.com/travsteward/openwriter --skill x-writer

# Book-scale long-form — chapter architecture, beats, workspace management
npx skills add https://github.com/travsteward/openwriter --skill book-writer

# Channel-agnostic drafting — beats-first uncommitted drafts
npx skills add https://github.com/travsteward/openwriter --skill beat-writer

# Long-form blog posts — beats, titling, voice anchor, publish via github plugin
npx skills add https://github.com/travsteward/openwriter --skill blog-writer

# Weekly email newsletter pipeline
npx skills add https://github.com/travsteward/openwriter --skill newsletter-writer

# Copy polish to 90/100 + AI-fingerprint scrub
npx skills add https://github.com/travsteward/openwriter --skill polish
npx skills add https://github.com/travsteward/openwriter --skill anti-ai
```

Author's Voice (voice matching, minion dispatch — required by the writers above) now ships INSIDE the authors-voice plugin: enabling the plugin delivers both the MCP tools and the skill at `plugins/authors-voice/skill/SKILL.md`. Standalone install also works: `claude install github:travsteward/authors-voice`.

For an AI-detection pass without full authors-voice setup, the bundled **anti-ai** skill stands alone.

## Workflow

### Research (read-only, no edits coming)

When the user asks "find X in this doc", "what does Y argue", "show me the beat about Z" — read-only intent. Use the ladder, not a default `read_pad`.

```
1. search_docs({ query: "X" })                 → ranked docs across workspace
                                                  OR
   browse_docs({ status: "canonical" })        → shelf-level scan of one workspace
2. outline_doc({ docId })                      → heading skeleton (~5 tokens/heading)
                                                  Use underHeading to drill into one section.
3. search_docs({ query: "X", docId })          → in-doc node hits with nodeIds
                                                  OR pick a heading nodeId from step 2.
4. Read the region — pick by how wide:
   - peek_doc({ docId, target: { around: nodeId, before, after } })
                                                → node-anchored window (small, surgical)
   - read_pad({ docId, slice: { from: 0.4, to: 0.6 } })
                                                → percentile-anchored region (wider, contiguous)
   - read_pad({ docId, force: true })           → whole body (you've accepted the cost)
```

**Pattern:** `search_docs` returns hits with node IDs *and* approximate doc positions. When the user wants the matched paragraph + a sentence either side, `peek_doc` around the node is right. When they want "the section that hit lives in" or "the back half of the doc that contains the hit" or "a contiguous region wider than peek's 100-node window," `read_pad` with a slice is the better call.

Cost on an 8,000-word chapter doc: ~1.5k tokens via the ladder (search + peek), ~3k tokens via search + read_pad slice for a 25% region, ~10k tokens for the full body via `read_pad force`. Match the read to the question.

### Single document (editing)

```
1. get_pad_status  → check pendingChanges and userSignaledReview
2. Orient on the doc — pick by edit shape:
   - Short doc (≤ ~2,000 words): read_pad({ docId }) returns the full body
   - Long doc, surgical edit (you know roughly what you're touching):
     search_docs({ query, docId }) → peek_doc({ around: hitNodeId, before, after })
     — fresh IDs for just the region you'll edit, ~500 tokens
   - Long doc, broad edit on one section:
     outline_doc({ docId }) → read_pad({ docId, slice: { from, to } })
     where {from, to} bounds the section's percentile range
   - Long doc, whole-body rewrite:
     read_pad({ docId, force: true }) — explicit, cost acknowledged
3. get_metadata    → check tweetContext/articleContext for URLs, mode, tags
4. write_to_pad({ docId: "a1b2c3d4", changes: [...] })
5. Wait            → user accepts/rejects in browser
```

`read_pad` always returns the doc opening up to ~2,000 words unless you pass `slice` or `force`. Never assume you got the whole body from a default `read_pad` — the truncation response tells you what's missing and gives you the exact slice/force/peek/outline calls to continue.

**For tweet/article docs:** step 3 gives you the parent tweet URL (in `tweetContext.url`) and mode (`reply`/`quote`/`tweet`). Use this URL with fxtwitter to read the parent tweet for free — never search externally for it.

### Multi-document

```
1. list_documents               → see all docs with title + [docId] + wordCount
2. For each target doc, orient by wordCount:
   - ≤ ~2,000 words: read_pad({ docId }) — full body in one call
   - Long doc, targeted: search_docs({ query, docId }) → peek_doc({ around: hit })
   - Long doc, sectional: outline_doc({ docId }) → read_pad({ docId, slice })
   - Long doc, full pass: read_pad({ docId, force: true })
3. write_to_pad({ docId, changes: [...] })  → edits go to the identified doc
```

The wordCount on `list_documents` tells you up-front which docs return in full from a default `read_pad` and which will truncate — use it to plan the read shape per doc. A 500-word doc is one round trip; an 8,000-word doc is search + peek for surgical work, outline + slice for sectional work, or force for the rare whole-body case.

### Reading patterns at a glance

| Intent | Best tool |
|--------|-----------|
| "What's in this doc?" | `outline_doc({ docId })` |
| "Find X in this doc" | `search_docs({ query, docId })` → `peek_doc({ around: hit })` |
| "Read around this node I already know" | `peek_doc({ around: anchor })` |
| "Read this specific region of the doc" | `read_pad({ docId, slice: { from, to } })` |
| "Walk the whole doc in predictable chunks" | `read_pad({ docId, slice })` × N sequential calls |
| "Give me everything" | `read_pad({ docId, force: true })` |
| "What's in this doc and what's it about" | `outline_doc` + frontmatter via `get_metadata` |
| "Which docs in the workspace talk about X" | `search_docs({ query })` (no docId) |
| "Scan the shelf — concept-level only" | `browse_docs({ workspaceFile })` |

### Creating new content (two-step)

```
1. create_document({ title: "My Doc", content_type: "document", workspace: "Project", container: "Chapters" })
                                                → returns docId "a1b2c3d4", spinner appears
2. populate_document({ docId: "a1b2c3d4", content: "# ..." })
                                                → content delivered, spinner clears
3. read_pad                                     → get node IDs + docId if further edits needed
4. write_to_pad({ docId: "a1b2c3d4", ... })    → refine with edits
```

### Building a workspace (multiple docs)

```
1. create_document({ title: "Ch 1", content_type: "document", workspace: "My Book", container: "Chapters" })
                                                → returns docId "ch1docid"
2. populate_document({ docId: "ch1docid", content: "..." })
3. create_document({ title: "Ch 2", content_type: "document", workspace: "My Book", container: "Chapters" })
                                                → returns docId "ch2docid"
4. populate_document({ docId: "ch2docid", content: "..." })
5. create_document({ title: "Character Bible", content_type: "document", workspace: "My Book", container: "References" })
6. populate_document({ docId: "<from step 5>", content: "..." })
7. tag_doc + update_workspace_context           → organize and add context
```

The workspace and containers are auto-created on the first `create_document` call. Subsequent calls reuse the existing workspace/containers (matched case-insensitively).

### Comments (inline feedback)

Users can select text in the browser, right-click, and leave a comment — a note attached to a specific text range. Comments appear as dotted underlines in the editor. This is the user's way of marking up a document with feedback for you to address.

```
1. User says "check my comments" (or you see the hint in read_pad output)
2. get_comments({ docId })       → comments for the current workspace by default
3. Address each comment          → rewrite, insert, delete via write_to_pad (use docId)
4. resolve_comments([ids])       → clears decorations in browser
```

- `read_pad` automatically shows comment counts: this doc + other docs
- Default scope is `workspace` when a docId is provided — you see comments across every doc in the user's current project, not just the one they're viewing
- Pass `scope: "document"` to narrow to one doc, `scope: "all"` to span everything on disk
- Always resolve comments after addressing them — `resolve_comments` is a state change ("addressed, archive it"), not a destructive delete. The record stays in storage; only the decoration disappears. `get_comments` skips resolved ones by default
- A comment with an empty note means "fix this" — use your judgment
- A comment with a note is specific feedback — follow the instruction

### Book workspace guidelines

When importing or organizing book-length projects, read the source material first and **follow the grain** — break content into the categories the author is already thinking in, don't impose a template.

- **One concept per doc.** Don't create one giant reference doc. If the material covers characters, setting, plot, and themes, those are separate documents.
- **Preserve originals.** Keep raw drafts separate from revised versions (e.g. Drafts vs. Chapters containers). The author needs both.
- **Synthesize, don't just copy.** Reorganize messy notes into clean, scannable docs (headers, bullets, sections) while keeping the author's voice and prose verbatim.
- **Surface open threads.** Unanswered questions, brainstorm lists, and loose ideas get their own doc — don't bury them inside reference material.

## X Content (Tweets, Threads, Articles)

For composing X content in OpenWriter — `tweetContext` and `articleContext` metadata, `content_type` (`tweet` / `reply` / `quote` / `article`), thread HR rules, image handling, paragraph spacing, parent-tweet workflow — see the `/x-writer` skill.

## Review Etiquette

1. **Share the URL.** Always tell the user: http://localhost:5050
2. **Read before writing.** Always fetch the document before suggesting changes
3. **Don't overwhelm.** 1-3 changes at a time for reviews, 3-8 for drafting
4. **Explain your edits.** Tell the user what you changed and why
5. **Respect pending changes.** If `pendingChanges > 0`, wait for the user
6. **Watch for the review signal.** When `userSignaledReview` is true, the user is asking for your input — reading status clears it (one-shot)

## Publish Platform (21 tools)

Requires authentication via `request_login_code` + `verify_login`. All publish tools are provided by the `@openwriter/plugin-publish` plugin.

### Authentication

| Tool | Description |
|------|-------------|
| `request_login_code` | Send a 6-digit login code to an email address (signup or key recovery) |
| `verify_login` | Verify the code → API key issued + auto-saved to plugin config |

```
1. request_login_code({ email: "user@example.com" })   → 6-digit code sent to email
2. User reads code from inbox (or agent reads via gmail skill)
3. verify_login({ email: "user@example.com", code: "123456" })
   → API key issued + auto-saved to plugin config
```

- **Agents with email access** (e.g. gmail skill) can fully automate this — zero user involvement
- **Key recovery:** Same flow. Old keys are automatically revoked when a new one is issued
- Codes expire in 10 minutes, max 3 attempts per code, rate-limited to 1 request per 60 seconds

### Custom Domains

| Tool | Description |
|------|-------------|
| `setup_custom_domain` | Configure a custom domain + from_email for newsletter sending |
| `check_domain_status` | Check DNS and sender verification status |
| `resend_domain_verification` | Re-send the SendGrid sender verification email |

**Setup flow:**
1. Call `setup_custom_domain` with domain + from_email
2. Cloudflare domains: DNS auto-added. Non-CF: show DNS records for manual setup
3. User checks email for SendGrid sender verification
4. Wait ~30-60s, call `check_domain_status` to confirm
5. Both `dns_verified` + `sender_verified` = domain ready

### Social Posting & Connections

| Tool | Description |
|------|-------------|
| `list_connections` | List connected social accounts (X, LinkedIn, etc.) |
| `post_to_x` | Post current document to X/Twitter |
| `post_to_linkedin` | Post current document to LinkedIn |

### Scheduling

| Tool | Description |
|------|-------------|
| `schedule_post` | Schedule a post for a specific time |
| `list_schedule` | List all scheduled posts |
| `manage_schedule` | Update or cancel a scheduled post |
| `list_slots` | List recurring time slots |
| `create_slot` | Create a recurring posting slot |
| `edit_slot` | Modify an existing slot |
| `delete_slot` | Remove a recurring slot |

**Timezones:** `scheduled_at` is UTC. Convert local times using IANA names (e.g. `America/Los_Angeles`), never fixed offsets — DST shifts automatically.

### Newsletter

| Tool | Key Params | Description |
|------|-----------|-------------|
| `send_newsletter` | `subject?`, `format?`, `test_email?`, `subscriber_ids?`, `exclude_issue_id?` | Send current document as newsletter to all subscribers, a subset, or a test address |
| `list_subscribers` | `limit?`, `offset?` | List newsletter subscribers with IDs, emails, names |
| `add_subscriber` | `email`, `name?` | Add a single subscriber |
| `import_subscribers` | `file?`, `csv_text?` | Bulk import from CSV (auto-detects ConvertKit, Mailchimp, Substack, Beehiiv formats) |
| `list_newsletter_issues` | `limit?` | List past sends with open/click stats — returns issue IDs |
| `get_newsletter_analytics` | `issue_id` | Detailed drill-down: delivery stats, per-subscriber events, recipient list |
| `get_subscribe_embed` | *(none)* | Get public subscribe URL + HTML/JS embed snippets for signup forms on external sites |

**Subscriber selection** — `send_newsletter` supports targeting:
- **All subscribers** (default) — omit both params
- **Specific subscribers** — pass `subscriber_ids: ["id1", "id2"]` (use `list_subscribers` for IDs)
- **Send to remaining** — pass `exclude_issue_id: "..."` to send to everyone who did NOT receive that issue (use `list_newsletter_issues` for issue IDs)

**Analytics workflow:**
```
1. list_newsletter_issues()                    → see past sends with open/click counts
2. get_newsletter_analytics({ issue_id })      → drill into a specific send
   → returns: stats (delivered, opens, clicks, bounces), per-subscriber events, recipient list
```

## Author's Voice Plugin

The plugin ships with the Author's Voice skill built in (`plugins/authors-voice/skill/SKILL.md`) — enabling the plugin in Settings delivers both the MCP tools and the agent instructions. No separate install needed; see [authors-voice.com](https://www.authors-voice.com) for the standalone copy and docs.

## Updating

```bash
npm install -g openwriter@latest
npx openwriter setup
```

Then restart your Claude Code session (`/mcp` to reconnect).

## Troubleshooting

**MCP tools not available** — The OpenWriter MCP server isn't configured yet. Follow the [setup instructions](#mcp-tools-are-not-available-skill-first-install) above. After adding the MCP config, the user must restart their Claude Code session.

**Browser dies mid-session** — The MCP stdio pipe can break during context compaction or session resets. The HTTP server survives (crash guards), but MCP tools stop working. Reconnect by [restarting the MCP server](#restarting-the-mcp-server) (see below). The new process enters client mode and proxies MCP calls to the surviving HTTP server. The browser will auto-reconnect.

### Restarting the MCP server

Both Claude Code and Claude Desktop work the same way: there's no explicit restart button. Call `list_documents` (zero params, read-only, fast). If the previous process is dead, Claude auto-spawns a fresh one to satisfy the call. After code changes, kill the old process first (`taskkill /F /PID <pid>` on Windows, `kill <pid>` on macOS/Linux) so the spawn picks up the new build. Only fall back to `/mcp` (Claude Code) if tool calls keep returning `Connection error: fetch failed`.

**Port 5050 busy** — Another OpenWriter instance owns the port. New sessions auto-enter client mode (proxying via HTTP) — tools still work. No action needed.

**Edits don't appear** — Stale node IDs. Always `read_pad` before `write_to_pad` to get fresh IDs.

**"pendingChanges" never clears** — User needs to accept/reject changes in the browser at http://localhost:5050.

**Server not starting** — Ensure `openwriter` works from your terminal (`npm install -g openwriter` first). If on Windows and the global command isn't found, the MCP config may need `"command": "cmd"` with `"args": ["/c", "openwriter", "--no-open"]`.

**After code changes** — Run `npm run build` in `packages/openwriter`, kill the running openwriter process, then [restart the MCP server](#restarting-the-mcp-server). `/mcp` alone only reconnects to the existing process; it won't pick up new code unless the old process dies first.

**Slow to load / loads last** — MCP servers load sequentially in config order. Move `openwriter` to the first position in `mcpServers` in `~/.claude.json`. See setup instructions above.
