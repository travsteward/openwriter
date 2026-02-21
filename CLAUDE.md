---
{"docId":"e500c160","title":"Untitled"}
---

# CLAUDE.md

## Session Start

Check `TODO.md` for current tasks. Docs listed below cover architecture and roadmap — follow links for details.

## Project Overview

OpenWriter — local TipTap rich text editor for human-agent collaboration. Turbo monorepo: `packages/openwriter` (Vite + React frontend, Express + WS server), `plugins/` (MCP tool plugins). Agent writes pending changes via MCP tools; user accepts/rejects in-browser. 25 MCP tools across document, multi-doc, workspace, media, and import operations.

## Docs

- [Architecture](<docs/architecture.md>) — system architecture, 25 MCP tools, HTTP API, decoration system, monorepo structure
- [Vision](<docs/vision.md>) — strategic thesis, monetization paths, open-source strategy, roadmap with status
- [Enhancements](<docs/enhancements.md>) — remaining future work (review UX, agent collab, mobile, publishing)
- [GrepRAG Memory](<docs/greprag-memory.md>) — future: centralized agent memory via GrepRAG shared brain
- [Issues](<docs/issues.md>) — historical bug fixes (pending state, position-index, appliedCount, review panel)
- [Releases & Open Source](<docs/releases.md>) — semver, changelog, npm publish flow, GitHub setup, public vs internal files
- [Article View](<docs/article-view.md>) — X Article compose view: scoped editor, HTML copy, no-API workflow
- [Plugin Categories](<docs/plugin-categories.md>) — category field on plugins, `empty-node` context menu condition fix
- [Image Gen Plugin](<docs/image-gen-plugin.md>) — right-click empty paragraph to generate AI images via Gemini

## Deploy

- Runs via MCP server connection — no manual start needed
- Browser UI: http://localhost:5050
- dev: `cd packages/openwriter && npm run dev` (Vite dev server, port 5050)
- build: `npx turbo run build --force` (from repo root)
- prod: `node packages/openwriter/dist/bin/pad.js` (serves built client + WS on 5050)

## Git Workflow

- Main branch: `main`. Work on `master` or feature branches, PR into `main`.
- Commit conventions: imperative mood, concise, why > what.

## Gotchas

- Server entry point is `dist/bin/pad.js` — NOT `dist/server/index.js` (that one exits silently)
- Buttons don't inherit `font-family` by default — always set `font-family: inherit` on custom buttons
- MCP `write_to_pad` needs fresh node IDs — always re-read/switch doc before writing changes
- `import_content` (formerly `import_gdoc`) accepts markdown strings or GDoc JSON — markdown is the preferred path

## Development Commands

- `npx turbo run build --force` — full rebuild
- `node packages/openwriter/dist/bin/pad.js` — start server (port 5050)
- `npx tsc --noEmit -p packages/openwriter/tsconfig.json` — type check frontend
- `npx tsc --noEmit -p packages/openwriter/tsconfig.server.json` — type check server


