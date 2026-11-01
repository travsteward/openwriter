# Writing in the writer's voice: right-click actions on their own Claude key

Referenced by every module in `packages/openwriter/server/voice/`, the menus that offer the
actions (`src/context-menu/ContextMenu.tsx`, `src/sidebar/DocContextMenu.tsx`) and Settings >
Claude (`src/right-rail/tabs/ClaudeSettings.tsx`). The file keeps its old name so existing
markers resolve.

## Context

Author's Voice began as a separate product: a server (authors-voice.com) that kept a writer's
voice profile and writing samples and rewrote text through an API, metered by credits. The
document transforms (Vary, Shrinkify, Expandify, Threadify, Storify, Emailify, Postify) ran on
the publish server. Both are retired (2026-10-13, operator decision): Author's Voice is now only
right-click actions inside OpenWriter, each a call to Claude on the writer's own Anthropic key.
No API, no agent tools, no credits. Since 2026-10-13 it is plain OpenWriter, not a plugin, and
the Author's Voice name is gone from the app: the actions keep their own names (Enhance, Shrink,
Vary...), the sidebar item is "Learn my voice from this", and the key lives in Settings > Claude.
The web version of OpenWriter keeps the key encrypted itself and hands it over through
`startOpenWriter({ aiKey })`.

The prompts are the refined part and are copied, never paraphrased:
- The editor (Enhance, Modify, Shrink, Expand, Insert, Fill paragraph, Fill sentence):
  Author's Voice's editorPromptBuilders, EditorPromptService instructions and size budgets,
  voicePrompts, the cadence directive and the selection markers (`editor/prompt.ts`).
- Enrichment of the writer's documents: the search engine's GR5 paragraph prompt and its document prompt
  (`voice/voice-prompts.ts`), on the newest Haiku, temperature 0 where the model takes it.
- Retrieval of voice examples: Author's Voice's production engine, coreRetrieve over the search engine's
  queryStore (`voice/voice-retrieve.ts`).
- The voice profile: Author's Voice's analysis (deterministic counts plus one call to the newest
  Sonnet) and its author-blend matcher (the newest Haiku), files copied as they are into `profile/`.
- The transforms: the publish server's transforms module, copied as it is into `transforms/`
  (the newest Sonnet).

## Current invariants

- **No model is named in the code that calls it.** Each job names a line and gets that line's
  newest active model from Anthropic's model list (`models.ts` `modelFor`): rewrites the
  writer's pick (Opus, Sonnet, Haiku), Learn my voice and the blend match Haiku, the voice
  analysis and the transforms Sonnet. The list is read at most daily and kept in
  `<data root>/ai/models.json`; built-in choices apply until the first read. What a model
  accepts comes from its list entry: an effort level, and whether thinking can be turned off.
- **The copied prompts were written for models that do not think.** Their calls go through
  `createMessage`: thinking off where the model allows it; where it cannot be (Sonnet 5.5,
  Opus 5.5), the lowest effort and 8,000 tokens of room on top of the prompt's own length.
  Their temperatures are sent until a model answers 400 to one; that model is remembered and
  called without (Sonnet 5.5 and Opus 5.5 refuse it).

- **Every model call runs on the writer's key** (`host.ts` `claude()`): saved in Settings >
  Claude to `<data root>/ai/claude.json` (owner-only, beside the usage log), or kept by the
  embedding program (`aiKey`, which also hides the key field). A key saved in the old plugin's
  settings is still read until the writer saves one here. No key: a plain "add your key" answer
  (409 `no_key`). The key is never logged, never sent to the browser (only its last four
  characters), and errors pass through `redactKey`.
- **Always on.** The routes are registered by the server itself (`registerVoiceRoutes`), and the
  menu items are built into the editor and sidebar menus, not listed by a plugin. `voice:`
  sidebar actions reach `/api/voice/sidebar-action` through the generic sidebar-action forwarder.
- **OpenWriter starts on any supported Node.** `node:sqlite` is loaded on first use of the voice
  index; only learning the voice and rewriting with examples need Node 22.5 or later.
- **Copied code keeps its text.** Changes to copied modules are limited to imports (file
  endings, the model caller) and the key. A prompt is never reworded here; to change one, change
  it at its source and copy it again.
- **The writer's documents are the corpus.** Right-click a document (or a folder) > Learn my
  voice from this. Paragraphs are OpenWriter's own blocks read through `read_pad`, keyed by node
  id, each tagged by who wrote it from OpenWriter's attribution (human -> Human, mixed ->
  AI-Assisted, agent -> AI, text from before attribution -> Human).
- **The index stores search terms, not the writing**: one SQLite file per profile,
  `<profile>/voice/index.db` (`node:sqlite`, Node 22.5 or later). Contentless FTS5 with English
  stemming; field weights text 1.0, headings 0.4, paragraph enrichment 0.3, document enrichment
  0.1 (the search engine uses 0 there and bridges with a word graph this index lacks; its own note says to
  raise it in that case). Re-adding a document enriches only paragraphs whose text changed.
- **The profile builds itself.** After an add, once the Human paragraphs reach Author's Voice's
  minimum (200 words), the analysis and the blend match run again over all of them and are
  saved to `<profile>/voice/profile.json`. Hand-written skill files in the same folder
  (anchor.md, coined-terms.md, fingerprints.md, stats.md) take precedence over it.
- **Rewrite** follows applyEditor: system examples from the whole document (cached five minutes
  per document, keyed on the voice's state), selection examples minus the system's and minus the
  paragraphs being rewritten. `POST /api/voice/apply-editor` keeps Author's Voice's request and
  response shape. Embedders with their own Rewrite UI call `runEditor` from `openwriter/server`.
- **Transforms** create a new document beside the source (a variant), as before.
- Usage is logged without text: `<data root>/ai/usage.jsonl`.
- **Agents read the voice; they never run or change it.** `get_voice` (`agent-voice.ts`) returns
  the Author's Voice skill's skeleton filled from the same profile and voice files the editor
  reads, plus the writer's Human paragraphs retrieved for the passage (the target document's own
  excluded), ending in a TASK slot. No model call. The avoidance rules come from the profile's
  `avoid` lists, or a hand-kept never-rules.md, which the editor prompt leaves out. Learn my voice
  stays the writer's right-click. `voice-status.ts` gives the one-line status the book guidance
  carries; it reads profile.json and the index directly so the book module never loads the voice
  actions (host.ts reaches the tool registry, which loads the book module).

## Decision log

- **2026-10-13 — Moved into OpenWriter.** The engine, built first in the web version, moves here
  with the profile builder and the transforms; the plugin's old proxy to authors-voice.com and
  its billing routes are removed. Author's Voice kept every document in one store with
  per-document positions, so its adjacency rules crossed documents by accident; here they count
  within a document. The paragraphs being rewritten are never their own examples.
- **2026-10-13 — A host that supplies the key gets no settings.** With `loadKey`, the plugin
  declares no settings at all (it declared an empty list, which did not type-check as a plugin).
- **2026-10-13 — Plain OpenWriter, no plugin, no name.** Operator decision: a writer's own Claude
  key and these actions are core, so the plugin is gone. The code moved unchanged from
  `plugins/authors-voice/src` to `server/voice/`; the key moved from the plugin's settings to
  Settings > Claude; the embedder hook moved from `createAuthorsVoicePlugin({ loadKey })` to
  `startOpenWriter({ aiKey, aiClient })`. Also removed with it: the old Author's Voice credits
  panel and top-up toast (their billing routes were already gone), the `--api-key` / `--av-url`
  flags and `AV_API_KEY` (nothing read them), and the plugin's stale API skill docs.
- **2026-10-13 — A model choice from the old service reads as the default.** The old plugin's
  saved picks ("strongest", "fast"...) are not Claude models here; Settings showed none selected.
- **2026-10-14 — The newest model of each line, automatically.** Operator decision: OpenWriter
  always uses Anthropic's newest models without a release per model. The model list (GET
  /v1/models) gives each model's line, lifecycle and capabilities; each line's newest active
  model is used. The first live read found Haiku 5.5 (a tenth of Haiku 4.5's price), which
  Learn my voice and the Haiku choice now use, and moved the transforms off Sonnet 4.5 before its
  2026-11-30 retirement. Rejected: Anthropic's per-version aliases (they never cross versions)
  and a hand-kept table per model (the edit this removes). Measured on the live models: the
  thinking Sonnet costs about the same as Sonnet 4.5 for six transforms, but Postify thinks
  about 5,500 tokens even at low effort (≈ 7¢ against 1.3¢).
- **2026-10-14 — Without a key, on the OpenWriter balance.** A writer with no Claude key who is
  signed in to OpenWriter (the publish account the scheduler and sites already use) gets Claude
  through OpenWriter's server: `claude({ job, words })` points the same client at
  `<publish server>/ai` with the account key as a Bearer token and names the job
  (`x-openwriter-job`: rewrite, learn, transform; `x-openwriter-words` per enriched paragraph)
  so the server can price it (repo:openwriter-publish/adr/ai-balance.md: free Haiku rewrites, 30
  a day; Learn my voice free for 10,000 words; the rest at twice the cost from a prepaid
  balance). On the balance the default rewrite model is Haiku, the free tier. The server's own
  refusals (`openwriter_*` error types) reach the writer in its words. Settings > Claude shows
  the balance, top-ups, auto top-up and recent charges (`ClaudeBalance.tsx`, routes
  `/api/voice/balance*` passed to the server). Learn my voice now rebuilds the profile once per
  batch, after the last running add, instead of once per document: each rebuild is a paid Sonnet
  call on the balance.
- **2026-10-14 — The balance shows sending charges.** Lists above 2,500 subscribers pay for sending
  from the same balance (repo:openwriter-publish/adr/paid-sending.md); Settings > Claude labels those
  charges "Newsletter sending".
- **2026-10-14 — One rule for the default rewrite model.** `defaultEditorModel()` (`editor/apply.ts`) is
  the model a rewrite uses when the request names none: the writer's Settings > Claude choice, else
  Haiku on the balance or Opus on their own key. `runEditor` uses it, and an embedder with its own
  Rewrite UI reads it to show and send the same default instead of choosing its own (an embedder
  defaulting to Opus charged balance writers for Opus).
- **2026-10-14 — Leftovers of the plugin removed.** The transforms no longer read `AV_FAST_MODEL` /
  `AV_PREMIUM_MODEL` (nothing passed them since the move) and price their cost estimate by line at
  the 5.5 rates instead of falling back to Opus 4.6 rates. The prompt-debug inspector works again:
  `runEditor` returns the prompts it sent and `/api/voice/apply-editor` includes them as `debug`
  only while `OW_PROMPT_DEBUG` is on, which the editor already saves as a `_prompt-*` doc.
- **2026-10-22 — Settings > Claude hosts an embedder's key controls; the starting credit shows.**
  With `aiKey` set the key field stays hidden, but a plugin's settings panels for the Claude
  section now show above the balance (`registerSettingsPanel`, adr/open-source-boundary.md), so
  an embedder that keeps the key can show and change it where the writer looks for it; the panel
  asks the section to reread its settings after a change. `defaultClientFactory` (`host.ts`) is
  exported for an `aiClient` that wraps the real client. The balance panel names a new account's
  starting credit while that entry is among the recent ones, read from the ledger rather than a
  fixed amount, since the server sets it.
- **2026-10-22 — The no-key sign-in line in Settings > Claude is rewordable.** It reads through
  `useUiText('claude.signInHint', …)` (adr/open-source-boundary.md), so an embedder whose writers
  sign in to OpenWriter some other way can reword or hide it; locally it reads as before.
- **2026-10-23 — Settings > Claude reads shorter; the key field is not a password.** The first
  line is the `claude.intro` slot (adr/open-source-boundary.md), so an embedder that explains the
  key in its own panel can reword or hide it; locally it reads as before. The balance says what is
  free today and how the rest is charged in one note, and its email and auto top-up settings read
  as one line each, words then control. The key input keeps its mask and carries the attributes
  that keep browsers' and password managers' save offers off it.
- **2026-10-23 — The balance route is one function.** `claude()` builds its balance client from
  `balanceAccess(call)` (exported, adr/open-source-boundary.md), which holds the pinned server,
  the job headers and the account key; `AiCall.job` takes any job name the server prices besides
  rewrite, learn and transform. Behaviour of every local call is unchanged.

### 2026-10-25 — Settings > Claude is now Settings > Billing
The section became the Billing tab of Settings (adr/right-rail.md). Order: the OpenWriter balance,
then an embedder's key controls and the key field, then the writing model.

### 2026-11-01 — Drafting agents read the writer's voice
Operator decision: an agent ghostwriting a book needs the writer's voice in the context that
writes the prose, the way the /authors-voice skill hands its minion the voice files. Narrows
2026-10-13's "no agent tools" to: nothing an agent calls runs, bills or changes the voice; one
read-only tool hands it over, used by the `openwriter-ghostwriter` subagent
(`packages/openwriter/agents/`). Rejected: delivering the voice once per session with the book
context (a drafting subagent shares the main agent's session, so it would only see the reminder)
and an agent tool that writes in the voice (the retired API, and a second prose path beside the
writer's review).
