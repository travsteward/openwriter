# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
