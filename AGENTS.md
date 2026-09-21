# OpenWriter

Local TipTap 3.0 editor for human-agent collaboration. Turborepo monorepo with plugin system.

## Architecture

- **Enrichment** — Exclusive canonical snapshot claims, revision-checked logline completion and restart recovery → [docs/enrichment.md](docs/enrichment.md)

- **Revision variants** — Nested independent revisions, existing Focus editor, and original-version restoration → [docs/manuscript-editing-drafts.md](docs/manuscript-editing-drafts.md)

- **`packages/openwriter`** — Main app: Express server + React frontend + MCP stdio transport → [docs/architecture.md](docs/architecture.md)
- **`plugins/*`** — Bundled plugin packages → [docs/plugin-architecture.md](docs/plugin-architecture.md) | [docs/plugin-development.md](docs/plugin-development.md)
- **`skills/openwriter`** — Public skill for agent discovery → [docs/skill-progression.md](docs/skill-progression.md)
- **Connections** — Platform-owned OAuth for content distribution (12 providers + built-in newsletter) → [docs/connections.md](docs/connections.md)
- **Content Types** — Typed docs (blog, linkedin, newsletter) with compose views + sidebar creation → [docs/content-types.md](docs/content-types.md)
- **Scheduler** — Content scheduling: slots, queue, cron-fired posts via platform Worker → [docs/scheduler.md](docs/scheduler.md)
- **Scheduler Connectors** — `connect-*` plugins for third-party schedulers (Postiz, Buffer, etc.) via federated SchedulerSource → [docs/scheduler-connectors.md](docs/scheduler-connectors.md)
- **Vault Bridge** — Obsidian-style features (search dropdown, outline, wikilinks, backlinks panel, command palette) → [docs/vault-bridge.md](docs/vault-bridge.md)
- **Node Identity** — Math-first per-block fingerprints in YAML frontmatter (`nodes:` + `graveyard:`) so block IDs survive edits, type-changes, deletes, paste-back. Save-time matcher reads from disk every save (Option B). Body stays clean markdown. → [docs/node-identity.md](docs/node-identity.md) · [adr/node-identity-matcher.md](adr/node-identity-matcher.md)
- **Footnotes** — CommonMark `[^N]` references in prose + constrained end-of-doc definitions block. Per-doc scope. Idempotent roundtrip after one normalization pass on first save. Phase 1 = editor-side only; pagination and per-page placement deferred to a future book-export pipeline. → [docs/footnotes.md](docs/footnotes.md) · [adr/footnote-system.md](adr/footnote-system.md)
- **Prompt Debug Inspector** — Reads the exact AV prompt sent on a right-click Enhance. Set `OW_PROMPT_DEBUG=1` on the openwriter MCP server env → every Enhance drops a `_prompt-*.md` doc (system + user prompt) in the sidebar. Off by default, owner-only. → [docs/prompt-debug.md](docs/prompt-debug.md)
- **Logging** — Structured JSON events at `~/.openwriter/profiles/<profile>/events.log` with request-ID correlation. Errors-only + redacted-text by default (public-safe); `~/.openwriter/log-config.json` overrides per-machine. → [adr/logging-system.md](adr/logging-system.md)
- **Alias Propagation (planned)** — Two-tier doc linking: writing agent makes the *original* source→target connection + curates the target's `aliases:` array; minion sweeps the corpus and propagates the link to every other site where an alias appears. Pure string matching against author-declared aliases, no semantic guessing. Workspace-scoped, idempotent. Builds on the v0.20 `references` + `aliases` data slots — no schema changes. → [docs/alias-propagation.md](docs/alias-propagation.md)

## Skill System

OpenWriter's primary distribution is via a **public skill** — a SKILL.md that teaches agents how to install, configure, and use the editor.

- Install: `npx skills add https://github.com/travsteward/openwriter --skill openwriter`
- Canonical copy: `~/.Codex/skills/openwriter/SKILL.md` (local, what the agent reads and edits)
- Published via `/skill-publish openwriter` to `skills/openwriter/SKILL.md` (GitHub discovery)
- npm copy (`packages/openwriter/skill/SKILL.md`) auto-derived at publish time via `prepublishOnly`
- The skill handles: setup detection, npm install, MCP server config, writing strategy, review etiquette
- Full history: [docs/skill-progression.md](docs/skill-progression.md)

## Delivery

The canonical authority is [.greprag/delivery.json](.greprag/delivery.json): merge to main under the shared merge lock, then deploy only from [the primary checkout](C:/openwriter). Use [the merge/deploy procedure](.greprag/deploy.md) and its gated scripts. Versioned npm publication is separate: [release procedure](.greprag/release.md).

## Conventions

- **Commits**: `wip:` prefix for work-in-progress. Checkpoint after every fix/feature.
- **MCP tool count**: Currently 67 tools (46 core + 21 publish plugin).
- **Skill version**: Independent from app version (currently 0.7.1). Bump when SKILL.md content changes.
- **Toasts**: transient user feedback uses the canonical `showToast()` primitive — `src/utils/toast.ts` (info/error, design-token styled, auto-themed). Do NOT reinvent inline-error or banners for momentary messages; banners are for persistent app-state, inline `setError` for in-view errors. Full guidance in the toast.ts header.
- **Changelog governance (two-tier, the repo is public)**: `CHANGELOG.md` is committed and public — it states *what* changed and the *user benefit*, nothing more. **NEVER write business strategy into the public changelog**: margins, cost×multiplier framing, "our cost", per-unit economics, or competitive positioning. Don't link ADRs from the public changelog (they're internal *rationale* — noise for users, and a back-door to strategy). The full *why* — strategy, margin model, ADR links — goes into the gitignored private notes at [docs/releases.md](docs/releases.md) under "Internal Release Notes". **ADRs (`adr/*.md`) are committed/public too** — same ban applies: they may hold architecture rationale but **no business strategy** (no margins/multipliers/per-unit economics; pricing-model detail goes to `docs/releases.md`). Public pricing *facts* (tier names, list prices, plan allotments) are fine anywhere. Banned-topics gate runs at release time → see the `/release` skill.
- **Bundled-skill hygiene (privacy)**: everything under `skills/` and `plugins/` ships to strangers. Worked examples in bundled skill docs are **always fictional** (the sleep book, RecipeBox) — never the operator's live work, ventures, book content, or identity, even when the real thing is the most convenient example. Sync direction is **bundled-stays-generic**: when porting an improvement from a local `~/.Codex/skills/` copy, port the *mechanism* and genericize any personal examples during the port — never copy local docs verbatim. Gate: `node scripts/check-skill-privacy.mjs` (denylist scan over `skills/` + `plugins/`) — run before any skill publish and at release time; a hit blocks the publish. Origin: the 2026-06-10 leak (TM book chapters, venture names, personal character refs found shipped in bundled docs; scrubbed in `551441e`).

## Key Design Decisions

- **Marketing site** — Separate private repo: `C:\openwriter-site` / `travsteward/openwriter-site`. Astro 5 static + Cloudflare Workers. See [docs/site-aesthetic.md](docs/site-aesthetic.md).
- **Skill-first onboarding** — Users install the skill, not the npm package directly. The skill teaches the agent to do the setup.
- **Two-step document creation** — `create_document` (spinner) → `populate_document` (content). Prevents 30s silence during generation.
- **Plain .md files** — No database. Filesystem is the index. YAML frontmatter for metadata.

## Server Restart

Use [scripts/deploy.ps1](scripts/deploy.ps1) from [the canonical main checkout](C:/openwriter). It checks source and merge provenance, builds, saves, verifies the exact HTTP listener before restarting it, and proves the running commit through the build stamp. Keep MCP proxies and isolated test servers untouched.

## Logs (for troubleshooting)

Codex writes MCP + main process logs to `C:/Users/travy/AppData/Roaming/Codex/logs/`:

- **`mcp-server-openwriter.log`** — openwriter MCP server stdout/stderr. Includes `[WS] doc-update`, `[WS] Broadcast id-rewrites`, `[State] BLOCKED save`, `[sync-check serialize:<Doc>] FAIL`, plugin load errors. **First place to look** when a bug brief mentions silent data loss, rewrite loops, or sync failures.
- **`mcp.log`** — MCP framework (transport, init, tool discovery).
- **`main.log`** — Codex desktop main process.
- **`Codex.ai-web.log`** — Web/desktop client.

To grab logs from the user's perspective: Settings → Developer → View Logs (opens the logs folder in Explorer).

## Gotchas

Known pitfalls and non-obvious behaviors → [docs/gotchas.md](docs/gotchas.md)
