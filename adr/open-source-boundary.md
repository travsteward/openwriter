# Open source is the local app; the web version lives elsewhere

## Context

OpenWriter has two forms. The open-source app in this repository (MIT, published to npm as
`openwriter`) is the copy a writer runs on their own computer and adds to their own desktop or
terminal agent. OpenWriter on the web is a separate, paid product: it is not in this repository
and not in the npm package.

On 2026-10-10 parts of the web version were built directly into this repository behind an
environment switch. On 2026-10-11 they moved out, and what the web version needs from this code
became generic extension points that local plugin authors can use too. The commits that added
them stay in the public history; that cannot be undone and they hold no secrets.

## Current invariants

- **This repository holds only the local app**: its editor, its MCP tools, and the plugins a
  local writer runs. No code, test or doc here exists only to run OpenWriter online.
- **Shared needs become generic extension points, never web behaviour.** Each one must make sense
  for a local plugin author or someone embedding OpenWriter in their own program. When it is
  unclear which side something belongs on, it stays out of this repository.
- **The extension points** (all off by default; the local app behaves as before without them):
  - **Data folder**: `OW_DATA_DIR` moves everything that lives in `~/.openwriter`
    (`server/helpers.ts`, read once at load).
  - **Embedding**: `startOpenWriter(options)` (`server/embed.ts`, package export
    `openwriter/server`) starts the server inside another program on a chosen host and port.
    It runs the server only: no client mode, no stdio MCP, no `server.lock`, no browser
    launch; the embedder owns the process and gives it its own data folder.
  - **Request gate**: `requestGate(req)` sees every HTTP request and WebSocket upgrade and may
    refuse it with a status and JSON body. When set it replaces the loopback Host check, never
    sits beside a skipped one (`server/security-gate.ts`, `server/ws.ts`).
  - **Public origin**: `publicOrigin` replaces the loopback Origin check for state-changing
    requests and WebSockets, and is the base URL the server hands out.
  - **Tool filter**: `toolFilter({ name, plugin })` removes tools from every list: the built-in
    registry at start, and each plugin's tools when it is enabled.
  - **Plugin filter**: `pluginFilter({ name, source })` decides which discovered plugins exist.
  - **In-process plugins**: `plugins` passes plugin objects directly; they load beside the
    discovered ones and are enabled at start, as are the discovered names in `enable`. They are
    part of the embedding program: the plugin list shows their `displayName` and no switch, and
    `disable()` refuses them.
  - **Claude key**: `aiKey()` hands OpenWriter the writer's Claude key from the embedding
    program, which then keeps it (Settings > Claude shows no key field; the embedder's client
    module may put its own key controls there with `registerSettingsPanel`); `aiClient` replaces
    the Claude client, building on the exported `defaultClientFactory` to watch calls, or
    standing in for Anthropic in tests. `balanceAccess(call)` says where a call on the
    OpenWriter balance goes (the pinned server, the job header) and its credential, for an
    embedder that builds its own Anthropic client. See `adr/authors-voice.md`.
  - **Format contracts for an embedder's agent**: `appendDocGuidance(session, args, result)` and
    `GUIDANCE_NOTICE` (package export `openwriter/server`) give an embedder's own agent the same
    per-session document format contracts the stdio and client-mode servers deliver
    (`adr/in-system-guidance.md`).
  - **Plugin host**: `PluginHost` (`server/plugin-types.ts`) gives a plugin `saveConfig`,
    `createDocument`, `tools()` (the live tool list, to run OpenWriter's own tools in-process),
    `pendingDocs()`, `documentTitle(docId)` and `rootDir`. A plugin never calls its own server over HTTP.
  - **Client modules**: a plugin's `clientModule: { dir, entry }` is served under
    `/plugin-client/<plugin>/` and imported by the browser at page load. Its default export
    receives the client plugin API (`src/plugins/client-plugins.tsx`): right-rail tabs
    (optionally with a titlebar toggle, optionally holding the rail open while pending changes
    arrive), context-menu panels over a text selection, panels in a Settings section,
    `openRailTab`, `showToast` (one action button or several) and `onConnectionLost`. A client module mounts its own UI into the element it is given.
    A module presenting the app its own way also gets what the app shows (`getApp`,
    `onAppChange`: the editor, the open document, the connection, unsent edits, pending
    documents, GitHub sync status), the app's own actions (`app`: switch, create, flush, rename, and review's
    accept/reject, focus and original preview, through the same code the Review tab uses, and
    `showPending` to point the writer at changes from the plugin's own writing action),
    the app's ProseMirror classes (`pm`) for its editor plugins and decorations, and `tabId`.
    A rail tab may ask to be the one showing on the rail's first run (`openOnFirstRun`), and
    `setUiText` rewords or hides (null) named lines of the app's own copy (`UiTextSlot`), read
    through `useUiText(slot, default)`, which shows nothing until the client modules have run.
  - **First-run documents**: `firstRunDocuments` are written once into a profile folder with no
    documents (`server/first-run.ts`); a `.first-run` marker there means never again.

## Decision log

### 2026-10-11 — web-only code moved out; generic extension points in its place
Rule ratified by the operator: everything on the web is the paid version and never goes in this
repository or the npm package. The environment switch, every branch on it, the web version's
request trust, packaging, browser redirects, interface and their dependencies, tests and ADRs
left this repository. Kept as generic: the data folder setting, the plugin host, two-way GitHub
sync with device-flow sign-in, and the plugin data-folder fixes. The github plugin's start-up
pull became an opt-in setting (`pullOnStart`, env `OW_GITHUB_PULL_ON_START`). Client modules
mount into a plain element rather than sharing the app's React, so a module can use any UI
library and cannot break the app's own tree. Discovered plugins load client modules only at page
load: enabling one later shows its interface after a reload.

### 2026-10-11 — the app bridge for client modules; in-process plugins are required
A client module could add a tab or a menu panel but could not see the open document or drive
navigation and review, so a different presentation of the app (a phone layout, a reader view)
had to fork the app. The client plugin API now carries a snapshot of what the app shows, its
actions, and its own ProseMirror classes: decorations built from a second copy of ProseMirror are
not recognised by the editor. Review actions run through `decorations/review-actions.ts`, shared
with the Review tab, so there is one way to settle a document's review. An in-process plugin is
the embedder's own code: switching it off from the plugin list took down the embedder's routes,
so the list shows its own name and no switch, and the server refuses to disable it.

### 2026-10-12 — A plugin's browser module URL changes with each build

The plugin list hands out each browser module's URL with `?v=` and the file's modified time
(`clientModuleUrl`, `server/plugin-manager.ts`). At a fixed URL a browser, or a proxy in front
of the server, kept the old module for hours after a new build (four hours behind Cloudflare),
and a hard reload does not refetch a module the page imports itself, so a plugin's UI stayed
stale after every deploy. Generic: any plugin with a `clientModule` gets it, locally too.

### 2026-10-12 — The plugin host names documents by title

`PluginHost.documentTitle(docId)` returns a document's title as the sidebar shows it, or null.
Tool calls carry document ids, so a plugin that shows a writer what a tool is doing (an activity
line, a confirm prompt) could only print the id. Generic: any plugin reporting on documents needs
the same lookup, and it reads nothing the writer cannot already see.

### 2026-10-12 — Selection panels show over pending text too

A context-menu panel with `needsSelection` was hidden when the selection touched a pending change,
so a writer could not rewrite text an agent had just proposed until they accepted it. The server
already handles that write: a rewrite over a pending change keeps the change's original (an insert
stays an insert), so reject still restores what was there. Panels now need only a selection.
Comment keeps its own rule and still skips pending text.

### 2026-10-12 — The publish key can come from its environment variable

The publish plugin declares `PUBLISH_API_KEY` as the environment variable for its key, but the
server's platform calls (`server/connections.ts`) read only the saved config, so the variable did
nothing there. They now fall back to it when no key is saved, read on every call. A program
embedding OpenWriter can hand its user's key over without writing OpenWriter's config file.

### 2026-10-12 — Plugins can add a labelled title bar button

`registerTopbarButton({ id, label, title?, onClick })` on the client plugin API puts a button
with words in the title bar, always visible, beside the plugin toggles. A rail tab is the wrong
shape for a plugin's own full screens (a dashboard, a settings page): it is narrow and hides with
the rail. Generic: any plugin with its own screens needs a way in that does not depend on the rail.

- **2026-10-12 — A menu panel stays on screen.** The context menu re-fits itself to the window
  whenever its size changes, not only when it opens: a plugin's menu panel replaces the menu body
  after the first fit and is usually taller, so one opened low on the page ran off the bottom.
  When it does not fit below, it now moves up just enough instead of flipping above the click.

- **2026-10-13 — Author's Voice is a local feature.** The Author's Voice plugin now does all its
  work here, on the writer's own Claude key (rewrite, its voice index, its profile, the document
  transforms that were on the publish server); see `adr/authors-voice.md`. It is local behaviour
  a writer runs on their own computer, so it belongs in this repository. The web version runs the
  same plugin in-process through a generic option, `createAuthorsVoicePlugin({ loadKey })`, for
  an embedder that keeps the key itself. The editor's right-click actions now send the
  document's `docId` beside its file name, so the plugin can search the voice by document.
- **2026-10-13 — The Claude key is an extension point.** Writing in the writer's voice is now part
  of OpenWriter itself, so an embedder hands over the key with `aiKey` instead of passing the
  Author's Voice plugin in-process; `runEditor` is exported for an embedder's own Rewrite UI.
- **2026-10-14 — No new hook for the balance client.** Claude on the OpenWriter balance reuses what
  core already holds for the publish account (`server/connections.ts`: the pinned
  `*.openwriter.io` server and the account key) rather than a plugin hook. It is not web-only:
  a local writer signed in to OpenWriter uses it the same way, and nothing changes for a writer
  with their own key.
- **2026-10-14 — Format contracts reach an embedder's agent.** Document format contracts are
  delivered where an agent's call enters, so a program running OpenWriter's tools for its own
  agent passes each result through `appendDocGuidance` with that agent's session. Generic: any
  embedder with an agent needs it, and it changes nothing for one without.
- **2026-10-14 — `defaultEditorModel` is exported.** An embedder with its own Rewrite UI needs the
  same default the built-in actions use; it is a read of the existing rule, not new behaviour.
- **2026-10-14 — A plugin's server-side right-click item is not run as a voice action.** The editor
  sent every plugin item to `/api/voice/apply-editor`, so a third-party item would have run a voice
  rewrite. Only `voice:` actions go there now; a plugin adds its own editor actions as a client menu
  panel (`registerMenuPanel`), which already has its own handler.
- **2026-10-22 — First-run documents, a first-run rail tab, and rewordable copy.** Three generic
  extension points for an embedder that presents OpenWriter to people who have no agent of
  their own. `firstRunDocuments` writes welcome documents once into an empty profile folder; the
  `.first-run` marker keeps a deleted one from coming back, and a folder that already has
  documents only gets the marker. `openOnFirstRun` lets a plugin's rail tab, rather than
  Activity, be what a new browser sees first; a saved rail state is left alone. `setUiText`
  rewords or hides the lines of copy that tell the writer to ask their agent or set up a
  plugin, each a named slot whose default is today's text, so the local app reads exactly as
  before. The copy itself stays with the embedder.
- **2026-10-22 — Settings panels, several toast actions, the default Claude client.** An embedder
  that keeps the writer's key (`aiKey`) had no way to let the writer see or change it in
  Settings > Claude, which hides the key field for it. `registerSettingsPanel({ id, section:
  'claude', mount })` mounts a plugin's own controls there, above the balance, with a `refresh()`
  that rereads the section after the panel changes the key. `showToast` takes several actions
  (the first drawn as the main one), for a failure with two ways forward. `defaultClientFactory`
  is exported so an embedder's `aiClient` can wrap the real client (to watch for a key Anthropic
  refuses) instead of copying how it is built. Generic: none of it says what the embedder shows,
  and the local app, which registers no panel, looks as before.
- **2026-10-22 — Rewordable copy waits for plugins; Settings > Claude's sign-in line is a slot.**
  `useUiText` shows nothing until every plugin client module has run (the registry's `settled`),
  and the first-run rail shows no tab until then (adr/right-rail.md), so an embedder's wording and
  first tab replace nothing on screen. The Settings > Claude line for a writer with no key and no
  OpenWriter sign-in ("ask your agent to sign you in") is the `claude.signInHint` slot, for an
  embedder whose writers sign in some other way. Defaults unchanged: the local app reads as before.
- **2026-10-23 — `app.showPending` and the `claude.intro` slot.** A plugin offering its own writing
  action calls `app.showPending(nodeIds)` once the server has written the change, which then gets
  what a right-click Enhance gets: the caret at its end, an Accept · Reject bar under it, and Review
  unless a tab holds the rail (adr/pending-overlay-model.md). The first line of Settings > Claude
  is the `claude.intro` slot. Context-menu panels keep the text they act on marked and sit beside
  it, never over it. Generic: the local app's own Enhance uses the same path, and with no plugin
  the app reads and behaves as before apart from the bar.
- **2026-10-23 — `balanceAccess`: where a call on the balance goes.** An embedder that needs
  more of Anthropic's client than `claude()` returns (its tool runner, say) had no way to reach
  the OpenWriter balance without copying how the account key and pinned server are read.
  `balanceAccess(call)` returns the route (`<server>/ai`, the job header) and the account's
  credential, or null when not signed in; `claude()` now uses it, so the two cannot drift. A
  call's job may be any name the server prices. Generic: the local app's calls are unchanged.
- **2026-10-23 — A tool names the plugin that added it.** `ToolDef.plugin` (seen through
  `host.tools()`) is set for every plugin tool and unset for OpenWriter's own, so an embedder's
  agent can choose to offer only OpenWriter's document tools (a smaller request) without keeping a
  list of names. Generic: nothing in the local app reads it.

### 2026-10-23 — the first-run marker names the documents it wrote
`server/first-run.ts` now writes the seeded documents' file names on the marker's lines
after the date. Generic: any plugin that copies the data folder elsewhere (the github
sync plugin keeps them on this copy only) can tell the app's starter documents from the
writer's. The marker still means "first run done"; readers of line one are unchanged.

### 2026-10-23 — the app snapshot carries GitHub sync status
`getApp()` now has `sync`, the same status the app's own sync line shows, so a module
presenting the app its own way can show it too without polling. Generic: a local plugin
that lays out its own screen needs it as much as an embedder; nothing changes for the
local app.

**2026-10-24: the plugin host names the open document and a workspace.** `PluginHost` gains
`activeDocument()` (docId and title of the document tools act on when a call names none) and
`workspaceTitle(filename)`. A plugin that asks the writer before a tool runs (the web chat's
confirm card, or any local plugin with its own approval step) can then say what the call will
touch: "Publish to site: Parity test", "Delete workspace: Parity WS", instead of a bare action
or a manifest filename. Read-only lookups over state OpenWriter already exposes to agents.

### 2026-10-25 — the site screens are local, so they are public
The site dashboard (Your site, Publish, /site/<page>) was built in the web app, but a desktop
writer needs the same screens to publish without an agent, so by this repository's rule it
belongs here: it moved into the publish plugin as its `clientModule` (adr/site-dashboard.md),
and the web app loads it from there. Bundled plugins gain a manifest flag, `enabledByDefault`:
on for a writer who never switched the plugin, while a saved off sticks
(`PluginManager.enableDefaults`). Plugins a writer installs never turn themselves on.

### 2026-10-25 — on by default reads the writer's own switch
`enableDefaults` follows the slot's `turnedOff` (written only when the writer switches a plugin
off), not its `enabled`, which older versions saved as false for every plugin
(adr/plugin-slot-nested-data.md).

### 2026-10-25 — in-process plugins with nothing to set are not listed
Settings > Plugins leaves out a plugin that is part of the embedding program (no switch) and has
no settings: the writer can do nothing with it. Settings tabs can be opened by id through
`openRailTab` ('billing', 'accounts', 'plugins').

### 2026-10-26 — Image sources

`addImageSource(source)` (`server/image-upload.ts`, exported from `openwriter/server` with
`getDataDir`, `getActiveProfile` and `platformFetch`, the publish server as the signed-in writer) lets a plugin or embedder answer for an image missing from
`_images/`; every image read goes through `imageFile`, which asks each source in turn. The github
plugin uses it for images a writing-only copy left on GitHub; an online host can keep images in
its own storage. Without a source the local app reads `_images/` exactly as before.

### 2026-10-26 — Image sources can list what they hold

`addImageSource(source, holdings)` takes an optional second argument: `list()` (every image the
source keeps) and `read(name)` (its bytes, in memory, or null once gone), typed `ImageHoldings`.
Core's `imagesHeldElsewhere()` gathers the ones `_images/` lacks; the github plugin hands them to
the writer's repo (adr/two-way-sync.md). Generic: any plugin or embedder that keeps images in its
own storage gets them into GitHub sync without writing them back to disk. Without holdings
nothing changes.

**2026-10-29: tool labels.** Every MCP tool now carries a title and read-only / destructive
marks (`server/tool-labels.ts`), worked out from its name and whether a plugin added it, and
served by the stdio server and `/api/mcp-tools`. `openwriter/server` exports `toolLabels` so an
embedder serving the tools over MCP itself labels them the same way. Generic: every MCP client
shows the titles and asks before a destructive call, and agent directories require the marks.
