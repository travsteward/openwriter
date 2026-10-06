# OpenWriter Surface

Where `/beat-writer` drafts live. Same container + two-doc pattern as `/blog-writer`, scoped to the "uncommitted draft" use case.

## Workspace layout

```
[Project] Drafts/                      (workspace, one per project; reuse existing if present)
└── <Doc Name>/                        (per-draft container)
    ├── Beats — <Doc Name>             (extraction output + locked beat map)
    └── <Doc Name>                     (Draft doc — the poured prose)
```

The workspace name `[Project] Drafts` is the default. If the project already has a generic writing workspace (`[Project] Writing`, `Drafts`, `Pad`, etc.), use that instead. Don't proliferate workspaces.

## Per-draft container

Each draft lives in its own container with two sibling docs.

**Container name:** matches the draft's working title (rename as the title sharpens)

**Two docs inside:**

| Doc | Title | Content type | Purpose |
|---|---|---|---|
| Beats | `Beats — <Doc Name>` | `notes` | Beat map (typed beats with jobs, in sequence) |
| Draft | `<Doc Name>` | `notes` | The poured prose |

Beats reshape → Draft re-pour. Two-doc separation makes targeted re-pours cheap AND matches the convention every channel-master expects — so refactor handoff is clean.

## Doc lifecycle (one draft, in call order)

| Step | When | Tool call | Notes |
|---|---|---|---|
| 1 | First draft for project | `create_workspace({ name: "[Project] Drafts" })` | Skip if existing writing workspace fits |
| 2 | New draft work begins | `create_container({ workspace_id, name: "<provisional title>" })` | Rename later as title sharpens |
| 3 | Start of extraction → beat map | `create_document({ container_id, title: "Beats — <Doc Name>", content_type: "notes" })` → `populate_document` | Beats doc — holds extraction + locked beat map |
| 4 | Start of voice pour | `create_document({ container_id, title: "<Doc Name>", content_type: "notes" })` → `populate_document({ content: "" })` | Draft doc, populated empty initially |
| 5 | Per beat, during pour | `/authors-voice` Apply Protocol minion (operator's default anchor) writes into Draft doc by `docId` (NOT by active view) — pending decorations | Opus, general-purpose subagent. Silent-build pattern same as `/blog-writer` |
| 6 | Polish phase | `/polish` reads from Draft doc, writes rewrites as pending decorations | |
| 7 | Operator review | Operator accepts pending decorations in OpenWriter Review tab | |
| 8 | (Optional) Refactor | Channel-master reads Beats + Draft, re-shapes into its own container | See `refactor.md` |

## Silent build

Never call `switch_document` or any view-control MCP as part of the workflow. The agent builds containers + docs + populates by `docId`. The operator watches the activity feed and file tree to follow progress; navigates to specific docs when they want to read output. View stays under operator control.

Only honor an explicit operator instruction ("open the Beats doc", "show me the Draft") with a `switch_document` call.

## Naming convention

- Workspace: `[<Project>] Drafts` (e.g., `[Orchestrator] Drafts`) — or reuse an existing writing workspace
- Container: matches the draft's working title (rename as it sharpens)
- Beats doc: `Beats — <Doc Name>`
- Draft doc: `<Doc Name>` (no prefix)

Same convention as `/blog-writer` — chosen on purpose so refactor handoff to a channel-master is trivial.

## Reshape loop

Edit Beats doc → identify affected beats → re-pour ONLY those beats in Draft doc → re-polish affected beats.

The doc separation makes this trivially cheap. Never re-pour the whole draft when one beat changed.

## What happens on refactor

When a draft gets refactored to a channel-master (see `refactor.md`):

- The original `[Project] Drafts/<Doc Name>/` container is LEFT IN PLACE (source of truth, not deleted)
- The channel-master creates a NEW container in its own workspace (`[Project] Blog/<New Container>/`, `[Project] Copy/<Page Name>/`, etc.)
- The channel-master reads the existing Beats + Draft as source material; re-shapes per its own discipline

The Drafts workspace is the "uncommitted layer." Channel workspaces are the "committed" layer.
