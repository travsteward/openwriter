# Codex execution

## MCP and setup

Discover OpenWriter MCP tools by logical name (`read_pad`, `write_to_pad`,
`list_documents`) and use the live namespace and schema. A server named in config
is not proof its tools are loaded in this task. Setup is in
[setup.md](setup.md).

Codex has no `Agent` or `Task` tool and does not load the subagent files under
`~/.claude/agents/`. Never call a named subagent type or the `/mcp` command.

## Maintenance workers

Enrichment (firm rule 5) and sort (firm rule 6) signals select the same work in
Codex. Ignore the Claude dispatch syntax in a server footer.

Use a bounded helper in the same task when one is available, authorized and able
to reach OpenWriter MCP. Pass it the full procedure (for enrichment,
[enrichment.md](enrichment.md); for sort, the steps in firm rule 6) and an
explicit list of docIds that no other worker holds. Inherit the configured model
unless the user chose one. Do not open a separate Codex task just for
maintenance unless the user asked for one.

If no helper can reach MCP, run one bounded batch inline with the same tools: at
most 12 docs, failures left pending, and a report of what actually completed.
Never promise a fixed price or duration.

## Browser and restart

Firm rule 0 applies: never open the OpenWriter UI in a browser. A second MCP
process can proxy to the HTTP server already running on port 5050; keep that
server and its state. Reconnecting is not restarting. Restart the server only
when a new build or a test needs it.
