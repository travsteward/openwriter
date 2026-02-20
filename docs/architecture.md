# OpenWriter — Architecture

> Local TipTap 3.0 editor for human-agent collaboration. Turbo monorepo with plugin system. 24 MCP tools across document, multi-document, workspace, and import operations.

---

## Quick Links

| Doc | What's There |
|-----|-------------|
| **[vision.md](vision.md)** | Strategic vision: open-source pivot, API tiers, publishing panel, plugin marketplace, roadmap |
| **[enhancements.md](enhancements.md)** | Remaining future enhancements (persistence, review UX, agent collab done items removed) |
| **[greprag-memory.md](greprag-memory.md)** | OpenWriter as the central brain for all agents — GrepRAG shared memory |
| **[issues.md](issues.md)** | Historical bug fixes and known issues |

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                           │
│                                                                 │
│  TipTap 3.0 Editor (React)                                     │
│  ├── Context Menu → rewrite/shrink/expand/custom/fill/insert/   │
│  │                   delete/link-to-doc/unlink                  │
│  ├── Floating Toolbar → bold/italic/link near selection         │
│  ├── Decoration Plugin → green insert / blue rewrite / red del  │
│  ├── Review Panel → accept/reject pending changes               │
│  ├── Sidebar → 4 views: default, timeline, board, shelf        │
│  ├── Titlebar → appearance, versions, export, sync panels       │
│  └── Themes → 5 themes × 2 modes (light/dark)                  │
│                        │ WebSocket                               │
└────────────────────────┼────────────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────────────┐
│               PAD SERVER (localhost:5050)                        │
│                                                                 │
│  Express (HTTP REST)                                            │
│  ├── Static files (built React app from dist/client/)           │
│  ├── Document CRUD (/api/documents, /api/save, /api/flush)      │
│  ├── Workspace CRUD (/api/workspaces/*)                         │
│  ├── Text edit (/api/edit-text)                                 │
│  ├── Link management (/api/create-link-doc, /api/auto-tag-link) │
│  ├── Git sync (/api/sync/*)                                     │
│  ├── Versions (/api/versions/*)                                 │
│  ├── Export (/api/export/*)                                     │
│  ├── Image upload (/api/upload-image)                           │
│  ├── Import (/api/import/gdoc)                                  │
│  └── /api/voice/* proxy → hosted AV backend                     │
│                                                                 │
│  WebSocket                                                      │
│  └── Push NodeChanges + document switches to browser            │
│                                                                 │
│  MCP Server (stdio) — 24 core tools + plugin tools              │
│  ├── Document: read_pad, write_to_pad, get_pad_status,          │
│  │   get_nodes, replace_document, get_metadata, set_metadata,   │
│  │   edit_text, open_file                                       │
│  ├── Multi-doc: list_documents, switch_document, create_document│
│  ├── Workspace: list/create/get_structure/get_item_context/     │
│  │   add_doc/update_context/create_container/tag/untag/move_doc │
│  ├── Import: import_gdoc                                        │
│  └── Meta: open-writer (launch browser)                         │
│                                                                 │
│  Plugin System                                                  │
│  └── Loads from plugins/ dir, each registers MCP tools          │
│                        │ stdio                                   │
└────────────────────────┼────────────────────────────────────────┘
                         │
                AI AGENT (Claude Code, Cursor, etc.)
                Connects via MCP config
```

Three interfaces into the pad server:
- **HTTP REST** — browser UI operations, document/workspace CRUD, AV proxy, sync, versions, export
- **WebSocket** — real-time push of changes and document switches to browser
- **MCP stdio** — AI agent reads/writes documents, manages workspaces

The pad server **proxies** all `/api/voice/*` calls to the hosted AV backend (staging or production). The API key stays server-side — the browser never sees it.

---

## 2. Monorepo Structure

```
openwriter/                        # Turbo monorepo
├── package.json                   # Root workspace config
├── turbo.json                     # Turbo pipeline config
├── tsconfig.base.json             # Shared TS config
├── CLAUDE.md                      # Agent instructions
├── packages/
│   └── openwriter/                # Main package
│       ├── package.json           # openwriter
│       ├── tsconfig.json          # Frontend (Vite/React)
│       ├── tsconfig.server.json   # Server (Node)
│       ├── vite.config.ts         # Builds React to dist/client/
│       ├── index.html
│       ├── skill/
│       │   └── SKILL.md           # Claude Code companion skill (ships with npm)
│       ├── bin/
│       │   └── pad.ts             # CLI: --api-key, --port, --no-open, --av-url, --plugins, install-skill
│       ├── server/                # 29 files
│       │   ├── index.ts           # Express + WS + MCP + all HTTP routes
│       │   ├── state.ts           # In-memory document state + server-side mutations
│       │   ├── mcp.ts             # MCP stdio server (24 tools)
│       │   ├── mcp-client.ts      # MCP client connection management
│       │   ├── ws.ts              # WebSocket handler
│       │   ├── compact.ts         # Tagged-line format serializer
│       │   ├── markdown.ts        # Markdown ↔ TipTap JSON (coordination)
│       │   ├── markdown-parse.ts  # Markdown → TipTap JSON parser
│       │   ├── markdown-serialize.ts # TipTap JSON → Markdown serializer
│       │   ├── documents.ts       # Multi-document CRUD, switching, file management
│       │   ├── workspaces.ts      # Workspace CRUD, manifest I/O
│       │   ├── workspace-types.ts # Workspace type definitions
│       │   ├── workspace-tags.ts  # Tag validation and management
│       │   ├── workspace-tree.ts  # Tree structure operations (containers, nesting)
│       │   ├── workspace-routes.ts # Workspace HTTP routes
│       │   ├── text-edit.ts       # Fine-grained find/replace within nodes
│       │   ├── gdoc-import.ts     # Google Doc JSON → documents/workspace
│       │   ├── git-sync.ts        # Git push/pull sync
│       │   ├── sync-routes.ts     # Git sync HTTP routes
│       │   ├── versions.ts        # Version history snapshots
│       │   ├── version-routes.ts  # Version HTTP routes
│       │   ├── export-routes.ts   # Export (markdown, HTML, PDF)
│       │   ├── export-html-template.ts # HTML export template
│       │   ├── image-upload.ts    # Image upload handling
│       │   ├── link-routes.ts     # Internal doc link routes
│       │   ├── plugin-types.ts    # Plugin type definitions
│       │   ├── plugin-loader.ts   # Dynamic plugin loading
│       │   ├── install-skill.ts  # CLI: copy bundled SKILL.md to ~/.claude/skills/openwriter/
│       │   └── helpers.ts         # Constants, presets, config persistence
│       └── src/                   # React frontend
│           ├── main.tsx
│           ├── App.tsx / App.css
│           ├── editor/
│           │   ├── PadEditor.tsx          # TipTap 3.0 editor + doc link handler
│           │   ├── extensions.ts          # PadLink, StarterKit, UniqueID, etc.
│           │   ├── BlurredLoadingNode.ts   # Loading state for nodes
│           │   ├── PendingAttributes.ts    # Pending status node attributes
│           │   ├── FloatingToolbar.tsx     # Formatting toolbar near selection
│           │   └── FormatToolbar.tsx       # Additional format toolbar
│           ├── context-menu/
│           │   └── ContextMenu.tsx # Rewrite/shrink/expand/custom/fill/insert/delete/link/unlink
│           ├── decorations/
│           │   ├── plugin.ts      # ProseMirror decoration plugin
│           │   ├── apply.ts       # applyInsert, applyRewrite, applyDelete
│           │   ├── resolve.ts     # accept/reject (single + batch)
│           │   ├── bridge.ts      # NodeChange → apply operations
│           │   └── styles.css     # Decoration colors, review panel, titlebar, context menu
│           ├── review/
│           │   └── ReviewPanel.tsx # Floating bottom panel: navigate, accept/reject, bulk ops
│           ├── sidebar/
│           │   ├── Sidebar.tsx         # Main sidebar component
│           │   ├── SidebarDefault.tsx  # Default document list view
│           │   ├── SidebarTimeline.tsx # Timeline view
│           │   ├── SidebarBoard.tsx    # Board/kanban view
│           │   ├── SidebarShelf.tsx    # Shelf view
│           │   ├── sidebar-data.ts     # Data fetching/state
│           │   ├── sidebar-actions.ts  # CRUD actions
│           │   ├── sidebar-utils.ts    # Utility functions
│           │   ├── sidebar-types.ts    # Type definitions
│           │   ├── sidebar-drag.ts     # Drag-and-drop logic
│           │   └── Sidebar.css
│           ├── titlebar/
│           │   └── Titlebar.tsx    # Menu, title, appearance/versions/export/sync panels
│           ├── themes/
│           │   ├── AppearancePanel.tsx  # Theme + mode selector
│           │   ├── appearance-store.ts  # Theme persistence
│           │   └── themes-base.css      # 5 themes × 2 modes (light/dark)
│           ├── versions/
│           │   └── VersionPanel.tsx     # Version history panel
│           ├── export/
│           │   └── ExportPanel.tsx      # Export to markdown/HTML/PDF
│           ├── sync/
│           │   └── SyncSetupModal.tsx   # Git sync setup
│           ├── hooks/
│           │   └── usePendingState.ts   # Pending change navigation/resolution
│           └── ws/
│               └── client.ts           # WebSocket client
└── plugins/
    └── authors-voice/             # Author's Voice plugin
        └── src/
            └── index.ts           # AV MCP tools (voice rewrite, profiles, etc.)
```

---

## 3. Two Write Modes

### Manual Mode (Context Menu)

User right-clicks selected text in the editor. Context menu offers:

| Action | Key | What Happens |
|--------|-----|-------------|
| **Rewrite** | R | Rewrite selection, maintain 80-120% length |
| **Shrink** | S | Condense by 40-60% |
| **Expand** | E | Expand by 50-100% |
| **Custom...** | — | Free-text instruction for rewrite |
| **Fill paragraph** | F | Generate content between surrounding paragraphs |
| **Insert after** | I | Generate new content after selection |
| **Delete** | D | Mark for deletion (no AI call) |
| **Link to doc** | L | Link selected text to another document |
| **Unlink** | — | Remove link from selected text |

Flow: Context menu → `POST /api/voice/apply-editor` (via pad proxy) → AV backend → returns TipTap JSON → applied as pending decorations in editor.

### Agent Mode (MCP Tools)

AI agent connects via MCP stdio. Agent reads the document, makes changes, user reviews:

1. Agent calls `read_pad` to get document content
2. Agent calls `write_to_pad` with changes — changes appear as pending decorations
3. User reviews via Review Panel (accept/reject individual or batch)
4. Agent checks `get_pad_status` — when `pendingChanges: 0`, user has resolved everything

---

## 4. MCP Tools (24 core + plugin tools)

### Document tools (9)

| Tool | What It Does |
|------|-------------|
| `read_pad` | Full document in compact tagged-line format with inline markdown |
| `write_to_pad` | Apply node changes (rewrite/insert/delete), accepts markdown or TipTap JSON |
| `get_pad_status` | Lightweight poll: word count, pending changes |
| `get_nodes` | Specific nodes by ID in compact format |
| `replace_document` | Bulk replace entire document content, optional title update |
| `get_metadata` | Read YAML frontmatter key-value pairs |
| `set_metadata` | Merge updates into frontmatter, saves to disk immediately |
| `edit_text` | Fine-grained find/replace within a node, with mark add/remove |
| `open_file` | Open a file from disk in the editor |

### Multi-document tools (3)

| Tool | What It Does |
|------|-------------|
| `list_documents` | All docs with filename, word count, last modified, active flag |
| `switch_document` | Save current, load target, returns compact read |
| `create_document` | Create + switch, optional content (marked as pending insert for review) |

### Workspace tools (9)

| Tool | What It Does |
|------|-------------|
| `list_workspaces` | All workspaces with title and doc count |
| `create_workspace` | New workspace manifest, optional voice profile ID |
| `get_workspace_structure` | Full tree: containers, docs, tags index, context |
| `get_item_context` | Progressive disclosure context for a doc |
| `add_doc` | Add doc to workspace root or specific container |
| `update_workspace_context` | Merge characters/settings/rules into workspace context |
| `create_container` | Folder inside workspace, max nesting depth 3 |
| `tag_doc` / `untag_doc` | Cross-cutting tag management on documents |
| `move_doc` | Move doc between containers or to root |

### Import tools (1)

| Tool | What It Does |
|------|-------------|
| `import_gdoc` | Google Doc JSON → single doc or multi-chapter book with workspace |

### Meta tools (1)

| Tool | What It Does |
|------|-------------|
| `open-writer` | Launch browser to the editor UI |

### Plugin tools (loaded dynamically)

Plugins in `plugins/` register additional MCP tools at startup. Currently:
- **authors-voice**: Voice rewrite, profile management, corpus operations

---

## 5. Decoration System

Document-is-truth architecture — `pendingStatus` node attributes are the single source of truth.

| Status | Color | Meaning |
|--------|-------|---------|
| `pending-insert` | Green `#16a34a` | New node inserted by agent/rewrite |
| `pending-rewrite` | Blue `#2563eb` | Node content replaced (original stored in `pendingOriginalContent`) |
| `pending-delete` | Red `#e74c3c` | Node marked for deletion (strikethrough) |

**Accept**: Strips pending attrs (content stays as-is).
**Reject**: Restores `pendingOriginalContent` (rewrite), removes node (insert), un-marks (delete).

Review Panel: floating bottom bar with SVG chevron navigation (j/k for changes, h/l for docs), accept (a) / reject (r) / accept all (Shift+A) / reject all (Shift+R). Cross-document navigation when multiple docs have pending changes.

---

## 6. Compact Wire Format

`read_pad` returns a token-efficient tagged-line format instead of raw JSON:

```
title: Document Title
words: 142
pending: 2
---
[p:a1b2c3d4] First paragraph text with **bold** and *italic*.
[p:e5f6g7h8] Second paragraph.
[h2:i9j0k1l2] A heading
```

Each line: `[type:8-char-id] content`. Inline markdown preserved. Implemented in `compact.ts`.

`write_to_pad` accepts markdown strings (auto-converted via `markdown.ts`) or TipTap JSON.

---

## 7. Server-Side Document Mutations

The server maintains an authoritative copy of the document. When `write_to_pad` is called, changes are applied to the server's in-memory document **first**, then broadcast to connected browsers via WebSocket.

Key functions in `state.ts`:
- `applyChangesToDocument()` — applies rewrite/insert/delete to server JSON, assigns 8-char hex IDs
- `findNodeInDoc()` — recursive search by node ID, returns parent array + index
- `generateNodeId()` — 8-char hex from `crypto.randomUUID()`
- `transferPendingAttrs()` — preserves pending state through browser doc-updates

---

## 8. Multi-Document Workspace

Documents are markdown files stored in `~/.openwriter/`. One document is active at a time.

```
~/.openwriter/
├── Getting Started.md       # Named document
├── Chapter 1 - Origins.md   # Another document
├── _untitled-a1b2c3d4.md    # Temp doc (auto-cleaned if empty)
└── _workspaces/
    └── My Novel.json        # Workspace manifest
```

**File format**: Markdown with JSON frontmatter (minified JSON between `---` delimiters). The filesystem is the index — no database.

**Sidebar**: 4 views (Default, Timeline, Board, Shelf). Collapsible, drag-and-drop between workspace containers, document CRUD, inline rename.

**Content preservation**: Before any switch, browser flushes current editor content via WebSocket and triggers immediate save.

---

## 9. Workspace System (v2)

Workspaces are ordered collections of documents with nested containers and cross-cutting tags.

**Schema**:
```json
{
  "version": 2,
  "title": "My Novel",
  "voiceProfileId": null,
  "root": [
    { "type": "doc", "file": "intro.md", "title": "Introduction" },
    { "type": "container", "id": "abc12345", "name": "Part 1", "items": [
      { "type": "doc", "file": "ch1.md", "title": "Chapter 1" }
    ]}
  ],
  "tags": { "draft": ["ch1.md"], "reviewed": ["intro.md"] },
  "context": {
    "characters": { "Marcus": "Roman senator, mid-40s, pragmatist" },
    "settings": { "Rome": "Late Republic period" },
    "rules": ["Magic does not exist"]
  }
}
```

**Progressive disclosure for agents**: 3 levels — manifest context (~500 tokens) → chapter frontmatter (~100 tokens each) → full reference docs (on-demand). ~57x token reduction vs reading all chapters.

---

## 10. Additional Features

| Feature | Server | Frontend | Description |
|---------|--------|----------|-------------|
| **Git sync** | `git-sync.ts`, `sync-routes.ts` | `SyncSetupModal.tsx` | Push/pull to GitHub |
| **Version history** | `versions.ts`, `version-routes.ts` | `VersionPanel.tsx` | Document snapshots and rollback |
| **Export** | `export-routes.ts`, `export-html-template.ts` | `ExportPanel.tsx` | Markdown, HTML, PDF export |
| **Themes** | — | `AppearancePanel.tsx`, `themes-base.css` | 5 themes × 2 modes (light/dark) |
| **Image upload** | `image-upload.ts` | — | Paste/drag images into editor |
| **Internal doc links** | `link-routes.ts` | `extensions.ts` (PadLink) | `doc:` links rendered as `<span>`, click switches document |
| **Plugin system** | `plugin-types.ts`, `plugin-loader.ts` | — | Dynamic MCP tool registration from `plugins/` |
| **Floating toolbar** | — | `FloatingToolbar.tsx` | Formatting near text selection |

---

## 11. CLI Usage

```bash
# Start server
npx openwriter

# With API key for Author's Voice
npx openwriter --api-key av_live_xxx

# Custom port (default: 5050)
npx openwriter --port 8080

# Headless (don't auto-open browser)
npx openwriter --no-open

# Load specific plugins
npx openwriter --plugins authors-voice

# Point to staging AV backend
npx openwriter --av-url https://breewriter-app-5eifi.ondigitalocean.app

# Install Claude Code companion skill
npx openwriter install-skill
```

**Environment variables** (alternative to CLI flags):
- `AV_API_KEY` — API key (prefix `av_live_`)
- `AV_BACKEND_URL` — Backend URL (default: `https://authors-voice.com`)

---

## 12. MCP Agent Configuration

Add to MCP config (e.g., `.claude/mcp.json`):

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

---

## 13. Proxy Design

The pad server proxies all AV API calls:

```
Browser → POST /api/voice/apply-editor → Pad Server → POST https://authors-voice.com/api/voice/apply-editor
                                          (adds Authorization: Bearer av_live_xxx)
```

Benefits: no CORS issues, API key never exposed to browser, single origin, usage headers forwarded.

---

## 14. Current Status

**Implemented**:
- Full editor: TipTap 3.0, context menu, floating toolbar, 5 themes with dark mode
- 24 core MCP tools + plugin system for extensibility
- Decoration system: pending insert/rewrite/delete with review panel
- Multi-document workspace with 4 sidebar views and drag-and-drop
- Workspace v2: nested containers (max depth 3), cross-cutting tags, progressive disclosure context
- Git sync (push/pull), version history with rollback
- Export: markdown, HTML, PDF
- Image upload (paste/drag)
- Internal doc links (`doc:` protocol, click to navigate)
- Compact tagged-line wire format for token-efficient agent I/O
- Server-side document mutations with pending state preservation
- Ephemeral doc cleanup: docs with `ephemeral: true` frontmatter auto-trashed on startup (tweets flagged after posting)
- Google Doc import (single doc or multi-chapter book)
- Author's Voice plugin (voice rewrite, profile management)
