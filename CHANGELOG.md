# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-02-17

### Changed
- SKILL.md dual-entry orientation — detects skill-first vs npm-first install and guides accordingly
- `skills/openwriter/SKILL.md` at repo root for discovery via skills.sh, add-skill, openskills
- README leads with `npx skills add` as primary entry point
- Updated package description and GitHub repo description
- New screenshot showing sidebar + review panel

## [0.2.0] - 2026-02-17

### Added
- `npx openwriter install-skill` — installs Claude Code companion skill to `~/.claude/skills/openwriter/`
- Bundled SKILL.md ships with npm package (writing strategy, 24-tool reference, troubleshooting)
- New "Markdown Native" section in README — filesystem-as-database, open any `.md`, Git Sync, frontmatter
- Rewrote README positioning: editor built for agentic code editors, not another agent bolted onto a doc tool

## [0.1.1] - 2026-02-17

### Fixed
- Include README and LICENSE in npm package (npm page was blank)

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
- Author's Voice plugin for voice-matched rewriting
- Google Doc import with auto-chapter splitting
- Multi-session support (additional instances proxy via HTTP)
- CLI with `--port`, `--no-open`, `--api-key`, `--plugins` flags
