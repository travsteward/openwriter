# book-writer

Book-scale orchestration skill for Claude Code. Pairs with [`/authors-voice`](../authors-voice/) — this skill owns SHAPE (chapter architecture, beats, workspace), `/authors-voice` owns VOICE (anchor, minion, post-write audit).

## What this skill does

- **Book-class question** (fiction or nonfiction; argument-driven or domain-driven) before any chapter work
- **Workspace setup** with a 5-container hierarchy enforced from creation
- **Chapter architecture** — chunk source material into committed chapter containers with substantive names
- **Per-chapter beats** — declarative-claim beat methodology (nonfiction default)
- **Long-form orchestration** — multi-minion patterns for parallel chapter drafting
- **Book mode** — per-session workflow integrated with the openwriter MCP
- **Delegation to /authors-voice** — for every prose generation pass, this skill produces the locked brief and hands off

## Entry points

Trigger phrases (see SKILL.md for full list): `/book-writer`, `/book`, `book project`, `chapter architecture`, `chapter beats`, `beat map`, `TOC`, `book outline`, `draft a chapter`, `long-form`, `multi-chapter`, `book mode`, `book workspace`.

## File map

- [SKILL.md](SKILL.md) — router + firm rules + book-class question + delegation pattern
- [docs/chapter-architecture.md](docs/chapter-architecture.md) — 5-pass / 7-phase chunk-to-container commit
- [docs/beats.md](docs/beats.md) — per-chapter beat methodology, declarative-claim convention, beat-as-commitment shape
- [docs/long-form-orchestration.md](docs/long-form-orchestration.md) — book-scale workflow + multi-minion patterns
- [docs/book-mode.md](docs/book-mode.md) — per-session book-writing workflow + openwriter integration
- [docs/workspace-management.md](docs/workspace-management.md) — container hierarchy + doc naming + rename discipline
- [docs/manuscript-binding.md](docs/manuscript-binding.md) — outline of `doc:` links compiled into one manuscript and EPUB/DOCX, without flattening the beats

## Status

**Version 0.1.0** — initial scaffold. Currently coexists with `/authors-voice` (parallel-skills period). The 5 docs above are copies of the originals in `/authors-voice/docs/`. Consolidation (move out of authors-voice, leave only here) pending sign-off.

**Nonfiction-only.** Fiction beat methodology (scene structure, Save the Cat / McKee 22 Steps) will ship in a future version as `docs/beats-fiction.md` + `docs/scene-structure-fiction.md`. Current beats.md covers nonfiction patterns only.
