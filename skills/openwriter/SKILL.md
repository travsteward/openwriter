---
name: openwriter
description: |
  OpenWriter — the writing surface for AI agents. A markdown-native rich text
  editor where agents write via MCP tools and users accept or reject changes
  in-browser. 24 tools for document editing, multi-doc workspaces, and
  organization. Plain .md files on disk — no database, no lock-in.

  Use when user says: "open writer", "openwriter", "write in openwriter",
  "edit my document", "review my writing", "check the pad", "write me a doc".

  Requires: OpenWriter MCP server configured. Browser UI at localhost:5050.
metadata:
  author: travsteward
  version: "0.2.0"
  repository: https://github.com/travsteward/openwriter
license: MIT
---

# OpenWriter Skill

You are a writing collaborator. You read documents and make edits **exclusively via MCP tools**. Edits appear as pending decorations (colored highlights) in the user's browser that they accept or reject.

## Setup — Which Path?

Check whether the `openwriter` MCP tools are available (e.g. `read_pad`, `write_to_pad`). This determines setup state:

### MCP tools ARE available (ready to use)

The user already has OpenWriter configured — either they ran `npx openwriter install-skill` (which installed this skill) and added the MCP server, or they set it up manually. You're good to go.

**First action:** Share the browser URL:
> OpenWriter is at **http://localhost:5050** — open it in your browser to see and review changes.

Skip to [Writing Strategy](#writing-strategy) below.

### MCP tools are NOT available (skill-first install)

The user installed this skill from a directory but hasn't set up the MCP server yet. OpenWriter needs an MCP server to provide the 24 editing tools.

**Step 1:** Tell the user to install the npm package and MCP server:

```bash
# Add the OpenWriter MCP server to Claude Code
claude mcp add -s user openwriter -- npx openwriter --no-open
```

Then restart the Claude Code session. The MCP tools become available on next launch.

**Step 2 (if the user can't run the command above):** Edit `~/.claude.json` directly. Add to the `mcpServers` object:

```json
"openwriter": {
  "command": "npx",
  "args": ["openwriter", "--no-open"]
}
```

The `mcpServers` key is at the top level of `~/.claude.json`. If it doesn't exist, create it:

```json
{
  "mcpServers": {
    "openwriter": {
      "command": "npx",
      "args": ["openwriter", "--no-open"]
    }
  }
}
```

After editing, tell the user:
1. Restart your Claude Code session (MCP servers load on startup)
2. Open http://localhost:5050 in your browser

**Note:** You cannot run `claude mcp add` from inside a session (nested session error). That's why we edit the JSON directly when configuring from within Claude Code.

## MCP Tools Reference (24 tools)

### Document Operations

| Tool | Description |
|------|-------------|
| `read_pad` | Read the current document (compact tagged-line format) |
| `write_to_pad` | Apply edits as pending decorations (rewrite, insert, delete) |
| `get_pad_status` | Lightweight poll: word count, pending changes, userSignaledReview |
| `get_nodes` | Fetch specific nodes by ID |
| `get_metadata` | Get frontmatter metadata for the active document |
| `set_metadata` | Update frontmatter metadata (merge, set key to null to remove) |

### Document Lifecycle

| Tool | Description |
|------|-------------|
| `list_documents` | List all documents with filename, word count, active status |
| `switch_document` | Switch to a different document by filename |
| `create_document` | Create a new document (optional title, content, path) |
| `open_file` | Open an existing .md file from any location on disk |

### Import

| Tool | Description |
|------|-------------|
| `replace_document` | Import external content into a new/blank document |
| `import_gdoc` | Import a Google Doc (auto-splits multi-chapter docs) |

### Workspace Management

| Tool | Description |
|------|-------------|
| `list_workspaces` | List all workspaces with title and doc count |
| `create_workspace` | Create a new workspace |
| `get_workspace_structure` | Get full workspace tree: containers, docs, tags, context |
| `get_item_context` | Get progressive disclosure context for a doc in a workspace |
| `update_workspace_context` | Update workspace context (characters, settings, rules) |

### Workspace Organization

| Tool | Description |
|------|-------------|
| `add_doc` | Add a document to a workspace (optional container placement) |
| `create_container` | Create a folder inside a workspace (max depth: 3) |
| `tag_doc` | Add a tag to a document in a workspace |
| `untag_doc` | Remove a tag from a document |
| `move_doc` | Move a document to a different container or root level |

### Text Operations

| Tool | Description |
|------|-------------|
| `edit_text` | Fine-grained text edits within a node (find/replace, add/remove marks) |

## Writing Strategy

**Incremental edits, not monolithic replacement.**

- Use `write_to_pad` for all edits — never `replace_document` (unless importing into a blank doc)
- Send **3-8 changes per call** for a responsive, streaming feel
- Always `read_pad` before writing — you need fresh node IDs
- Respect `pendingChanges > 0` — wait for the user to accept/reject before sending more
- Content accepts markdown strings (preferred) or TipTap JSON
- Decoration colors: **blue** = rewrite, **green** = insert, **red** = delete

## Workflow

### Single document

```
1. get_pad_status  → check pendingChanges and userSignaledReview
2. read_pad        → get full document with node IDs
3. write_to_pad    → send changes (3-8 per call)
4. Wait            → user accepts/rejects in browser
```

### Multi-document

```
1. list_documents    → see all docs, find target
2. switch_document   → save current, load target (returns content)
3. read_pad          → read full content with node IDs
4. write_to_pad      → apply edits
```

### Creating new content

```
1. create_document({ title: "My Doc", content: "# Heading\n\nContent..." })
2. read_pad          → get node IDs from created content
3. write_to_pad      → refine with edits
```

## Review Etiquette

1. **Share the URL.** Always tell the user: http://localhost:5050
2. **Read before writing.** Always fetch the document before suggesting changes
3. **Don't overwhelm.** 1-3 changes at a time for reviews, 3-8 for drafting
4. **Explain your edits.** Tell the user what you changed and why
5. **Respect pending changes.** If `pendingChanges > 0`, wait for the user
6. **Watch for the review signal.** When `userSignaledReview` is true, the user is asking for your input — reading status clears it (one-shot)

## Troubleshooting

**MCP tools not available** — The OpenWriter MCP server isn't configured yet. Follow the [setup instructions](#mcp-tools-are-not-available-skill-first-install) above. After adding the MCP config, the user must restart their Claude Code session.

**Port 5050 busy** — Another OpenWriter instance owns the port. New sessions auto-enter client mode (proxying via HTTP) — tools still work. No action needed.

**Edits don't appear** — Stale node IDs. Always `read_pad` before `write_to_pad` to get fresh IDs.

**"pendingChanges" never clears** — User needs to accept/reject changes in the browser at http://localhost:5050.

**Server not starting** — Ensure `npx openwriter` works from your terminal. If on Windows and using `npx`, the MCP config may need `"command": "cmd"` with `"args": ["/c", "npx", "openwriter", "--no-open"]`.
