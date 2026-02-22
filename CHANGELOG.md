# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.1] - 2026-02-22

### Added
- 4 version MCP tools: `list_versions`, `create_checkpoint`, `restore_version`, `reload_from_disk` — agent self-recovery without browser UI
- Article cover image carousel with save button
- Longform tweets — 280 char limit is now soft, not a gate

### Fixed
- Markdown round-trip preserving hardBreaks and empty paragraphs
- Tweet compose Enter now produces `<br>` not `<p>`
- Empty paragraphs visible in tweet compose mode
- Sidebar title updates live on article title change
- Reject-all cache desync, stuck spinner, workspace doc delete
- `populate_document` desync with `import_gdoc` clarification
- Ephemeral auto-delete removed for tweet/article templates

### Changed
- MCP pipeline speed optimizations (Phase 1)
- 29 core MCP tools (was 25)

## [0.3.0] - 2026-02-20

### Added
- X Article compose view — scoped editor matching X's article format with HTML copy for pasting
- Templates dropdown in titlebar for creating tweets, replies, quote tweets, and articles
- `generate_image` MCP tool — generate images via Gemini Imagen 4, optionally set as article cover atomically
- Image generation plugin (`@openwriter/plugin-image-gen`) — right-click empty paragraphs to generate AI images inline
- Plugin category system with `empty-node` context menu condition for category-specific actions
- Tweet Post button wired to X API via plugin system
- Canvas Paper mode with rounded/square corner options
- Live character counter and contextual placeholder text for tweet compose
- Ephemeral doc cleanup — posted tweets auto-trashed on next startup
- Built-in update check with global install recommendation
- Theme-aware scrollbar styling for dark mode

### Changed
- Tweet compose redesigned as document type (metadata-driven) instead of appearance style
- Pixel-accurate X/Twitter CSS overhaul for tweet compose — reply threads, quote cards, action bar
- `create_document` gains `empty` flag for instant template docs that skip the writing spinner
- Article title input shows placeholder instead of default text ("Article", "Untitled", "New Document")
- Ephemeral docs now move to OS trash instead of permanent delete
- MCP server renamed from `open-writer` to `openwriter`
- MCP stdio transport starts before Express/plugin setup for faster agent connection
- 25 core MCP tools (was 24)

### Fixed
- Floating toolbar hanging after text deselection
- Article footer clipped by flex stretch + overflow hidden
- Empty `articleContext` no longer incorrectly triggers article view
- Tweet compose wrapper no longer stretches full page height

## [0.2.2] - 2026-02-18

### Fixed
- Race condition where accepting changes on a populated document while agent creates another document caused accepted changes to revert
- Server now validates doc-update targets match active file, routes mismatched updates to correct file on disk

### Changed
- Tags are now document-scoped (stored in frontmatter) instead of workspace-scoped — tags travel with the document
- Simplified `tag_doc` and `untag_doc` MCP tools (no workspace parameter needed)
- Two-step document creation flow: `create_document` (shows spinner) then `populate_document` (delivers content)
- Documents deleted via OS trash (recoverable) instead of permanent delete

### Removed
- Workspace-level tag storage (`workspace-tags.ts` deleted)

## [0.2.1] - 2026-02-17

### Changed
- Updated SKILL.md for dual-entry orientation (skill-first and MCP-first discovery)
- Added `install-skill` CLI command for skill distribution

## [0.2.0] - 2026-02-17

### Added
- Skill distribution via `npx openwriter install-skill`
- Markdown-native README rewrite
- Plugin selector dropdown with dynamic enable/disable from UI
- Canvas style options in Appearance panel

## [0.1.0] - 2026-02-17

### Added

- TipTap 3.0 rich text editor with React frontend
- 24 MCP tools across document, multi-doc, workspace, and import operations
- Pending change decoration system (insert/rewrite/delete with accept/reject)
- Review panel with vim-style keyboard navigation (j/k/h/l/a/r)
- Multi-document workspaces with containers, tags, and shared context
- 4 sidebar views: tree, timeline, board, shelf
- Right-click context menu with plugin-provided AI actions
- 5 themes (Ink, Novel, Mono, Editorial, Studio) with light/dark modes
- Compact tagged-line wire format for token-efficient agent I/O
- Git sync (GitHub CLI, PAT, or existing repo)
- Version history with rollback
- Export to Markdown, HTML, Word, Plain Text, PDF
- Image upload via paste and drag-and-drop
- Internal document links with click-to-navigate
- Plugin system for extending MCP tools, HTTP routes, and context menu
- Google Doc import with auto-chapter splitting
- Multi-session support (additional instances proxy via HTTP)
- CLI with `--port`, `--no-open`, `--api-key`, `--plugins` flags
