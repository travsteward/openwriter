# Claude Code execution

## Maintenance workers

`npx openwriter setup` installs two custom subagents in `~/.claude/agents/`:
`openwriter-enrichment-minion` (firm rule 5) and `openwriter-sort-minion`
(firm rule 6). The sort signal carries the complete dispatch call; fire the
Agent tool with exactly those field values:

```
Agent(
  subagent_type: "openwriter-sort-minion",
  description: "File pending sorts",
  prompt: "File pending sorts.",
  run_in_background: true
)
```

Use the Agent schema the harness actually exposes, not a string copied blindly
from server output. Pass disjoint docIds when more than one worker runs.

If the call returns `Agent type 'openwriter-sort-minion' not found` (an older
OpenWriter, or setup was skipped), tell the user once: "OpenWriter has docs
awaiting sort but the sort minion isn't installed yet. Run `npx openwriter setup`
and restart Claude Code." Then continue with their request.

## Browser and restart

Firm rule 0 applies: never open the OpenWriter UI in a browser. MCP servers load
when a session starts, so a new registration needs a session restart.
