# One server per port: holding the port is being the server

## Context

Every agent session launches its own `openwriter` process over MCP stdio. One
process must be the server: it owns the in-memory documents, the autosave, the
active-doc watcher and the browser UI on the port. Every other process must be
a pass-through client that proxies tool calls to it over HTTP (`/api/mcp-call`).

The old startup decided this with a one-shot health probe. Only a probe that saw
a *healthy* server produced a client. Any other result (port free, holder slow
or mid-restart, holder never answering) produced a server, which loaded all
state, served MCP tools in-process, and then tried to listen. When the listen hit
`EADDRINUSE` it retried every 2s forever. That left a process that never held
the port but kept its own in-memory copy of every document, running agent tools
against that copy and saving whole files over the shared disk.

Live evidence (2026-09-28): the Claude desktop app's openwriter (pid 10140,
v0.41.2) started at 09:14 this way. For hours it:
- saved old document text over edits the user had accepted on the real server.
  The real server's watcher saw an "external write" and reloaded the old text,
  so accepted edits reverted and node IDs churned;
- ran `post_to_blog` in-process on stale code, publishing its own unrelated
  active doc over the intended blog post;
- made a UI Republish a no-op, because the file on disk had been reverted.

## Current invariants

- **Holding the port is being the server.** `bin/pad.ts` claims the port by
  binding a bare `http` server **before** `load()` runs. Only the process that
  wins the bind loads state and serves MCP tools in-process.
- **Losing the bind means client mode, always.** No path runs local tools, or
  holds document state, without the port. If the holder is unresponsive (a
  server mid-exit), the claim is retried twice at 3s intervals, then the process
  settles as a client.
- **`startHttpServer` receives the already-bound server** and swaps the
  placeholder 503 handler for the Express app. It never listens and never
  retries.
- **Clients fetch the tool list on demand** (with a ~10s retry), so a client
  started during a server restart comes up once the server does, instead of
  failing at boot.

## Decision log

### 2026-09-28 — claim the port before loading state
Replaced "probe then decide" with "bind then decide". This removes the
split-brain state (server without port) rather than guarding its writes.
Rejected alternatives: a write guard on the stray process (the stray still
serves stale reads and publishes), and per-call re-probing inside a primary
(a process that has already loaded state can still act on it).
