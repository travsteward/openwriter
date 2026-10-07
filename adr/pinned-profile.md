# A process started with --profile serves only that profile and never saves the choice

## Context

`~/.openwriter/config.json` is shared by every OpenWriter process on the machine, and
`activeProfile` in it decides which profile a plain `openwriter` start opens. Switching profile in
the UI writes that field (`POST /api/profiles/switch`).

Testing needs a second, isolated OpenWriter: a separate profile on another port, so test documents,
publishing and site changes never touch the user's real profile. Started the ordinary way, a second
process would read the user's profile from the shared config, and switching it to the test profile
would write `activeProfile`, so the user's next normal start would open the test profile.

## Current invariants

- `--profile <name>` calls `pinProfile(name)` in `server/helpers.ts`: the profile is created if
  missing, made active for this process, and `profilePinned` is set. It is never written to
  `config.activeProfile`.
- A pinned process never writes the shared config at all: `saveConfig` returns at once. Profile,
  plugin enable/config and update-check state stay in that process only. Start it with
  `--plugins <names>` for the plugins it needs; plugin settings changed in it last until it stops.
- A pinned process refuses `POST /api/profiles/switch` with 409 (it serves one profile).
- A process started without `--profile` behaves exactly as before: it restores `activeProfile` from
  the shared config and can switch.
- Ports are unchanged: one server per port (`adr/single-server-ownership.md`). A pinned test
  instance runs on its own port (e.g. `--port 5051 --profile Test`), so MCP clients aimed at the
  default port never reach it.

## Decision log

### 2026-10-06 — add --profile for an isolated test instance
Chosen over a per-process copy of the config file (the API key and plugin settings would then
diverge) and over an environment variable (a flag is visible in the launch command and the README).

### 2026-10-06 — a pinned process writes no shared config
The first test run found the publish plugin off in the shared config; enabling it in the test
instance (UI or `--plugins`) persists `enabled` to the shared config and would switch it on in the
main OpenWriter. Guarding only `activeProfile` left that and every other shared write open, so the
guard moved into `saveConfig`, the one writer of the file.
