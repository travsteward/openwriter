# Rules for using a system live in the system and arrive at use

## Context

How an agent must write an X document in OpenWriter (where thread posts split, how paragraphs
and line breaks are stored, where images go, what the reply URL is for, why a doc titled
"Quote Tweet" needs a real name) used to live in a writing skill, /x-writer, beside its voice
and strategy advice. An agent that wrote an X document without opening that skill, or opened
it and skipped the mechanics doc, got the format wrong. The skill also drifted from the app:
by 2026-10-14 it still said markdown `---` makes no rule, markdown images do not work, threads
must not use populate_document, and inserts sharing an anchor land in reverse. None was true
any longer.

## Current invariants

- **Operator decision (2026-10-14):** rules for using a system the operator owns live in that
  system and arrive when the agent touches the relevant object. Skills keep only judgment,
  strategy and cross-system workflow. X documents are the pilot.
- **Contracts are versioned files shipped with the app:** `packages/openwriter/server/guidance/
  <name>.md`, each with `version: N` frontmatter, copied to `dist/server/guidance` by
  `build:guidance`. `server/doc-guidance.ts` maps a content_type to its contracts: tweet,
  reply and quote get their own plus `x-post` (the post body) and `thread`; article gets
  `article`; blog and newsletter get their own plus `long-form` (the body and what leaves
  OpenWriter when it is published). Every type also receives the shared `editing` contract.
- **Written as facts about the document**, not commands: what the document is, how its parts
  are stored and rendered, and what each tool does to it. A fact is only written after it is
  checked against the current code; the contract changes with the code it describes, and its
  version moves when its meaning does.
- **Once, then a reminder, per agent session.** The first tool result that touches a document
  of a contracted type carries every contract for that type not yet sent in full to that
  session; each later touch carries one line naming the contracts and versions. Delivery is
  tracked as name@version, so a new version is sent again in full.
- **A touch** is a call naming the document by docId, or a create_document / open_file whose
  result announces it. Error results get nothing.
- **Delivered where an agent's call enters, never inside the tools**
  (`appendDocGuidance(session, args, result)` in `server/mcp.ts`): the stdio MCP server (one
  session per process), `/api/mcp-call` when the caller names its session in the
  `X-OpenWriter-Session` header (the client-mode proxy sends a per-process id; the editor's
  own HTTP calls send none and get nothing), and an embedder's own agent through the
  `openwriter/server` export. OpenWriter's internal callers (voice indexing reads documents
  through read_pad) must not use up an agent's delivery or see contract text.
- **The contract is an extra content block** after the tool's own result, so a caller reading
  `content[0]` (JSON results, compact reads) is unaffected.
- **Instructions say contracts arrive with the document** (`GUIDANCE_NOTICE`). The local MCP
  server and client-mode proxy send `LOCAL_AGENT_NOTICE`: the few norms a local agent needs
  before it touches any document (writing for the user goes into a document, the user's browser
  view is shared so the agent never opens the editor itself, a document mentioned to the user
  is linked with get_doc_link), then `GUIDANCE_NOTICE`. Embedders append only `GUIDANCE_NOTICE`
  to their own instructions: a hosted chat has no browser of the writer's and get_doc_link
  answers with an address that only works on the machine running OpenWriter.
- **OpenWriter has no skill.** An agent with only the MCP server gets everything it needs from
  tool descriptions, the server instructions, contracts and tool results. Nothing installs or
  offers a skill; `openwriter setup` installs the package, the MCP registration and the two
  background subagents (`packages/openwriter/agents/`), and removes a copy of the old skill
  that an earlier setup wrote.

## Decision log

- **2026-10-16** — Book membership adds role-specific contracts at the same
  agent boundary. Accepted brief text and direct-source revisions refresh when
  their fingerprint changes; generic method remains deduplicated by version.
  Shared documents require explicit book context, never browser-state inference.

- **2026-10-16** — Moved the agent-boundary envelope from the large MCP registry
  into mcp-guidance.ts, re-exported under the same name. Delivery behavior is
  unchanged; book context can be added at this single boundary.

- **2026-10-14** — Built for X documents. Rejected: patching each document tool (many sites,
  and plugins' tools would miss it); wrapping the handlers in the registry (voice indexing
  and plugins run the same handlers in-process and would consume the once-per-session
  delivery); once per server process (the local server outlives agent sessions and the hosted
  server serves many chats, so a later session would only ever see the reminder). /x-writer
  lost its mechanics doc and DOC-CONVENTION section; its voice, hooks, strategy and pipeline
  stay. Candidates for the same treatment: newsletter, blog (blogContext, cover image path,
  paywall marker), linkedin, manuscript binding docs.
- **2026-10-14** — Blog and newsletter documents get contracts through the same delivery
  (`blog`, `newsletter`, shared `long-form`); the reminder names each type by its own noun
  instead of "an X <type>". Checked against the code, much of /blog-writer and
  /newsletter-writer was stale: set_metadata merges blogContext one level deep (a partial
  update keeps lastPublish); markdown headings, rules and images parse to real nodes; no
  send_newsletter tool exists (an issue is sent with publish_to_site send_email, subject from
  the title, preview line from the subtitle); post_to_blog publishes the active document and
  ignores pending changes without warning. Both skills lost those mechanics and keep voice,
  beats, titling, editorial judgment and pipeline. Gaps the contracts state as facts rather
  than fix: insert_image set_cover writes articleContext (no blog cover), the newsletter
  editor's Subject and Preview fields are not read by publish_to_site, and the Schedule button
  on both views queues a social post. Still without contracts: linkedin (linkedinContext,
  post length and formatting on LinkedIn, how schedule_post sends it) and manuscript
  (chapter binding, compile and export).

- **2026-10-15** — A shared `editing` contract applies to every document, including plain
  documents and manuscripts. It explains optional per-block review notes, useful editorial
  reasons, omission for routine cleanup, and note replacement/removal. The tool field itself
  carries short guidance so an agent's first write can already use it correctly. The existing
  session/version envelope deduplicates editing independently of each format contract;
  internal calls still receive nothing and do not consume delivery.

- **2026-10-23** — `editing` v2 carries the block-edit facts the bundled skill held under
  Writing Strategy: write_to_pad and edit_text send only changed blocks while
  populate_document takes a whole body; a plain-text rewrite keeps the block's type
  (block-changes.ts); rewriting a pending block replaces its proposal against the accepted
  text, and a pending insert stays an insert. An embedder's agent that does not load the skill
  still gets them at first touch.

- **2026-10-26** — Retired the /openwriter skill (operator: eliminate the skill and let the
  agent discover what it needs as it uses OpenWriter; point people at installing OpenWriter,
  not the skill). Audit of the skill against what the system already delivers: its tool
  tables, read ladder, two-step creation, placement, variants, enrichment and sort procedures
  were already in tool descriptions and notices; its publish section was stale (send_newsletter
  does not exist; userSignaledReview is not returned). Moved into the system: the working
  norms (writing goes in a document, never open the editor in a browser, link with
  get_doc_link) into GUIDANCE_NOTICE; `editing` v3 adds what re-populating does (keeps every
  existing block and adds the body, so it duplicates), pendingChanges and autoAccept, why
  generic titles get renamed (and that an agent retitle is proposed), and footnote syntax;
  populate_document and get_comments descriptions carry the same facts at the tool; the sort
  signal names the inline fallback for harnesses without the subagent. Dropped as judgment
  owned elsewhere or not about using OpenWriter: book-workspace organising (/book-writer),
  companion-skill install lines, the first-run welcome document, the tasks reminder.
  Removed `skills/openwriter`, `packages/openwriter/skill`, `claude-plugin/skills`, the skill
  copy in prepublish, and install-skill.ts (now setup.ts, `install-skill` stays as an alias).
  The subagents moved to `packages/openwriter/agents/`, the one source for setup, the npm
  package and the Claude plugin.

- **2026-10-26** — Split the local-only norms out of `GUIDANCE_NOTICE` into
  `LOCAL_AGENT_NOTICE`, sent only by the stdio server and the client-mode proxy. The hosted web
  chat appends `GUIDANCE_NOTICE` to its own instructions, and v0.51.0's version told it to link
  documents with get_doc_link, which inside the hosted machine returns a localhost address the
  writer cannot open. The local agent's instructions are unchanged.

- **2026-11-01** — A book carries its whole method (operator: a writer who connects any agent
  must get a book planned, ghostwritten in their voice and edited with them, with no skill
  installed). `GUIDANCE_NOTICE` names how a book starts (create_workspace, then
  configure_book_workspace with createBrief and createOutline), since guidance only arrives once
  a book exists. `book` v2: who owns what (the author's substance and every lived story; the
  agent's structure, research and drafting), interviews one question at a time, no deletion
  without approval, sourced facts, the order of work with when each step is done, the next-step
  rule, dump to beats, and drafting in a fresh context through get_voice and the
  `openwriter-ghostwriter` subagent, with an inline fallback. `book-brief` v2: the interview and
  the voice setup. `book-outline` v2: chapter planning and the compile facts (heading levels,
  dividers, demoted source headings, {{toc}}, membership by link), checked in
  `manuscript/assemble.ts` and `parse.ts`. `book-manuscript` v2: the editing stages and the
  comment pass. Distilled from the operator's /book-writer, /book-editor and /authors-voice
  skills and made generic; harness orchestration, corpus research and book canon stay there.

- **2026-11-01** — Book guidance is infrastructure, not a method (operator: it must not lock a
  writer into one way of making a book; generic, useful, non-blocking). v3 of `book`,
  `book-brief`, `book-outline` and `book-manuscript` keep three layers apart: how the book
  pieces work (compile, manuscript, review, versions, voice), the rules that always hold (the
  writer's substance and life are never invented, approval, no deletion, sourced facts, state
  read from the book), and ways to help offered when the writer wants them (interview or dump,
  planning, breaking a chapter into moves, an editing menu). The writer's arrangement
  (ghostwriting, co-writing, editing their draft, organising; outline-first, draft-first or an
  existing manuscript) is recorded in the brief's new How we work section, and nothing is a
  gate: the agent never refuses or delays requested work because another step is not done.
  Removed from v2 as one operator's method stated as rules: the fixed order of work,
  plan-before-drafting, one document per beat, the one-argument/complete-picture classification,
  claim-style chapter names, the teaching-book hook and lay-reader glosses, and the fixed six
  editing stages with their cap.

- **2026-11-01** — The removed method returns as its own contract, `book-method` v1, delivered
  only when the book's setting is Guide me step by step (the default; `guidanceFor` takes a
  guided flag from the book context). Switching to I'll lead drops it from the reminder list, and
  the changed book context says the method no longer applies. `book` v4 names the setting and
  takes the editing passes and comment pass from `book-manuscript`, because a clean test showed an
  editing-only writer's agent never received them: that contract only arrives once a manuscript
  exists. `book-outline` v4 states the link format and that an outline the agent writes is a
  proposal, so the build waits for the writer to accept it. `book-brief` v4: How we work is the
  writer's description, not the switch.

- **2026-11-01** — The setting is named Workflow, Guided or Custom (operator: software-style
  option names). `book` v5, `book-method` v2 (headed OpenWriter book method) and `book-brief` v5
  use those names; the book context line reads "Workflow: Guided" or "Workflow: Custom".

- **2026-11-01** — From a clean roleplay of a new cookbook writer: `book-method` v3 asks only the
  part of "what kind of book" the writer's words have not settled, in their terms, after the
  agent found "fiction or nonfiction?" robotic for a cookbook. A touch that names a workspace file
  instead of a document is headed "a workspace" (a `workspace` entry in CONTRACTS with no
  contracts of its own), where it used to say "a document".
