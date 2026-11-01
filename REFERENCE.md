# OpenWriter Reference

Deep reference for OpenWriter. The [README](README.md) is the 30-second introduction and quick start; this document holds the full surface: the MCP tool catalog, the review model, workspaces, the wire format, the plugin API, CLI options, and architecture.

---

## Agent Collaboration via MCP

24 tools across four categories:

| Category | Tools | What They Do |
|----------|-------|-------------|
| **Document** | `read_pad`, `write_to_pad`, `edit_text`, `get_pad_status`, + 5 more | Read/write document content, fine-grained text edits, metadata |
| **Multi-doc** | `list_documents`, `switch_document`, `create_document` | Navigate and manage multiple documents |
| **Workspace** | `create_workspace`, `get_workspace_structure`, `add_doc`, + 6 more | Organize docs into projects with containers and tags |
| **Import** | `import_gdoc` | Import structured Google Docs, auto-split into chapters |

Agents write in markdown or TipTap JSON. The server converts, assigns node IDs, and broadcasts changes to your browser in real-time via WebSocket.

### Connect your agent

An agent needs only OpenWriter's MCP server. There is no skill to install: the tool descriptions, the server's instructions and the guidance that arrives with each document tell the agent how to use OpenWriter as it works.

**Claude Code** — one command installs OpenWriter globally, registers the MCP server, and adds three background subagents (sorting, enrichment and the ghostwriter) to `~/.claude/agents/`:
```bash
npx openwriter setup
```

By hand:
```bash
npm install -g openwriter
claude mcp add -s user openwriter -- openwriter --no-open
```

If `claude mcp add` can't run, add `openwriter` as the first entry under `mcpServers` in `~/.claude.json` (servers load in order):

```json
{
  "mcpServers": {
    "openwriter": {
      "command": "openwriter",
      "args": ["--no-open"]
    }
  }
}
```

On Windows, if the global `openwriter` command isn't found, use `"command": "cmd"` with `"args": ["/c", "openwriter", "--no-open"]`.

**Codex** — register the same stdio server (check `codex mcp add --help` for your version):
```bash
npm install -g openwriter
codex mcp add openwriter -- openwriter --no-open
```

Start a fresh Codex task so the tools load. Codex has no subagents, so it files sort requests and refreshes summaries inline; the server's notices say how.

**OpenCode** — add to `opencode.json` at the project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "openwriter": {
      "type": "local",
      "command": ["openwriter", "--no-open"],
      "enabled": true
    }
  }
}
```

**Other MCP agents** (Cursor, etc.) — add to your MCP config the same `mcpServers` entry shown for Claude Code above.

After connecting, restart the agent (MCP servers load when a session starts) and open [localhost:5050](http://localhost:5050) to review its changes. A second agent session reuses the editor already running on port 5050.

---

## Pending Change Review

The core interaction model. When an agent (or the context menu) makes changes:

- **Inserts** appear highlighted in green
- **Rewrites** appear highlighted in blue (original content preserved for reject)
- **Deletions** appear with red strikethrough

Review Panel (floating bottom bar):

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous change |
| `h` / `l` | Previous / next document with changes |
| `a` | Accept current change |
| `r` | Reject current change |
| `Shift+A` | Accept all in document |
| `Shift+R` | Reject all in document |

---

## Multi-Document Workspaces

Documents are markdown files on disk. Organize them into workspaces with nested containers, cross-cutting tags, and shared context (characters, settings, rules) that agents can read for consistency.

Four sidebar views:
- **Tree** — Hierarchical folders with drag-and-drop
- **Timeline** — Sorted by last modified
- **Board** — Card-based drill-down navigation
- **Shelf** — Visual bookshelf metaphor with spine browsing

---

## Context Menu (Right-Click)

Select text and right-click for AI-powered transformations:

| Action | Shown on | Description |
|--------|----------|-------------|
| Enhance | Selection | Rewrite the selection in your voice at about the same length |
| Modify... | Selection | Rewrite it following your instruction |
| Shrink | Selection | Make it shorter |
| Expand | Selection | Make it longer |
| Insert | Empty line | Write new content from your instruction |
| Fill paragraph | Empty line | Write a paragraph that fits between the text around it |
| Fill sentence | Empty line | Write one sentence that fits there |
| Comment | Selection | Leave a comment on it |
| Delete | Selection | Mark it for deletion |
| Link to doc | Selection | Link it to another document |

The writing actions run on your own Claude API key (Settings > Claude), or, signed in to OpenWriter without a key, on your OpenWriter balance. They write in your voice, learned from the documents you right-click and choose "Learn my voice from this". Plugins can add more actions.

---

## Themes

5 themes, each with light and dark modes:

- **Ink** — Clean, minimal, professional
- **Novel** — Warm, serif-based, literary
- **Mono** — Monospace, code-focused
- **Editorial** — Bold magazine-style headings
- **Studio** — Contemporary sans-serif

Three typography presets (default, compact, expanded) work with any theme.

---

## Markdown Native

Every document is a `.md` file on disk. What you see in the editor is markdown with rich rendering: headings, lists, tables, code blocks, images, links, all stored as plain text.

```
~/.openwriter/
├── Getting Started.md
├── Chapter 1 - Origins.md
├── Research Notes.md
└── _workspaces/
    └── My Novel.json
```

- **No database.** The filesystem is the index. Move, copy, or `grep` your files however you want.
- **Open any `.md` file.** Point OpenWriter at existing markdown from any project and it loads instantly.
- **Git Sync built in.** Push your documents to GitHub directly from the editor. Your markdown files are version-controlled and portable, reachable from any machine or future web client.
- **Frontmatter metadata.** YAML frontmatter for tags, status, or any key-value pairs your workflow needs.
- **Full markdown fidelity.** Bold, italic, strikethrough, code blocks with syntax highlighting, tables, task lists, images, links, subscript, superscript, all round-trip cleanly to `.md`.
- **AI-native format.** Every LLM reads and writes markdown natively. No conversion layer, no token waste. The agent edits the same format the file is stored in.

### Git Sync

Push your documents to GitHub directly from the editor. Three setup methods:
- **GitHub CLI** — Auto-detected if `gh` is authenticated
- **Personal Access Token** — Manual GitHub auth
- **Existing repo** — Connect to a repo you already have

### Export

Export any document to:
- Markdown (`.md`)
- HTML (styled web page)
- Word (`.docx`)
- Plain text (`.txt`)
- PDF (via print preview)

### Version History

Automatic snapshots with full rollback. Browse previous versions and restore any point.

---

## Token-Efficient Wire Format

Agents don't parse JSON. OpenWriter uses a compact tagged-line format that's ~10x more token-efficient:

```
title: My Document
words: 1,205
pending: 2
---
[h1:a1b2c3d4] Chapter One
[p:e5f6g7h8] The quick brown fox jumped over the **lazy** dog.
[ul:i9j0k1l2]
  [li:m3n4o5p6] First bullet
  [li:q7r8s9t0] Second bullet
```

Each line: `[type:8-char-id] content` with inline markdown preserved. Agents read and write naturally.

---

## Plugin System

OpenWriter is extensible via plugins. A plugin can:

- **Register MCP tools** — Extend the agent's capabilities
- **Add HTTP routes** — Custom API endpoints on the server
- **Contribute context menu items** — UI actions for text transformation

```typescript
import type { OpenWriterPlugin } from 'openwriter';

const plugin: OpenWriterPlugin = {
  name: 'my-plugin',
  version: '1.0.0',

  mcpTools(config) {
    return [{
      name: 'my-tool',
      description: 'Does something useful',
      inputSchema: { type: 'object', properties: {} },
      handler: async (params) => ({ result: 'done' })
    }];
  },

  contextMenuItems() {
    return [{
      label: 'My Action',
      action: 'myplugin:do-thing',
      condition: 'has-selection'
    }];
  }
};

export default plugin;
```

Load plugins at startup:

```bash
openwriter --plugins my-plugin,another-plugin
```

---

## CLI Options

```bash
openwriter [options]

Options:
  --port <number>       Port number (default: 5050)
  --no-open             Don't auto-open browser
  --plugins <names>     Comma-separated plugin names

Subcommands:
  setup                 Install OpenWriter, register its MCP server with Claude Code,
                        and add its background agents (alias: install-skill)
```

---

## Architecture

```
Browser (localhost:5050)
  ├── TipTap 3.0 Editor (React)
  ├── Decoration Plugin (pending insert/rewrite/delete)
  ├── Review Panel (accept/reject with keyboard nav)
  ├── Sidebar (4 views: tree, timeline, board, shelf)
  └── Context Menu (plugin-provided AI actions)
         │
         │ WebSocket + HTTP
         ▼
Pad Server (Express + WebSocket + MCP stdio)
  ├── Document state (in-memory + markdown on disk)
  ├── 24 MCP tools + plugin tools
  ├── Workspace management
  ├── Git sync, versions, export
  └── Plugin loader
         │
         │ MCP stdio
         ▼
AI Agent (Claude Code, Cursor, etc.)
```

Three interfaces:
- **HTTP** — Browser UI operations, document CRUD, plugin proxying
- **WebSocket** — Real-time push of agent changes to browser
- **MCP stdio** — Agent reads/writes documents

The server supports **multi-session mode**: if port 5050 is already taken, additional instances proxy MCP calls via HTTP to the running server. Multiple agents can safely share the same document state.

---

## Development

```bash
# Clone and install
git clone https://github.com/travsteward/openwriter.git
cd openwriter
npm install

# Dev mode (hot reload)
cd packages/openwriter
npm run dev

# Build
npx turbo run build --force

# Type check
npx tsc --noEmit -p packages/openwriter/tsconfig.json        # frontend
npx tsc --noEmit -p packages/openwriter/tsconfig.server.json  # server

# Run production build
node packages/openwriter/dist/bin/pad.js
```

Monorepo structure: `packages/openwriter` (editor + server), `plugins/` (optional extensions).
