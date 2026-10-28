# GitHub is a two-way bridge, and a pull never loses writing

## Context

A writer can run OpenWriter in more than one place (two computers, or another copy of
OpenWriter). One GitHub repo holds their documents, and every copy syncs with it. The
github plugin (`plugins/github/src/git-sync.ts`) used to be a one-way backup: commit the
data folder and push. Two copies pushing to one repo without pulling would reject each
other's pushes, and a copy that starts empty would never see the writer's documents.

Git's own merge is the right engine for text, but its failure modes are wrong for a
writer: a conflict leaves markers in the file or stops the sync, and a merge can
delete a file the writer has open. The rules below keep git's merge and replace those
failure modes with ones that never drop a word.

## Current invariants

- **Sync is commit, fetch, merge, push** (`runSync`). This side's work is saved
  (`save()`) and committed before anything is fetched, so every local edit is in a
  commit before a merge can touch the folder.
- **Every merge stops before its commit** (`git merge --no-commit`), so the rules
  below run on it; a fast-forward needs none of them.
- **A document both sides changed merges paragraph by paragraph, newest edit wins**
  (`mergeDocument`, `doc-merge.ts`). Frontmatter merges key by key (a key both changed
  takes the side whose file changed last). The body goes through
  `git merge-file --diff3`; each hunk both sides changed is settled by edit time:
  `git blame` of each side gives every line's author time (commit-on-save makes that
  the edit time, offline edits included), a hunk with equal line counts is settled
  line by line, any other hunk goes to the side with the newer line, ties keep this
  side. Push order never matters. No conflict copies are made for documents.
- **A replaced paragraph is never silent.** Each one is written into the merge
  commit as an `OpenWriter-Replaced: {json}` line (doc, kept lines, earlier lines,
  winning device and time, losing device id). After every merge or fast-forward,
  the device whose id lost turns those lines into notices (`sync-notices.ts`, in
  `.git/openwriter-notices.json`, never synced), shown on the paragraph as "Updated
  from <device>, <time> · Undo · See earlier version" (`sync-notice-plugin.ts`).
  Undo (`undoNotice`) writes the earlier lines back as a new edit; the other version
  stays in history. A paragraph being typed in is never replaced: pulls wait while
  the writer types, and typing that lands while a pull already runs is kept. The
  pull names the open doc as it committed it (`setPullBase`); both reloads it
  causes (the file watcher's and `reloadChangedFiles`') carry that copy, and the
  browser puts back every paragraph changed since it (`keepTypedBlocks`) and saves
  them as a normal edit.
- **Pending changes merge entry by entry** (`mergePending`): an entry that existed at
  the merge base and is gone on either side was decided and stays gone, new entries
  from both sides are kept, an entry both changed takes the newer side. This runs on
  every `_pending/*.json` both sides changed, conflicted or not, and a missing file
  counts as no entries. When the two devices decided the same change differently,
  the side whose pending file changed later wins (`settleDecisions`): a later reject
  puts the original paragraph back, a later accept puts the suggested one.
- **Append-only logs union-merge.** The synced `.gitattributes` has
  `_history/*.jsonl`, `_commits/*.jsonl` and `*.log` as `merge=union`, so both
  devices' lines are kept and these never clash. Union, not per-device files,
  because readers already handle one file per document.
- **Any other file both sides changed keeps this side's version**; GitHub's is saved
  under `.sync-conflicts/<stamp>/<path>`, which the app never loads.
- **Deletes.** A delete wins unless the other device edited that document since
  (git's modify/delete conflict, settled to the side that has it). An open document
  deleted elsewhere closes (`reloadChangedFiles` returns `deletedActive`; the plugin
  calls `deleteDocument`, which moves to a neighbour) with a notice "“Title” was
  deleted on <device> · Undo"; Undo restores it from the commit before the merge.
  Only when it is the last document is it kept.
- **First connection.** Connecting a repo merges with
  `--allow-unrelated-histories`. When the data folder has no writing yet (every
  `.md` body is empty, first-run documents aside), GitHub's files win outright
  (`-X theirs`). A folder with writing merges by the rules above with an empty base,
  so a document on both goes to the newer side and the other stays in history.
- **The running server picks up a pull without a restart.** `reloadChangedFiles` in
  `server/state.ts` drops the cache entry of every changed file, reloads the active
  doc like an external write (`document-reloaded` to its tabs), pushes other docs to
  their viewers (`onDocFileWritten`), and the plugin then broadcasts the document
  list, workspaces and pending docs.
- **One sync at a time.** A second call waits for the running one, then runs (so a Sync
  click during the start-up pull still pushes).
- **Credentials.** One token store: `<root>/github-token.json` (outside the synced
  folder, mode 0600), written by device flow or a pasted PAT; an older install's
  `config.gitPat` is read until a new token replaces it. Every fetch and push gets the
  token through the inline credential helper and `OW_GIT_PAT` env var. It is never in
  the remote URL, `.git/config`, argv or logs. Network git never prompts
  (`GIT_TERMINAL_PROMPT=0`).
- **Device flow** (`device-flow.ts`) needs only the public client id of a GitHub OAuth
  App with device flow enabled; there is no client secret. Every copy has it: OpenWriter's
  own app id (`Ov23liCYclIOzGfwgfAH`) by default, `OW_GITHUB_CLIENT_ID` to use another.
  The browser polls `/api/sync/device/poll`; the server runs no timer.
- **One setup path, one repo.** Setup is sign in, name this device, then connect.
  After sign-in `/api/sync/repos` (`findDocsRepos`) lists the writer's repos that
  already hold OpenWriter documents (the committed `.openwriter` marker, or
  `_doc-order.json` / `_workspaces` / `_pending` / `_history` at the top, or an empty
  `openwriter-docs`) with their document count. When one exists the primary action is
  "Use <repo> (N documents)" (setup method `use`, the existing-repo path); creating a
  new repo is the secondary choice, so a second device never makes a second repo by
  default. GitHub CLI, a pasted token and a pasted address are "Other ways to connect".
- **Every commit is signed by its device.** The device name and a random id live in
  `.openwriter-device.json` in the data folder, never synced (`.git/info/exclude`,
  with `config.json` and `.versions/`). Commits and merges run as
  `user.name=<device name>`, `user.email=<id>@device.openwriter`, so history can say
  which device made a change. The name is asked at setup, prefilled from
  `OW_GITHUB_DEVICE_NAME` (a hosting program's choice) or "<first name>'s computer".
- **Sync is automatic, and only a connected browser drives the pulls.** A recursive
  watch on the data folder (`startAutoSync`) commits every save about 1.5 s later, as
  this device, with no network, so commit time is edit time and offline work is
  already committed. A one-shot timer armed by that commit syncs (fetch, merge, push)
  20 s after the last save. The browser (`useAutoSync`) pulls (`/api/sync/pull`) when
  the app opens, on window focus, as a document opens (alongside it, never before it),
  and every 60 s while visible, and sends `/api/sync/push` by `sendBeacon` when the
  page closes. Nothing repeats on the server, so a copy with no browser and no writing
  runs no timers. `pullOnStart` (env `OW_GITHUB_PULL_ON_START=1`) still pulls once at
  start-up. A push happens only when this copy is ahead of GitHub.
- **Nothing changes under the writer's cursor.** `debouncedSave('human')` stamps the
  last browser edit (`msSinceHumanEdit`); a pull within 3 s of it returns `deferred`
  and the browser asks again 4 s later, and the push timer waits the same way. The
  open document is reloaded in place only after the pause.
- **This copy's own files never sync.** `.git/info/exclude` (local to the folder) lists
  `config.json`, `.versions/`, `.openwriter-device.json`, `.first-run`, `server.lock`,
  the voice index `voice/index.db` with its `-shm` / `-wal` journals (each copy builds
  its own from the documents), and the documents named on the first-run marker's later lines (the "Start here"
  document an embedding program seeds). One an older version committed is dropped
  from the repo with `git rm --cached` and kept on disk; around every merge these
  files are snapshotted and written back if the merge removed them.
- **Configured means this folder has a remote.** Status reads the data folder (a git
  repo with `origin`), not the shared config, so each profile syncs on its own; the
  last sync time lives in `.git/openwriter-sync.json`.
- **Status in the writer's words.** `/api/sync/status` and the `sync-status` broadcast
  carry `state` (`synced`, `pending`, `syncing`, `offline`, `error`, `unconfigured`),
  `lastSyncTime`, and for a failure `error` plus `fix` (`signin`, `setup`, `retry`).
  `describeSyncError` maps git's output: no network is `offline` ("Offline, saved
  here, will sync", retried in 60 s), a refused credential is "GitHub sign-in expired"
  with `signin`. Git output never reaches the browser. The status line
  (`SyncButton.tsx`) shows "Synced N min ago", "Syncing…", the offline line, or
  "<reason> · <fix>"; its click opens setup when the fix is to sign in or connect.

- **History and rollback live in the app.** The Versions tab's synced section
  (`SyncHistory.tsx`, `/api/sync/history/:docId`) lists the open document's commits
  (`git log --follow`) as "<device> · <time>"; Restore writes that version's body
  under the current name and id as a new commit. "Roll back everything to…" picks a
  time, previews the documents that would change by title (`GET /api/sync/rollback`),
  then restores every tracked file from the last commit at or before it
  (`git restore --source`) as one new commit, so the rollback can itself be undone.

- **A writing-only copy has every name and all the writing; images stay on GitHub
  until shown.** A copy started with `OW_GITHUB_IMAGES_ON_DEMAND=1` (an online copy
  on a small disk) connects as a partial clone (`blob:limit=256k`: history and text
  come down, big files stay on GitHub) with sparse checkout `/*` `!/_images/`, so
  images are index entries marked not-here (skip-worktree). The repo's own config
  (`remote.origin.promisor`) says a folder is writing-only from then on. Commits use
  `git add -A --sparse` so a new image made on this copy goes in; a missing image is
  never staged as a deletion. Every git call carries the sign-in (`gitAuth`), since
  any command may need to fetch a file it lacks.
- **Every image read goes through core's `imageFile`** (`server/image-upload.ts`):
  `_images/` first, then the plugin's image source. The github plugin registers
  `writingOnlyImage`: the image's blob (as now, or before a later delete) from
  GitHub's blob API, else from .git (this copy's own, not yet pushed), cached in
  `.git/openwriter-images/` (never synced) up to 256 MB, least recently shown first
  out; a pull that changes an image drops its cached copy. The `/_images/` route,
  newsletter and X uploads, and blog publishing all read through it. Rollback on a
  writing-only copy restores the writing; images keep their current version.
- **Images another source keeps go into the repo** (`handOverImages`). When a copy's
  image sources can list what they hold (`addImageSource(source, holdings)`, read
  through core's `imagesHeldElsewhere`), every one that neither `_images/` nor the
  repo has goes to GitHub through its Git Data API: each image read from its source
  and sent as a blob on its own, a tree on the commit this copy just pushed, a commit
  signed by the device, a ref update that never forces. Nothing is written to the
  folder or to .git; the copy gets the commits on its next pull. Commits hold 50
  images, so a stop partway keeps what went up. It runs after the connection's push
  and after any sync that leaves this copy even with GitHub, until
  `.git/openwriter-images-handed.json` says it is done; a new connection starts over.
  A failed handover never fails the sync.
- **A connection that stops partway leaves the folder as it was and unlinked**
  (`undoConnect`): merge aborted, reset to the commit made just before, GitHub's
  half-written files removed, remote and sparse checkout removed, the download
  pruned. Nothing half-brought-in can be pushed back as deletions.

## Decision log

### 2026-10-10 — two-way sync with conflict copies
Chosen: git merge plus a conflict-copy rule, over last-writer-wins (loses the other
side's text) and over leaving conflict markers (writes git syntax into prose and
breaks the frontmatter). Conflict copies are committed so the other copy gets them on
its next sync and the writer can settle them from either place. Pull is
writer-triggered (Sync) plus once at start-up, never on a timer: a Machine that stops
when idle would wake for nothing, and a timer merging under an open editor is the
race this design avoids. The client id comes from `OW_GITHUB_CLIENT_ID` because
`openwriter-publish` has no code using a GitHub App or OAuth App today; the operator
creates an OAuth App with device flow enabled and sets the id where OpenWriter runs.

### 2026-10-11 — start-up pull is a setting, not a mode
The start-up pull ran only in a mode for OpenWriter's web version, which has left this
repository (adr/open-source-boundary.md). It is now the plugin's `pullOnStart` setting
(env `OW_GITHUB_PULL_ON_START`), off by default, so any copy that is often started after
edits elsewhere can use it. The blog tools are always offered; a program embedding
OpenWriter can drop them with its tool filter.

### 2026-10-23 — one setup path that finds the existing repo; device names
A UX roleplay found a second device creating a second repo (the sign-in path only
offered "create"), and history with no way to tell devices apart. Setup now signs in
first, then looks for repos that already hold OpenWriter documents and makes using one
the primary action. Detection reads each recent repo's top-level listing (one API call
each, the 30 most recently pushed) rather than a GitHub topic, because older repos carry
no marker; new ones get a committed `.openwriter` file. Device flow is offered on the
desktop too, with OpenWriter's public client id as the default. The device name is the
commit author, not a synced file, so history keeps it with no extra format to merge.

### 2026-10-23 — automatic sync, a status line, and app files kept local
Writers forgot to click Sync. Saves are now committed by a folder watch and sent after a
20 s pause; the browser pulls on open, focus, document open and every minute. The
2026-10-10 rule against timers was about waking a sleeping machine and merging under an
open editor: pull timers live in the browser (no browser, no timers), the server only
arms one-shot timers after a save, and every pull waits while the writer typed in the
last 3 s. A folder watch was chosen over hooking each server write path, because docs,
pending changes, workspaces and images are written from many places. The Sync button
became a status line with plain reasons and fixes; the pending-files list, which showed
internal paths, is gone. Configured state and the last sync time moved from the shared
config into the folder, because a pinned profile never writes the config and every
profile shares it. `.git/info/exclude` keeps this copy's own files out of the repo
without a synced rule that would also hide them on another copy.

### 2026-10-23 — newest edit wins per paragraph, with notices; no conflict copies for documents
Conflict copies piled up: every doc both devices edited conflicted on its one-line JSON
frontmatter (`nodes` changes on every save), and the writer had to merge copies by
hand. Documents now merge per paragraph and per frontmatter key, and a paragraph both
changed goes to the newer edit by blame author time, which commit-on-save makes the
edit time. Push order was rejected as the rule: an offline device that sends late
would lose newer writing. The loser is told by a notice with Undo, carried in the merge
commit message so the device that loses is told even when the other device did the
merge; a synced notices file was rejected because it would itself need merging.
Pending changes merge by entry so a decision is never undone by a merge, and a
decision conflict goes to the later pending-file change. Logs union-merge rather than
splitting per device, which would change every reader. Deleting the open document now
wins over the old "write it back" rule, which made deleted documents return.

### 2026-10-23 — history and rollback in the app
Writers had no way back inside the app once a sync changed things. The Versions tab now
shows GitHub history per document by device and time, with Restore, and "Roll back
everything to…" with a preview count. Both are new commits rather than resets, so
nothing is lost and every other device receives the restore like any edit. The local
`.versions` snapshots stay as they were; synced history sits beside them.

### 2026-10-23 — fixes from the two-copy browser check
A browser check with two copies on one test repo turned up four things. The voice
index's open-database journals (`voice/index.db-shm`, `-wal`) were synced; they only
mean something to the process holding the file, so they are local-only. Two devices
editing one document clashed on its `_blame/` attribution cache and left a copy in
`.sync-conflicts`; that cache is rebuilt from `_history`, so ours is kept with no copy.
The "deleted on <device>" notice blinked out during every sync because the syncing
status carried no notices; it now does. The device name field under "Other ways to
connect" starts with the suggested name, as the sign-in path already did.

### 2026-10-24 — the voice index stays on each copy
The voice index database (`voice/index.db`) was still synced; only its journals were
local. It is a binary SQLite file that git cannot merge, it changes whenever Learn my
voice runs, and each copy rebuilds it from the documents, so two copies would clash on
it and push megabytes on every run. It joins `LOCAL_ONLY`: a repo that already holds it
drops it with `git rm --cached` and every copy keeps its own. The voice profile
(`voice/profile.json`) and the `_blame/` attribution cache keep syncing as before: the
profile is the writer's, and the blame cache already keeps ours on a clash. Test:
`packages/openwriter/scripts/test-github-sync.mjs` ("The app's own files never sync").

### 2026-10-26 — the online copy is writing-only, and a failed connect undoes itself
The first real connection of the online copy (1 GB disk) to a 852 MB documents repo
with 375 MB of history filled the disk partway through checkout and left the folder
half-written but still linked, so the next commit could have pushed the missing files
as deletions. Measured: images were 656 MB of 685 MB of files; all the writing was
about 25 MB. Chosen: git's own partial clone and sparse checkout over a hand-built
placeholder scheme (one sync engine for both copies) and over downloading text on
demand too (search, Claude and merges need every document's words; it would save
25 MB). Image bytes come from GitHub's blob API rather than a lazy git fetch so the
cache can be trimmed (fetched objects in .git cannot be). A safe undo on any failed
connect, for every copy, replaces "a full disk leaves a broken link". Test:
`test-github-sync.mjs` ("A writing-only copy ...").

### 2026-10-26 — images kept elsewhere are handed to the repo
An online copy that moves images off its small disk into its own storage (before the writer
connects GitHub) left them out of the repo, so a desktop copy showed them missing. Image sources
may now list what they hold and hand over bytes in memory; the github plugin sends each one
to GitHub's Git Data API. A local commit was rejected because it writes every image back to
the disk the online copy moved them off. The handover runs after the connection's push rather
than before its fetch: GitHub's API cannot add a blob to an empty repo, and the commit just
pushed is a known parent that already holds this copy's writing. It retries on later syncs
because a network stop or GitHub's rate limit should not fail a connection, and stops for good
once done so an image later deleted from the repo is not brought back. Test:
`test-github-sync.mjs` ("Images another source keeps ...").

### 2026-10-27 — a document opens at once; the pull runs beside it
Waiting up to 0.8 s for GitHub before asking for the document made every open take about
0.9 s, since a fetch always takes longer than that. The pull now starts as the switch is sent.
If GitHub had a newer copy of that document, the server already reloads the open document in
place (`reloadChangedFiles`), so nothing is lost by not waiting. A pull already running is not
started again, so clicking through documents starts one pull, not one per click.

### 2026-10-27 — typing during a pull is kept
Opening at once moved a pull to the moment the writer starts typing. A pull checks for typing
only when it starts, so keystrokes made while it fetched and merged were replaced when the open
document reloaded. A two-copy check on the Test profile (a local bare repo for GitHub, a second
clone pushing an edit, 97 characters typed through the pull) lost 18 of them. The fix sends the
copy the pull committed with the reload; the browser keeps every paragraph changed since it and
saves the result. Waiting for the pull before showing the document was rejected (that was the
0.9 s delay), and so was holding the reload until the writer pauses (the merged file is already
on disk, so the next save would write the old copy over it). Both reloads had to carry it: the
file watcher reloads first, as soon as git writes the file. Paragraphs pair by id, else by
their words, because a file written without ids gets new ones on load; without that the typed
paragraph came back twice. Reruns kept all 97 characters and took the other copy's edit. Test:
`test-github-sync.mjs` ("Typing that lands while a pull runs ...").

### 2026-10-28 — an expired sign-in in the setup window leads to Sign in
The setup window showed "GitHub sign-in expired. Sign in again." above the create-a-repo form,
with no way to sign in from there. `findDocsRepos` now marks its sign-in errors (`signIn`), the
repos route answers them with 401 and `signIn: true`, and the window drops back to its signed-out
view: the Sign in with GitHub button with the reason above it. The window's colors also moved to
the theme's tokens so it reads in dark mode.
