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

**Install the skill** (Claude Code, Cursor, Codex, and 20+ agents):
```bash
npx skills add https://github.com/travsteward/openwriter --skill openwriter
```

Then add the MCP server for the 24 editing tools:
```bash
claude mcp add -s user openwriter -- openwriter --no-open
```

The skill teaches your agent how to use OpenWriter's tools effectively: writing strategy, review etiquette, and troubleshooting. The MCP server provides the actual document editing capabilities.

**Other MCP agents** (Cursor, OpenCode, etc.) — add to your MCP config:

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

| Action | Key | Description |
|--------|-----|-------------|
| Rewrite | `R` | Rewrite selection at similar length |
| Shrink | `S` | Condense by 40-60% |
| Expand | `E` | Expand by 50-100% |
| Custom | — | Free-text instruction |
| Fill | `F` | Generate content between paragraphs |
| Insert after | `I` | Generate new content after selection |
| Delete | `D` | Mark for deletion |
| Link to doc | `L` | Create internal document links |

Context menu actions are provided by plugins. The built-in [Author's Voice](https://authors-voice.com) plugin rewrites text in your personal writing voice.

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

### Community Plugins

#### Clawprint

[Clawprint](https://github.com/cairn-agent/openwriter-plugin-clawprint) adds MCP tools for reading public Clawprint posts, previewing the exact Markdown payload locally, publishing a post, and inspecting public version proofs.

Until the package is published to npm, install it from GitHub in OpenWriter's user-plugin directory:

```bash
mkdir -p ~/.openwriter/plugins
cd ~/.openwriter/plugins
npm install github:cairn-agent/openwriter-plugin-clawprint
```

Restart OpenWriter, open the **Plugins** panel, and enable **Clawprint**. Public reading and local preview require no credentials.

Publishing is disabled by default. To enable it, configure both `CLAWPRINT_API_KEY` and `CLAWPRINT_ALLOW_WRITES=1`, then pass `confirm: true` only after reviewing the exact title, Markdown, and tags for that tool call. The plugin does not schedule, retry, or background-cross-post writes. See the [plugin documentation](https://github.com/cairn-agent/openwriter-plugin-clawprint#readme) for the complete safety and proof boundaries.

---

## CLI Options

```bash
openwriter [options]

Options:
  --port <number>       Port number (default: 5050)
  --no-open             Don't auto-open browser
  --api-key <key>       Author's Voice API key
  --av-url <url>        Author's Voice backend URL
  --plugins <names>     Comma-separated plugin names

Subcommands:
  setup                 Install the skill, wire up the MCP server, and prepare your agent
                        (alias: install-skill)
```

Environment variables: `AV_API_KEY`, `AV_BACKEND_URL`

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
