# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Deleting the open document keeps the sidebar at your current folder while the editor opens the remaining document, avoiding jumps through nested folders.

## [0.40.3] - 2026-07-09

### Fixed
- **Agent-created documents reliably land where they belong.** When an agent creates a document into a workspace or folder, it now goes there dependably; a create that names a workspace or folder that can't be resolved fails clearly instead of leaving the document unfiled and invisible. Placement can be given by name or by id, and the result always states where the document landed.
- **Sidebar selection after delete, and multi-select drag.** Deleting a document now moves the selection to an adjacent document instead of clearing it, and dragging a multi-document selection moves the whole selection together.
- **Archive and Delete confirmations no longer overlap.** In the sidebar context menu, opening one confirmation closes the other, so both prompts never show at once.

## [0.40.2] - 2026-07-05

### Fixed
- **Republish of 0.40.1 with plugins included.** The 0.40.1 package was published without its bundled plugins and is deprecated; 0.40.2 is the same fix, packaged correctly.

## [0.40.1] - 2026-07-05 [YANKED]

### Fixed
- **Blog posts with inline images no longer break Astro site builds.** `post_to_blog` now always writes inline body images as absolute public paths (`/images/...`); on sites configured with relative image paths, body images previously came out slashless and failed the site build until hand-edited. Cover images are unchanged and still follow the site's configured path style.

## [0.40.0] - 2026-06-30

### Added
- **Publish X Articles natively.** The article compose view now has a **Post to X** button that publishes your long-form Article straight to X — title, cover image, and formatting (headings, bold/italic, links, lists, blockquotes, code) carried over — instead of copy-pasting into X's web editor. Works on both the managed Publish path and the direct bring-your-own-key X plugin; **Copy as HTML** stays as a fallback.

## [0.39.0] - 2026-06-17

### Added
- **Change a quote-tweet's or reply's target URL mid-draft.** In tweet compose, you can now swap the quoted or replied-to tweet to a different URL without losing your draft — paste a corrected link and the embed reloads in place, text intact.

### Fixed
- **Auto-title rename no longer disrupts an open quote-tweet.** Saving a QT draft no longer renames the doc from its body text, which had reloaded the active embed and could drop the text you were writing.
- **Fonts now render correctly offline and behind content blockers.** OpenWriter previously loaded its typefaces from Google Fonts; if that was unreachable — offline, restricted network, or a privacy/ad-blocking browser extension — all text silently fell back to system fonts and looked wrong. Fonts are now bundled with the app, so the editor and sidebar always render in their intended typefaces.

### Removed
- External Google Fonts dependency — all webfonts are now self-hosted in the app.

## [0.38.0] - 2026-06-15

### Added
- **Manuscript content type — compile a whole book from your atomic docs, without flattening them.** A manuscript is an ordered *binding*: a doc whose body lists `doc:` pointers grouped under chapter headings. The engine resolves every pointer, assembles one master document (footnotes renumbered across chapters, each doc's headings nested correctly), and renders it — so editing a beat updates the book and the atoms stay atomic. Preview it in-app or export to **EPUB** (KDP-ready), **HTML**, **DOCX**, or **Markdown**.
- **Manuscript controls in the right rail** — a Manifest ⇄ Preview toggle, a paragraph-style choice (Spaced or Indented), one-click downloads in every format, and an always-on launcher listing every manuscript so you can open one to read at any time.
- **Chapter navigation in the preview** — a slim left-edge tick-rail (one tick per chapter, current chapter highlighted as you scroll, click to jump) plus a clickable `{{toc}}` contents list.
- **The manifest owns the book's heading hierarchy** — declare chapters (`##`), sections (`###`), and sub-sections in the manifest; beats stay pure prose with no headings baked in.
- **`compile_manuscript` and `export_manuscript` MCP tools** — compile a book (with per-chapter word counts and any unresolved-pointer warnings) or export it to a file, without the browser.

### Changed
- The manuscript preview follows your in-app Appearance (light/dark) rather than the OS theme; exported EPUB/HTML stay print-light.

## [0.37.1] - 2026-06-14

### Security
- Important security hardening for the local OpenWriter server and its plugins, following a thorough internal security review. **We strongly recommend all users update to this version.** Out of caution for users still on older versions, we're not detailing the specific changes here.

## [0.37.0] - 2026-06-13

### Added
- **Author attribution.** See which parts of a document are yours versus an agent's. A new "Voice" toggle in the right-rail topbar tints each block by who wrote it — you, an agent, or both — and the per-doc composition (e.g. "68% you · 29% agent") shows on hover. Attribution is captured automatically as you and agents write, anchored to the text itself so it survives edits, splits, and paste-back. Accepting an agent's change keeps it marked as the agent's — reviewing isn't the same as authoring.
- **Version history is now an attributed timeline.** The Versions panel shows your document's history as a list of commits — created when an agent finishes writing, when you accept changes, or when you hit "Save version" — each labelled with who changed what (e.g. "+3 agent · 2 edited you"). Expand a commit for the per-author breakdown and one-click Restore.
- **`get_attribution` MCP tool.** Agents can read a document's human-vs-agent composition and per-block origin.

### Changed
- One command now sets up your agent: `npx openwriter setup` installs the skill, wires up the MCP server, and gets you writing. The old `install-skill` command still works as an alias.

## [0.36.2] - 2026-06-11

### Fixed
- The right rail no longer re-opens itself when you hide it while agent changes are pending — and Focus mode now reliably collapses it. Previously, closing the rail with pending changes present would immediately snap it back open.
- The right rail's hide/show now animates like the left sidebar: instant open, smooth collapse on close, instead of popping shut abruptly.
- The Seamless canvas style no longer crowds the toolbar — its top spacing now matches the other canvas styles.

## [0.36.0] - 2026-06-11

### Changed
- Redesigned the Review panel with a cleaner top-to-bottom layout: scope, document navigation, a modified/original toggle, the change stepper, accept/reject, and accept-all/reject-all. Bulk actions sit muted by default and only take on intent color on hover, so accepting or rejecting a whole document is harder to trigger by accident.

### Fixed
- Markdown files added to a profile from outside the app now show their real title in the sidebar and document list instead of "Untitled" until opened. Title resolution falls back through frontmatter, the workspace entry, the first heading, then the filename.
- Pending agent changes (sidebar dots and the Review panel) now survive an app restart. The startup scan reads the current pending sidecar files instead of the legacy frontmatter format, which had been emptying the pending index on every restart.

## [0.35.2] - 2026-06-10

### Fixed
- Plugin skills (like Author's Voice) are now included in the npm bundle — previously a plugin's `skill/` directory was dropped at packaging time, shipping tools without their agent instructions.

## [0.35.1] - 2026-06-10

### Fixed
- npm bundle now ships the current openwriter skill (v0.18.0) and freshly built plugin bundles — 0.35.0's package carried a stale copy.

## [0.35.0] - 2026-06-10

### Added
- **Five new bundled companion skills** — `polish` (copy scoring + rewrite to 90/100), `anti-ai` (AI-fingerprint scrub), `beat-writer` (beats-first channel-agnostic drafts), `blog-writer` (long-form blog pipeline with GitHub publishing), and `newsletter-writer` (email newsletter pipeline). Install any of them with `npx skills add https://github.com/travsteward/openwriter --skill <name>`.
- **Author's Voice skill ships inside the plugin** — enabling the Author's Voice plugin now delivers both the MCP tools and the agent skill in one step (`plugins/authors-voice/skill/`). No separate install needed.
- Shared `WRITER-CONVENTION.md` so all bundled writer skills follow one set of drafting conventions.

### Changed
- openwriter skill v0.18.0 — install guide covers the full bundled-skill roster.
- Bundled skill docs refreshed with consistent worked examples throughout.

## [0.34.0] - 2026-06-09

### Added
- **Narrow windows no longer squish the doc — panels glide over it as drawers instead.** Below a computed threshold (when the doc would drop under a readable width given your current panel widths) the left sidebar and right rail stop pushing the editor and become floating drawers over a full-width doc. Close a drawer to reveal the doc; open it back via the toolbar buttons. Scrim click, Esc, or the panel's own close button all close. Widen the window back and your previously-docked panels restore. Resize handles stay docked-only. → `src/App.tsx`, `src/App.css`, `src/right-rail/RightRailContext.tsx`
- **Blog publish validates against the target site's content schema before pushing.** Publishing a post whose frontmatter violates the site's Astro content schema — e.g. a `category` outside the site's allowed list — is now blocked *before* any commit or push, instead of silently failing the site build and 404ing the live page. You get a plain-language reason in the publish result and a toast in the editor naming exactly what to fix (e.g. `category "Updates" isn't allowed — pick one of: Product Updates, Guides, Discord Tips, Tutorials`). The schema is read live from the site repo on every publish, so it never drifts from the site. → `plugins/github/src/blog-tools.ts`
- **Sidebar tints the collapsed ancestors of the active doc.** When the row you're editing is hidden inside a collapsed workspace / container / variant master, that ancestor row now carries the accent tint — so you can tell at a glance which branch holds the open doc without having to expand everything. → `src/sidebar/Sidebar.css`

### Fixed
- **Title-rename decoration now renders in blog (and any) compose view, not just the article view.** When a pending title rename was queued, the in-place rename highlight only appeared in the article compose surface — the blog and other compose views silently dropped it, so you couldn't see the proposed title change inline. The decoration now rides on every compose view that hosts the editor. → `src/blog-compose/BlogComposeView.tsx`

## [0.33.2] - 2026-06-08

### Changed
- **Author's Voice model picker shows relative cost tiers instead of per-edit cents.** The dropdown now labels each model with `$ / $$ / $$$` (and `free` for the Fast tier) rather than approximate per-edit cent figures, which read as fixed prices when the charge varies with edit length.

## [0.33.1] - 2026-06-07

### Fixed
- **Author's Voice pending-diff highlight on partial selections.** When an Author's Voice rewrite replaced a mid-paragraph (sub-paragraph) selection, the blue/green pending decoration highlighted the wrong character range — a mid-word cutoff, or only the unchanged prefix — because it trusted selection offsets that a holistic rewrite invalidates. The highlight is now computed from a real text diff (longest common prefix + suffix) of the original vs rewritten node, so it covers the actual changed span. Whole-node and multi-node selections are unchanged, and accepted text was always correct — this was cosmetic only. → `src/context-menu/ContextMenu.tsx`

## [0.33.0] - 2026-06-05

### Added
- **Wallet top-up inside the Author's Voice plugin.** A new **Credits** panel shows your AV balance and lets you top up without leaving OpenWriter, and an AV-enhance failure now raises a toast with a **top-up action** instead of dropping silently. Balance/checkout flow through a billing proxy (`get_billing`) so the key never touches the client. → `src/utils/av-billing.ts`
- **Install-aware update banner.** When a newer OpenWriter is published, a banner offers to update — aware of how this copy was installed (npm-global vs dev-linked) so it only prompts when an install actually applies. → `src/UpdateBanner.tsx`
- **Reveal-in-tree on deep-link open.** Opening a document via deep link now expands and scrolls the sidebar tree to that doc, so you land with context instead of a collapsed shelf. → `src/sidebar/use-reveal-active-doc.ts`

### Changed
- **Author's Voice paid-enhance pricing updated.** Pricing now varies by the model you pick rather than a flat per-tier charge; the model picker labels the free Fast tier as **"(free)"**.
- **AV settings panel reordered and tightened** — top-up collapsed by default, and the rough per-model cent estimates were dropped.

## [0.32.0] - 2026-06-03

### Changed
- **Publish billing re-fenced to value-fenced tiers.** The volume-limited Creator/Growth/Publisher tiers are replaced by **Publish ($19/mo)** and **Publish+Email ($49/mo)**, fenced by *capability* rather than caps: Publish gives the full scheduler + every channel except email; Publish+Email adds the newsletter. The $79 Publisher tier is retired, and per-plan posts/subscriber volume caps are gone.

### Added
- **Bring-your-own image-generation key.** The image-gen plugin now exposes an `imageApiKey` field (under Settings). Set it for **unlimited** image generation on your own key (your cost); leave it blank and OpenWriter generates on its shared key up to a per-plan monthly allotment (Publish 25 / Publish+Email 100), then prompts you to bring a key. Honored on both the plugin route and the `generate_image` MCP tool.

## [0.31.0] - 2026-06-02

### Changed
- **Docs marked "Request sort" now drain automatically via a minion, instead of waiting for an agent that never came.** The sidebar's sort marker always persisted correctly and `list_pending_sorts` always returned it — but nothing consumed the queue: 3 docs sat marked for 4–6 days while enrichment (identical surfacing scaffold) drained 217/223 docs over the same window. The difference was the directive, not the scaffold. Sort's footer/session-instruction carried *advisory prose* ("handle it inline, discuss with the user — no minion, sorting is a judgment call"); enrichment's carried an *executable `Agent(...)` dispatch* to an autonomous minion. An agent mid-task fires a fire-and-forget background dispatch; it does not derail the user's task for a judgment conversation. Sort now rides the same rail: `sortFooter()` and `buildSortInstructions()` emit a paste-ready dispatch for the new **`openwriter-sort-minion`**, which self-discovers via `list_pending_sorts`, picks a destination from workspace/container purpose hints, files the doc (`move_item`), retires the request (`mark_sorted`), and reports what moved. The "judgment call → must gate on a human" premise was self-defeating — `propose_sort` already moved the judgment to an async accept/reject step, and a sort-marked doc has no user-expected location to violate (the mark *is* the user delegating placement). Safety is **reversibility + transparency** (every move is one `move_item` to undo and is reported), not a pre-move gate — the same safety class as enrichment. SKILL.md firm rule 6 flipped from "no minion / inline" to "dispatch reflexively." → [adr/sort-minion-drain.md](adr/sort-minion-drain.md)
- **Author's Voice model picker updated** — Fast+ now maps to `gemini-3.5-flash`, and the standalone Gemini Pro option was dropped; the picker reads the selected tier live per request.
- **Plugins tab: the model selector is now front-and-center.** `select` config fields render at the **top level** of a plugin's settings (API keys/secrets stay in the collapsed "Settings" menu), and changing a config value now shows a **trustworthy inline ✓ / ✗** reflecting the real save result — previously the save was fire-and-forget with no feedback.
- **`showToast` is now OpenWriter's canonical toast primitive** — consolidated and restyled with the context-menu design tokens.

### Added
- **`autoSortDisabled` workspace opt-out** (mirrors `enrichmentDisabled`). Set via `update_workspace_context`; its docs drop from `list_pending_sorts` so the minion never auto-files them, falling back to the manual sidebar `propose_sort` → accept/reject flow. `get_workspace_structure` surfaces `auto-sort: disabled` in its header. `propose_sort` is retained unchanged for users who want to approve each move.
- **Transform "ify" commands now refuse to run on an over-large document (5,000-word cap), with a toast** — mirroring the Author's Voice selection guard. Stops a huge doc from triggering an unbounded-cost/time transform; client-side guard in the sidebar (`transform-guard.ts`) plus a server-side check in the publish plugin.
- **Selection-based actions refuse over-large selections with a toast** (client-side size guard, mirroring the AV API) — the same unbounded-cost protection for in-editor enhances.

### Fixed
- **Author's Voice now reads the selected model tier live per request**, so a model-picker change takes effect immediately instead of being pinned at load.
- **Plugin `select` fields no longer render a duplicate blank option.**
- **A plugin that fails to load is no longer persisted as disabled** — so a transient load failure can't silently flip a plugin off.

## [0.30.1] - 2026-06-01

### Fixed
- **Blog frontmatter now emits dates as unquoted YAML scalars, so Astro `z.date()` schemas build instead of failing.** `post_to_blog` routed every frontmatter value through a stringifier that quoted it — so a date shipped as `pubDate: "2026-05-31"`. Astro's `z.date()` parses a quoted scalar as a *string*, not a Date, and rejects it: a real publish to example-blog.com froze every Netlify build for ~6h (`InvalidContentEntryFrontmatterError … Expected type "date", received "string"`) while the new content already sat on `origin/master`. `buildFrontmatter` now emits the date destination key(s) (`pubDate` / `date` / `publishedDate`) as **raw, unquoted** YAML when the value is `YYYY-MM-DD` — the form accepted by `z.date()` *and* `z.coerce.date()` *and* Jekyll/Hugo/Next (gray-matter). Non-date-shaped values fall back to quoted, and real string fields (title, description) are untouched. → [adr/blog-image-contract.md](adr/blog-image-contract.md)

### Tests
- `scripts/test-blog-cover-path.mjs` section [9] — 7 assertions pinning unquoted date emit: `pubDate` unquoted, ISO-datetime sliced + unquoted, default `date` field unquoted, auto-derived date unquoted, non-date value stays quoted, string fields still quoted (45 assertions total).

## [0.30.0] - 2026-06-01

### Added
- **Blog `site_url` is harder to leave blank, so the live "View Post" link works for more users.** The live URL is built from a registered site's `site_url` — which previously could only be auto-detected from a committed `CNAME` or `wrangler.toml` route, missing the common case (Cloudflare Pages / Vercel / Netlify with the domain set in the host dashboard). Three changes close the gap: (1) `inspect_blog_repo` now also queries the **GitHub Pages API** (`gh`, credential-free) as a fallback site-URL source; (2) when it still can't be determined, both `inspect_blog_repo` and `add_blog_site` return `needs_site_url: true` + a hint, so the agent knows to ask the user instead of silently shipping posts with no live link; (3) a new **`edit_blog_site`** MCP tool lets you backfill or correct `site_url` / `blog_url_pattern` (and other fields) on an already-registered site without re-registering. Hosts whose domain lives only in a dashboard still can't be auto-derived — but the gap is now visible and fixable rather than a silent null.
- **Plugin config schemas can declare a generic `select` (dropdown) field.** Rendered as a dropdown in the right-rail Plugins settings tab — the primitive behind the Author's Voice model picker below.
- **Author's Voice plugin: a model-tier picker, including a Gemini Pro option.** The bundled AV plugin exposes a model-tier picker config field so the generation model can be chosen from the Plugins tab.

### Changed
- **The build now always rebuilds bundled plugins, so a plugin source change can never ship or run stale.** `npm run build` and `scripts/prepublish.cjs` both run the new `scripts/build-plugins.cjs`, which rebuilds every `plugins/*` that declares a `build` script. Previously the app build skipped the plugins and prepublish merely *copied* each plugin's existing `dist/` (silently skipping any missing one) — so a plugin edit shipped stale in the npm bundle and ran stale after a local restart (the same stale-bundle class as the v0.20.0 skill bundle). The plugin build lives in prepublish, not only the `build` script, because `npm publish` runs `prepublishOnly` but not `npm run build`.
- **The blog compose view's success affordances now match the rest of the blog UX.** The compose-footer **Publish** button reads **Republish** once the doc has been published (mirroring the file-tree right-click menu), and the "Published" status pill links to the live post (`publishedUrl`). The per-doc **font / width / spacing** style controls were removed from the footer: they only ever restyled the *editor*, never the published Astro output (which applies its own CSS), so they misrepresented what they did. The blog editor now inherits the global **Appearance** panel's typeface + spacing like every other editor, keeping a fixed readable measure. → [adr/blog-compose-save-loop.md](adr/blog-compose-save-loop.md)

### Fixed
- **The Post-to-Blog success screen now links the live post (not a useless commit URL), and the sent badge flips immediately with no reload.** `post_to_blog` has always returned the live URL as `live_url` and written `blogContext.lastPublish.publishedUrl` server-side, but two contract-drift bugs hid the payoff. (1) The success modal omitted `live_url` from its response type and instead re-derived a GitHub *commit* URL from `owner/repo/commit`, rendering a "View commit" CTA the operator can't use; it now consumes the server's `live_url` and renders a primary **"View Post"** link, with the commit demoted to a small secondary affordance (and a graceful fall-back to the commit/file when the site has no `site_url`). The compose-view "Published" pill had the same drift — it read `lastPublish.url` while the server writes `publishedUrl` — so its link was always dead; now fixed. (2) `post_to_blog` was the lone metadata-mutating write path that persisted state without broadcasting, so the file-tree ✓, the "Republish to Blog" context-menu label, and the compose pill all stayed stale until a manual reload. The writeback now broadcasts `metadata-changed` + `documents-changed` after a successful save — the same convention the core MCP tools follow — so every connected client (and every invocation path, modal or direct-agent) converges live. A failed writeback now surfaces its warning in the success screen instead of showing a clean ✓. → [adr/plugin-metadata-broadcast.md](adr/plugin-metadata-broadcast.md)

## [0.29.2] - 2026-05-31

### Fixed
- **Blog publishing's cover-image flow is now a per-site contract instead of a hardcoded assumption — so it works for every user's repo, not just hand-normalized ones.** `post_to_blog` previously always emitted an *absolute*, *raw-named* image path (`/images/og/<hash>.png`). Real sites diverge: every one of example-blog.com's 18 live posts uses *relative* `images/og/og-{slug}.png` (the Astro template prepends the slash), so a real publish would have broken all of them to `//images/og/...` and orphaned a new hash file on every republish. Two dimensions are now modeled on each blog site and **inferred by `inspect_blog_repo` from the repo's existing posts**: `image_path_style` (`relative` = no leading slash, the template adds it; `absolute` = leading slash, used verbatim) and `image_naming` (cover filename template, default `og-{slug}.{ext}`, source extension preserved). The cover is copied under its deterministic slug-based name — same doc + slug ⇒ same filename every republish (idempotent overwrite, zero orphans) — and both cover *and* inline body image references honor the path style. `inspect_blog_repo` additionally derives `image_public_prefix`, `image_dir`, and the cover field name (e.g. `image` vs `coverImage`) from sampled posts, so `add_blog_site` for a brand-new repo just works. `post_to_blog` now returns the resolved `image:` path + filename it shipped. Defaults reproduce the prior behavior (`absolute`, `og-{slug}.{ext}`) so already-registered sites are unaffected. → [adr/blog-image-contract.md](adr/blog-image-contract.md)

### Tests
- Added `scripts/test-blog-cover-path.mjs` (38 assertions): path-style emit, deterministic cover naming + extension preservation, frontmatter output for both styles, idempotent no-orphan republish, the `inspect_blog_repo` image-contract inference against a real blog's post shape, and a regression pinning `blogContext.lastPublish` durability across a `set_metadata({ blogContext })` edit (the deep-merge shipped earlier in `91d55e0`).

## [0.29.1] - 2026-05-31

### Changed
- **"Create variant" now field-projects the master onto the target format instead of cloning + mislabeling it.** v0.29.0 shipped a variant path that copied the master's body verbatim and stamped a cosmetic `variantType` badge without ever setting `content_type` — so a "Blog" variant of a tweet rendered the *tweet* editor surface with tweet content (the format options were a lie, and the surface/body mismatch is exactly the clobber class `adr/browser-write-fidelity.md` guards against). Variants now port the fields the two types share: body always; on a downcast (title-bearing master → body-only target, e.g. blog→tweet) the master's title folds into the body's first line so it isn't lost; on an upcast the target's extra title field starts blank. The variant is scaffolded with the *target* type's `content_type` + context (source context objects are dropped), so it renders the right editor surface and nests under its master. **Duplicate** remains the verbatim-copy action. → [docs/variants.md](docs/variants.md)

### Fixed
- **"Create variant" / "Transform" context-menu flyouts no longer drop a menu-height below their row.** Both submenus were positioned with `offsetTop + parentRect.top` arithmetic that double-counted once the flyout went `position: fixed`. They now anchor to the trigger button's own `getBoundingClientRect()`.

## [0.29.0] - 2026-05-31

### Added
- **Document variants.** When repurposing a doc into another format — a thread off a blog post, a LinkedIn cut of a newsletter — `create_document({ masterDocId, variantType })` nests the new doc under its master in the sidebar instead of floating off as a disconnected doc. Both entry points are wired: agents pass the params on `create_document`; users do the same via right-click → "Create variant".
- **Prompt Debug Inspector (owner-only, off by default).** Set `OW_PROMPT_DEBUG=1` on the openwriter MCP server env and every right-click Enhance drops a `_prompt-*.md` doc — the exact system + user Author's Voice prompt that was sent — into the sidebar, for inspecting what the model actually received. → [docs/prompt-debug.md](docs/prompt-debug.md)

## [0.28.2] - 2026-05-31

### Fixed
- **Blog docs no longer render as — or get clobbered by — the empty tweet-compose view.** A document with `content_type: blog` that also carried an `articleContext` (e.g. one repurposed for an X post) rendered the X/article tweet-compose surface, which is empty and separate from the blog body. That hid the body in the editor and, worse, let the empty compose surface autosave *over* the populated body — a real 2,590→34-word truncation, recoverable only from version history. Two coupled fixes: `content_type` now owns editor-surface selection, so a `blog` doc always renders the blog editor regardless of `articleContext`; and the no-clobber invariant moved from `updateDocument` alone to the full browser-write boundary (`updateDocument` + `syncBrowserDocUpdate` + `saveDocToFile`) with checkpoint-then-refuse, closing the stale-version write path that was the actual clobber route. → [adr/browser-write-fidelity.md](adr/browser-write-fidelity.md)

## [0.28.1] - 2026-05-28

### Fixed
- **Fused multi-paragraph tweet writes no longer corrupt docs.** Agent writes and Author's Voice rewrites delivered as TipTap JSON bypassed the markdown parser's `<br><br>` paragraph-split heal, so an X-style fused paragraph (one node with double hardBreaks) could enter canonical content. That broke the serialize→reparse round-trip (sync-check failures), destabilized the node-identity matcher, and corrupted pending decorations — surfacing as a phantom single-word "original" highlight and duplicated/orphaned nodes. `write_to_pad` and `populate_document` now run the same split heal on structured/JSON content as the markdown path, so every doc type's canonical form is separate paragraph nodes (intra-paragraph single `<br>` line breaks are preserved). Idempotent on already-split content; editor, parser, and serializer unchanged. → [adr/tweet-paragraph-convention.md](adr/tweet-paragraph-convention.md)

## [0.28.0] - 2026-05-28

### Added
- **Per-post auto-plug opt-out.** Any post can now opt out of automatic engagement-threshold autoplugs. A doc is eligible by default; setting `autoplug: false` in its frontmatter takes it out of the pool. The opt-out is honored across every posting lane: manual mark-sent (enrollment is skipped), the `post_to_x` MCP tool (new `autoplug` boolean param), `schedule_post`, and the scheduler queue — each forwards a `no_autoplug` signal to the platform so the choice survives to the moment the tweet is tracked. No content-type defaults and no schema migration; the flag rides the existing post / publication / queue payloads.
- **Auto-plug toggle in the tweet and article compose views.** A pill button in the compose footer flips the current doc's auto-plug eligibility on/off, so press-Post and Schedule flows (X posts, threads, replies) can opt out in one click instead of hand-editing frontmatter.

## [0.27.1] - 2026-05-28

### Fixed
- **Autoplugs fire on manually-posted tweets.** Marking a tweet sent now records it as a platform publication, which enrolls the tweet into autoplug tracking the same way API/scheduler posts are — so engagement-threshold autoplugs fire on manual posts, including quote tweets (which the X API can't post and so always go through mark-sent). Previously a manual post only wrote local `tweetContext.lastPost` frontmatter and never told the platform, silently zeroing the quote-tweet → newsletter funnel. Idempotent (skips if already a recorded publication) and best-effort (never blocks the mark-sent save).
- **Skill npm bundle synced to 0.16.3.** The npm-bundled skill copy lagged at 0.16.0 even though 0.27.0 documented 0.16.3; brought in line with the canonical / GitHub copies (same stale-bundle class as v0.20.1).

### Changed
- **Author's Voice plugin is now a pure proxy.** Removed the engine config key, `AV_ENGINE` env var, default resolution, and per-request version injection from the bundled AV plugin. The Author's Voice API now owns the v1/v2 default (`AV_DEFAULT_ENGINE`); the open-source plugin no longer decides or exposes the engine.

## [0.27.0] - 2026-05-27

### Added
- **GitHub blog plugin (`@openwriter/plugin-github`).** Blog publishing and docs-sync are now a first-class bundled plugin instead of living inside the publish plugin. New MCP tools: `add_blog_site` (register a GitHub repo as a blog target), `post_to_blog` (commit the current doc as a post — refuses non-`blog` content types), and `inspect_blog_repo` (probe a repo's structure, skipping openwriter-leak sample files). A Plugins-tab settings panel manages registered blog sites; post frontmatter is derived from `blogContext` with per-site defaults; `post_to_blog` reads `imagePublicPrefix` from the connection config so image URLs resolve on the published site.
- **"Post to Blog Now" context menu.** Right-click a blog doc in the sidebar to publish it directly; a "View Post" link surfaces after publishing.
- **Multi-repo GitHub connections.** The right-rail Connections tab supports multiple rows with an "+ Add GitHub repo" action.
- **Review panel Modified/Original toggle for titles.** Pending title renames diff in the Review panel like body changes, with a Modified/Original toggle.
- **Agent title renames staged through pending review.** Agent-initiated title changes route through the pending overlay so the user accepts/rejects them like any other change, rather than landing silently.
- **Doc create/delete activity entries.** The Activity log now records document creation and deletion.
- **Author's Voice plugin v2 routing + `AV_DEBUG`.** The bundled AV plugin gains v2 engine routing and an `AV_DEBUG` switch; OpenWriter is now the canonical source for the plugin.
- **Auto-switch to Review on right-click actions.** Triggering an enhance/voice right-click action auto-opens the right-rail Review tab.

### Changed
- **MCP tool schemas accept object + array params and coerce JSON strings.** `jsonSchemaToZodShape` now supports object and array parameter types, and complex params encoded as JSON strings (some MCP clients send everything as strings) are auto-parsed.
- **Skill v0.16.3.** Workflow recipes use the full read ladder (search/peek/slice/force); `read_pad` params documented in the tools table and editing section; deep-link section clarifies URLs must come from `get_doc_link` (a real `http://` link), never a hand-built `docId:` scheme.

### Fixed
- **mark-sent reaches disk.** Metadata mutations now bump `docVersion` so writes (e.g. mark-as-sent) are no longer silently dropped — a regression from doc-version gating in applyChanges.
- **No false "external write" after tag mutations.** `loadedMtime` is re-stamped after a tag-mtime rollback so the file watcher self-suppresses instead of misfiring a "Document reloaded from disk" warning.
- **Doc-switch lag.** Dropped a `sidebarRefreshKey` bump that forced a full `/api/documents` refetch (gray-matter parse of every doc) on every switch — the dominant switch lag once tags began riding on that endpoint.
- **Multi-paragraph content on populate / tweet docs.** `populate_document` no longer collapses multi-paragraph content into one node for tweet docs, no longer preserves empty stub paragraphs, and import heals `<br><br>` paragraph fusion.
- **Pending-overlay read-side symmetry.** Non-active doc loads now apply the sidecar overlay (closing a read-side asymmetry); fallback-empty stripping unified in `applyOverlayPure`; pending-title diffs moved to the article title + Review panel.
- **Review panel polish.** Clean docs show "All caught up" (dropped refresh-loop side effects); the doc counter reads "—/N" when the current doc isn't pending; the cycle wraps correctly and treats the title as a regular slot; body gutter suppressed when the cursor is on the title.
- **Plugin state + load.** Nested plugin slot data is preserved across `savePluginState`; duplicate tool registration no longer hangs plugin toggles.
- **Blog compose stability.** Removed a `BlogComposeView` save-loop; first-run auto-saves skipped to stop phantom external-write reloads; editor wrapper sized to natural content height so it scrolls; compose banners span the full editor width and stack above content.
- **Sidebar polish.** Dark-mode visibility for the "Sort requested" row; publish-plugin context menu cleanup.
- **Activity log batching.** Per-doc enrichment entries collapse into a single batch summary.

### Removed
- **Blog publishing lifted out of the publish plugin.** The publish plugin no longer owns blog publishing — it lives in `@openwriter/plugin-github`. GitHub was removed from the Connections tab (managed in the Plugins tab + right-rail connections instead), and a dead blog-publish code path was deleted.

## [0.26.0] - 2026-05-25

### Added
- **`read_pad` slice + force params.** Two new optional knobs on the read_pad MCP tool:
  - `slice: { from, to }` — read a percentile range of the doc (floats in [0, 1]). `{from: 0.5, to: 1}` = back half, `{from: 0.25, to: 0.75}` = middle 50%, sequential `{from: 0, to: 0.1}` → `{from: 0.1, to: 0.2}` … = walk the doc in 10% chunks at predictable per-call cost. Snaps to top-level node boundaries (no mid-sentence breaks). Subject to the word cap unless `force` is set; truncation hint now suggests the next adjacent slice automatically.
  - `force: true` — bypass the ~2,000-word cap and return the full requested region (whole doc or whole slice). Reverses v0.25's "no escape valve" stance — agents (and humans through them) shouldn't be hard-blocked from accepting the cost when they explicitly want to. Forced reads are labeled `[FORCED FULL READ — N words]` so the response is self-describing.

  Default behavior unchanged: `read_pad({ docId })` still returns the first ~2,000 words. Both params layer on top.

  Slice vs peek: peek anchors to a known nodeId (good for "read around this hit"); slice anchors to a word-position percentile (good for "give me the back half" or "walk this doc in 10% chunks"). Use the one that matches your intent — neither is strictly better. Peek_doc is still the right call when you already have an anchor from outline_doc / search_docs / deep-link click.

### Changed
- **Skill v0.16.0.** Read ladder step 6 updated: `read_pad` now documented with default + slice + force modes. New paragraph explicitly framing slice vs peek as different access patterns (percentile vs nodeId), not redundant tools.
- **Truncation hint expanded.** When the cap fires, the response now lists four follow-ups (read_pad slice, read_pad force, peek_doc, outline_doc) instead of three — gives the agent the full menu in one shot.
- **MCP schema accepts coerced strings.** The new `slice` (object) and `force` (boolean) params use `z.preprocess` to accept JSON-string serializations of complex types, since some MCP clients pass everything as strings rather than native types. Both proper and stringified inputs validate; failed JSON parsing falls through to standard validation errors.

## [0.25.0] - 2026-05-24

### Changed
- **`read_pad` is now a fixed-window tool by contract.** Caps at ~2,000 words per call. Docs at or below the cap return in full as before. Above the cap, the response includes the doc opening (title + intro + first sections — the most context-rich slice) plus `lastNodeId` and a continuation hint pointing at `peek_doc({ around: lastNodeId, after: N })`, `outline_doc({ docId })`, or `search_docs({ query, docId })`. No `force` flag — the cap is the architecture, not a soft suggestion. First truncation in a session prefixes an FYI so the agent learns the new behavior; subsequent truncations skip the explanation. Removes the failure mode where an agent could token-blow a 50k-word doc by calling `read_pad` blindly. Side-effect: surfaces monolith docs (8k+ words in one file) as the wrong unit for AI-assisted writing and nudges users toward chapter/section/topic-sized docs that read complete in one shot.
- **Skill v0.15.0.** Read ladder rule rewritten to reflect the truncation contract — step 6 now reads "`read_pad(docId)` — first ~2,000 words of the body, ALWAYS truncated above the cap" instead of the prior "escape hatch for everything." Single-document and Multi-document workflows updated to orient with `outline_doc` + `peek_doc` for long docs and use `read_pad` only when the doc is known to fit under the cap. New paragraph on doc-structure implications: the cap makes monoliths visibly expensive and rewards smaller docs.

### Added
- **`truncateRead(doc, maxWords)` + `countWords(nodes)` in `peek-outline.ts`.** Truncates at top-level node boundaries — never splits a list, blockquote, or code block mid-way — so the returned markdown stays structurally valid. Always includes at least one top-level node so callers never receive an empty body. Returns `{ doc, truncated, totalWords, returnedWords, lastNodeId, remaining }` for callers that need the cost-and-continuation metadata.

## [0.24.0] - 2026-05-24

### Added
- **Sort requests — user-marked, agent-handled inline.** Sidebar adds "Request Sort" actions on docs and folders for the user to mark items that need a home. Sort surfaces back to the agent two ways: a `SORT_STATUS: N docs awaiting sort` notice in the MCP server's session-start instructions, and a `⚠ N docs awaiting sort` footer on `list_documents` / `list_workspaces` / `get_workspace_structure`. New MCP tools: `list_pending_sorts`, `propose_sort` (batch flow — writes one proposal per doc; sidebar flips to "proposal ready" with in-menu accept/reject popover that triggers the move on accept), `mark_sorted`. Sort is a judgment call — no minion dispatch, the main agent handles destinations in conversation. Every sort goes through confirmation; no auto-mode.
- **`outline_doc` MCP tool.** Returns the heading tree for a doc (~5 tokens per heading). Drill into a single section with `underHeading`. Falls back to block-preview mode for docs without headings. The cheap orientation tool before any body read — costs ~50 tokens vs `read_pad`'s 10k+ for a typical chapter.
- **`peek_doc` MCP tool.** Windowed node read once oriented. Six target shapes: `{node}`, `{nodes}`, `{around, before, after}`, `{from, to}`, `{first}`, `{last}`, `{position, span}`. Use instead of `read_pad` whenever you only need part of a doc.
- **`search_docs` scoped to a single doc.** New optional `docId` parameter. With docId, returns matching nodes inside that doc (nodeId + type + snippet) — the content-to-node bridge that pairs with `peek_doc`. Without docId, behaves as before (ranked docs across the workspace).
- **Auto-derived doc titles.** When a doc's title is "Untitled" or the default, the first usable sentence from the body is promoted to the title automatically. 60-char cap with sentence-boundary preference.
- **URL prompt on Mark-as-posted.** Tweet and article compose modes both prompt for the actual tweet URL when marking as posted; surfaces as `articleContext.lastPost.tweetUrl` for the sidebar to render.

### Changed
- **`crawl` renamed to `browse_docs`.** Conventional verb-noun shape. Old `crawl` and intermediate `browse` aliases kept as DEPRECATED for one release cycle.
- **`get_workspace_structure` stripped to tree shape only.** Per-doc loglines, status, tags, and stale flag no longer come back from this tool — use `browse_docs` for concept-level frontmatter. Tree shape (containers, doc filenames, workspace-level fields) and context still return as before. A 1000-doc workspace structure read drops from ~60k tokens to ~1.5k.
- **`get_nodes` deprecated.** Use `peek_doc({ nodes: [ids] })` instead. Alias kept for one release.
- **Compose footer buttons gate on X API capability per mode.** Mode-aware enable/disable so disabled buttons communicate why they're inactive. Schedule button hides once a tweet is marked posted.
- **Skill v0.14.1.** Documents the full read ladder: `search_docs` → `browse_docs` → `outline_doc` → in-doc `search_docs` → `peek_doc` → `read_pad`. Adds firm rule 6 (handle sort requests inline) and firm rule 8 (orient by content first; pick by nodeId second). Editing and sort workflow sections updated to use the ladder.
- **Skill v0.12.0 — OpenCode host support.** Setup extracted into `docs/setup.md` covering both Claude Code (`claude mcp add` + manual JSON) and OpenCode (`opencode.json` + agent file placement at `~/.config/opencode/agents/` or `.opencode/agents/`). Enrichment minion agent file gains OpenCode-compatibility frontmatter (`mode: subagent`, `steps: 500`, `permission:` block with snake_case tool keys). Claude Code's frontmatter (`name`, `maxTurns`, `tools:`) coexists; each host reads its own fields. New `opencode.json` at the repo root wires up the MCP server for OpenCode users developing on the monorepo.

### Fixed
- **Read-ladder dedup + outline noise.** Scoped `search_docs` no longer emits duplicate matches (parent block + child text node) — skips IDless nodes during traversal. `outline_doc` drops the first h1 (always the doc title) since it's redundant with `read_pad` headers, `search_docs`, and `browse_docs`.
- **Sort-request writes use the in-memory path on the active doc.** Clicking "Request Sort" while a doc is open no longer triggers the "Document reloaded from disk (external write detected)" warning. Active-doc branch uses `setMetadata` + `bumpDocVersion` + save, mirroring the auto-accept pattern.
- **Mark-as-posted UX polish.** Toggle off, click-outside dismiss, theme match. Pending gutter line restored in tweet compose mode.
- **Skill prepublish whitelist.** Docs whitelist in `packages/openwriter/scripts/prepublish.cjs` now ports the four docs SKILL.md actually references: `welcome.md`, `setup.md`, `enrichment.md`, `footnotes.md`. Previously bundled two dead entries (`voices.md`, `anti-ai.md` — no source files exist) and was missing `setup.md` and `footnotes.md`, which meant the SKILL.md redirect to `docs/setup.md` would have shipped pointing at a missing file.

### Security
- **x-writer skill: removed hardcoded `AV_API_KEY` fallback.** The companion `x-writer` skill's `polish.js` script previously contained a hardcoded Author's Voice API key as a `process.env.AV_API_KEY || 'av_live_...'` convenience fallback that leaked the live key into the public repo. The fallback has been stripped — the script now requires `AV_API_KEY` in env and exits early with instructions if missing. The exposed key has been revoked and rotated; the leaked string has been purged from git history via `git filter-repo`.

## [0.23.0] - 2026-05-23

### Added
- **Right-rail panel system.** A persistent full-height column replaces the scattered titlebar panel icons. The rail has an icon strip along its right edge with dedicated tabs for Review, Activity, Backlinks, Exports, Connections, Plugins, Versions, and Appearance. Each tab has a collapsible body — click the icon to open/close that panel without losing your place in the editor.
- **Review tab.** The pending-change review panel migrates into the rail. Adds an All/Workspace scope toggle (review just the open doc or everything in the workspace) and an "Accept All" outline button for bulk-accepting agent changes.
- **Activity tab.** Persistent, profile-scoped activity log. Bell icon pulses on new agent events; first-time tooltip surfaces what the log is for. The activity store is module-level and survives panel open/close — no state lost when you collapse and reopen the tab.
- **Backlinks tab.** Inbound and outbound link lists in the rail — see everything that points at the current doc and everything it points at, without leaving the editor.
- **Connections, Plugins, Appearance, Exports, Versions tabs.** All five panels migrated from titlebar popup icons into dedicated rail tabs. The titlebar is now clear of panel chrome.
- **Focus mode integration.** Format toolbar toggle now fully collapses the rail bar as well — zero chrome remains when focus mode is active.
- **ADR: right-rail.** Architecture Decision Record capturing the full-height column architecture, tab migration decisions, and rail state persistence contract (`adr/right-rail.md`).

### Fixed
- **Heal stale references on boot.** On startup, any prose `doc:` links that exist in body text but are missing from the doc's `references:` frontmatter array are back-populated. Prevents stale graph state after edits made outside the save pipeline.
- **Backlinks cache reset on profile switch.** Switching profiles now clears the in-memory backlinks cache so the new profile's docs don't inherit stale computed edges from the previous profile's workspace.

## [0.22.1] - 2026-05-23

### Added
- **Companion skills: `x-writer` and `book-writer`** — installable from the same openwriter GitHub repo via `npx skills add https://github.com/travsteward/openwriter --skill x-writer` and `--skill book-writer`. x-writer covers X/Twitter writing format, image generation, article scoring, comic strip pipeline, and OpenWriter compose mechanics. book-writer covers book-scale orchestration — chapter architecture, beats methodology, workspace management, and delegation to `/authors-voice` for prose generation.

### Changed
- **Skill v0.11.2.** Companion Skills section now documents install commands for x-writer, book-writer, and authors-voice so agents discover and install the full stack after onboarding.

## [0.22.0] - 2026-05-23

### Added
- **Deep-link route `/d/{docId}[#node={nodeId}]`.** Navigating to `http://localhost:5050/d/{docId}` opens OpenWriter and loads the target doc directly — no manual workspace switching, no sidebar hunting. Adding `#node={nodeId}` scrolls to and flashes the target paragraph block on load (same pending-scroll pipeline used by internal `doc:` link navigation). The boot effect fires once on mount, parses the pathname and hash, and hands off to the existing `handleLinkClick` path. The URL then resolves to the canonical `#{filename}` form. Entry-point, not persistent state.
- **`get_doc_link` MCP tool.** Returns `{ url, docId, nodeId }` for a given docId (and optional nodeId). Validates the 8-char hex shape, resolves the docId to a known doc, and stitches the URL using the server's actual runtime port so agents never hard-code the host. Agents call this tool when citing a doc; the result is embedded as a clickable markdown link in the response.
- **`getBaseUrl()` / `getRuntimePort()` exports on `index.ts`.** Set when `startHttpServer` resolves its port; read by `get_doc_link` to construct correct URLs regardless of which port was actually bound.

### Changed
- **Skill v0.11.1.** Rule 6 added: emit `get_doc_link` URL alongside every docId cited in chat, rendered as **Doc level:** `[open Title](url)` for doc citations and **Node level (scrolls + flashes the specific beat):** bulleted `[Label](url#node=id)` list for block citations. Beat label or short description as link text — never a raw ID. X Content section now delegates to the `/x-writer` skill instead of duplicating tweet compose mechanics inline.
- **Alias propagation design doc** (`docs/alias-propagation.md`). Two-tier linking: agent declares original source→target connection and curates `aliases:`; a minion sweeps the corpus and propagates the link wherever an alias appears. Phase 1 is a CLI script; phase 2 adds a MCP tool and sidebar UI.

## [0.21.1] - 2026-05-22

### Changed
- **Outbound doc-links now render with a solid underline (regular hyperlink look) instead of dotted.** Inbound paragraph-backlink markers keep the dotted gray underline. Same substrate, opposite jobs, different visuals — "click to navigate elsewhere" looks different from "someone else points here." Resolves the v0.21.0 ambiguity where both classes rendered identically.

### Added
- **Right-click on an outbound doc-link offers "Go to target".** The context menu now detects `span.doc-link[data-doc]` ancestors at right-click time, parses the target docId (and optional `#NODEID` anchor) from `data-doc`, resolves the target's title from the doc list, and surfaces a `Go to "Title"` item that dispatches the same navigation event as left-click. Affordance parity with the inbound `See connections (N)` menu — both directions are discoverable via right-click.
- **`scripts/strip-self-links.mjs` — one-shot cleanup for self-referencing doc-links.** Walks every `.md` under each profile and removes prose links of the form `[text](doc:OWN_DOC_ID[#NODEID])` (the link text is preserved, the wrapper unwrapped) plus strips OWN_DOC_ID from the doc's own `references` array. Dry-run by default; pass `--apply` to write. Idempotent. Found in the wild on docs whose H1 had been wrapped in a self-link by an older `link_to` behavior (clicking such a link just reloaded the same doc — pure cruft).

## [0.21.0] - 2026-05-22

### Added
- **Paragraph-anchored backlinks restored as additive layer over doc-level references.** Prose links of the form `[text](doc:DOCID#NODEID)` (already supported by the TipTap `PadLink` extension for click-through navigation) now also feed the computed-live backlinks cache. The cache builder runs a second pass over every doc's body that walks the TipTap doc tree, extracts `doc:` link marks that carry a `#NODEID` fragment, and emits a `Backlink` entry with `from_doc`, `from_node`, `to_node`, and the visible link text. The doc-level v0.20 model is unchanged — these paragraph entries layer on top of it; dedup is on `(from_doc, to_node)` so the same source linking to the same target paragraph twice counts once. Restores the dotted-underline decoration on linked paragraphs and the "See connections (N)" context menu that v0.20.0 traded away when it dropped the prose-link granular fields. Live E2E verified: target paragraph shows the underline, right-click expands "LINKED FROM N PLACES" with click-through navigation back to the source doc.

### Changed
- **`computeBacklinksFor` returns both kinds of entry in one pass.** Doc-level entries (no `to_node`) come from the structural `references:` arrays; paragraph-anchored entries (with `to_node` populated) come from the body scan. Consumers pick what they need — the App.tsx backlinks effect renders the doc-level count in the panel, the editor decoration plugin only fires on entries with `to_node`.

### Fixed
- **`flushDocToFile` + `saveDocToFile` now invalidate the backlinks cache.** Without this, write paths that bypassed the v0.20 `writeToDisk` invalidation (e.g. `write_to_pad` on a non-active doc) would leave the cache stale — `/api/backlinks/:docId` returned the pre-write result until something else triggered a rescan. Both helpers now call `invalidateBacklinksCache()` after a successful write so the next read recomputes from disk.



### Fixed
- **Ship the updated skill bundle to npm.** v0.20.0's `prepublishOnly` script didn't fire (or its output got reverted) during the publish, so the npm tarball shipped with the stale skill at v0.7.6 instead of v0.10.0. Local `packages/openwriter/skill/SKILL.md` is now synced to the repo copy and explicitly verified before publish. Users running `npx openwriter install-skill` from v0.20.0 received the old skill copy missing the v0.19 enrichment guidance and the v0.20 connections model docs; this patch corrects that. No source code changes.

## [0.20.0] - 2026-05-22

### Breaking
- **Connections refactored to structured frontmatter.** Doc-to-doc connections live in source frontmatter as `references: [docId, ...]` arrays — body markdown is never mutated to declare a connection. The stored `backlinks:` frontmatter field is gone; inbound edges compute live as the inverse of every doc's references across the workspace (cached in memory, invalidated on any write that touches references). Per-paragraph link granularity (`from_node`, `to_node`, anchor `text`) was dropped — connections are doc-to-doc only.
- **`link_to` is now a pure references write.** Schema collapses to `{ source_doc_id, target_doc_id }`. Dropped parameters: `text`, `target_node_id`, `quote`. The tool no longer wraps prose with a `doc:` link; it appends `target_doc_id` to `source.references` (idempotent — repeat calls are no-ops). Pre-existing prose `doc:` links continue to render as clickable internal navigation (TipTap `PadLink` extension is unchanged) and now auto-populate `references` on every save (backward compat without forcing rewrites).
- **`get_graph` edges are doc-level.** Forward edges read from `references:`; inbound edges from the computed inverse. Response shape simplifies: `forward: [{ to_doc }]`, `backlinks: [{ from_doc }]`. The pre-v0.20 fields (`text`, `from_node`, `to_node`) were artifacts of the prose-link model and have been dropped.
- **HTTP routes updated.** `GET /api/backlinks/:docId` returns the computed inverse. `POST /api/rebuild-references` runs the full rescan (extracts prose `doc:` links from every doc's body, merges targets into `references:`, strips any legacy stored `backlinks:` field). The pre-v0.20 `POST /api/rebuild-backlinks` route is kept as an alias for one release cycle — both forward to `rebuildAllReferences()`.

### Changed
- **Save-time pipeline rebuilt around references.** `state.ts:writeToDisk` no longer captures old forward-links or calls the incremental backlinks updater. After every save: scan body for prose `doc:` links, merge their targets into `references:` (idempotent), persist frontmatter only if changed, then invalidate the computed-backlinks cache. The pre-v0.20 incremental pipeline had a missed-trigger bug observed in live testing — the new compute-live model removes the entire class of incremental-update races.
- **Backlinks decoration plugin reads from `/api/backlinks/:docId`.** App.tsx fetches on every doc switch / metadata change instead of reading `metadata.backlinks`. The per-paragraph dotted-underline decoration gracefully renders nothing for the new doc-level entries (they carry no `to_node`); a follow-up release adds a doc-level "N sources" badge.
- **DocumentInfo schema gains `references` and `aliases` fields.** Both are agent-owned arrays. `aliases:` is reserved for the v0.21 auto-highlight feature (workspace alias index → editor decoration); the data slot is live in v0.20 but no UI consumer yet.

### Added
- **Migration script: `scripts/migrate-references.mjs`.** Walks every `.md` under each profile, extracts prose `doc:` link targets, merges them into `references:`, strips any legacy `backlinks:` field. Dry-run by default; `--apply` to write. Idempotent — safe to re-run. Use for bulk backfill after the v0.19 → v0.20 upgrade; otherwise lazy migration on every save eventually covers the corpus.
- **`scripts/test-references.mjs`** exercises the new `computeBacklinksFor` + `syncReferencesFromProse` + `rebuildAllReferences` surface against a temp profile.

### Removed
- The `backlinks:` frontmatter field is no longer written. `writeToDisk` strips it from in-memory metadata before serialization; the migration script and rebuild endpoint strip it from disk in bulk.
- `updateBacklinksForSource` (the incremental pipeline) is now a no-op shim. Existing imports keep compiling; the function does nothing because backlinks compute live.
- Legacy prose-link granular fields (`from_node`, `to_node`, anchor `text` on Backlink entries) are gone from new computed output. They remain optional on the `Backlink` TypeScript interface only for reading stale frontmatter during migration.

## [0.19.0] - 2026-05-21

### Breaking
- **Enrichment schema simplified to three fields with clean authority separation.** v0.16's five LLM-written fields (`logline`, `domain`, `concepts`, `docRole`, `status`) collapse to three with one owner each: `logline` (LLM-written, ≤150 chars), `status` (agent-written: `canonical` | `draft`), `enrichmentStale` (system-written). The dropped fields were doing demonstrably worse than the alternatives — `domain` had no vocab discipline (the enricher invented values like `Biology`, `World History`, `Cooking`, and `Project Management` all coexisting in the same workspace), `concepts` mixed kinds of label (`citation-register` next to `world-history`) so filter accuracy degraded, `docRole` was strictly worse than parsing the title (which encodes the role with 100% reliability in any conventioned workspace), and the LLM-written half of `status` could only pattern-match `(SUPERSEDED` from titles. The principle: each metadata field gets exactly one owner, and each owner is only asked to do what they're structurally capable of. Per-doc enrichment payload shrinks from ~150 tokens to ~60; a 60-doc workspace crawl drops from ~6K to ~3.5K tokens.

### Changed
- **`mark_enriched` schema is strict and accepts only `{ docId, logline }`.** Passing `domain` / `concepts` / `docRole` / `status` fails zod validation. Each call also retires legacy fields from frontmatter (deletes `domain`, `concepts`, `docRole` from the merged metadata before writing) so disk converges to the new schema as each doc gets re-enriched — lazy migration, no batch sweep script needed.
- **`crawl` filter set updated.** Drops `domain`, `concepts`, `docRole` filters; adds `status: "canonical" | "draft"`. The common query — "what's load-bearing on topic X" — is now `crawl({ status: "canonical" })`. `tags` and `hasLogline` filters unchanged.
- **`create_document` gains optional `status` parameter.** Defaults to `draft` when omitted. Use `status: "canonical"` for docs committing to the workspace spine at creation time (Beats locks, Research Notes, Master References).
- **`set_metadata` documents the lifecycle convention.** `set_metadata({ status: "canonical" })` when a doc commits; `set_metadata({ status: "draft" })` when superseded. Status is the agent's field — the enrichment minion never writes it.
- **Enrichment minion prompt collapsed.** Dropped per-field guidance for the four removed fields; single instruction: "read body, write logline ≤150 chars, batch one mark_enriched call." Worked example shrinks to one JSON line. Tools list drops `get_workspace_structure` — the minion no longer needs to read workspace vocab.
- **Crawl output omits legacy fields even when they exist on disk.** Read-side stripping makes v0.18 frontmatter invisible to the v0.19 crawl response. Disk data stays untouched until the next `mark_enriched` retires it. Tools that surface enrichment in user-facing text (`list_documents`, `get_workspace_structure`, `get_item_context`, `search_docs`) reduced to the three-field shape.
- **SKILL.md bumped 0.8.1 → 0.9.0.** Firm rule 5 documents the three-field schema; the enrichment section is rewritten around the authority table (LLM owns logline, agent owns status, system owns staleness).

### Removed
- Frontmatter fields `domain`, `concepts`, `docRole` are no longer surfaced by any tool. Legacy values on disk persist until each doc's next `mark_enriched` call retires them naturally.

## [0.18.1] - 2026-05-21

### Changed
- **Enrichment minion runs in orchestrator mode by default; footer/instructions now include the exact dispatch call inline.** Acting agents no longer need to compose a prompt or pass a docId list — they copy a single args-less line: `Agent(subagent_type: "openwriter-enrichment-minion", run_in_background: true)`. The minion calls `list_dirty_docs` itself, self-bounds the batch (~12 docs per run), reads each, generates the YAML, and batches a single `mark_enriched` call. The acting agent's burden collapses from "read the footer's count, look up which docs are dirty, type out a dispatch with the list" to "paste one line." The minion definition was already self-discovery-capable; this release flips the default framing and updates the surfacing strings to advertise it. Skill bumped 0.8.0 → 0.8.1. Tests: 17/17 enrichment surfacing pass; live no-args dispatch test drained a 39-doc backlog in one run.

## [0.18.0] - 2026-05-20

### Added
- **`afterId` parameter on `create_document`, `create_container`, and `declare_writes`.** New optional 8-char hex parameter accepts either a docId or a containerId; the new item lands immediately after the referenced node inside its parent. Resolves docId → filename automatically via `filenameByDocId`, falling back to literal for containerIds. Eliminates the need for a follow-up `move_item` pass when an agent wants surgical placement at create time — for example, inserting a new beat's prose doc immediately after the chapter's Beats doc, or dropping a Drafts sub-container at the very bottom of a chapter container in one call.

### Changed
- **New documents and containers now default to the BOTTOM of their parent's child list.** Previously they landed at the top (via `unshift` in `addDocToContainer` and `addContainer`), which violated the ascending-order convention (Ch 1 at top, Ch N at bottom; B1 at top, BN at bottom) every single time an agent created something — forcing a clean-up `move_item` pass on every create. The defaults are now `push` (append to end) so new items land in convention position the first time. Agents that need top-insertion or precise placement use the new `afterId` parameter. Behavior change for every caller that relied on top-insertion: the browser sidebar drag-create, Google Doc import, autoplug-link container creation, and the workspace HTTP API. None depended on top-positioning semantically — all benefit from the convention-aligned default. Skill bumped 0.7.6 → 0.8.0.

## [0.17.0] - 2026-05-20

### Added
- **Phase 1 footnote system — CommonMark `[^N]` references + end-of-doc definitions block.** Inline atoms render as auto-numbered display chips (CSS counters); definitions live in an isolating ProseMirror section pinned at end-of-doc. Roundtrips cleanly through markdown via `markdown-it-footnote` and the matching serializer. Per-doc scope — each chapter (each `.md` file) gets its own numbering, so book projects organize footnotes by file. Editor toolbar button and `Mod-Shift-f` keybind insert a reference and matching definition stub. Compact format (`read_pad`) renders footnote nodes as `[^label]` / `[^label]: text` so agents can see what's there. Phase 1 is editor-side only — pagination and per-page placement are deferred to the future book-export pipeline. Design doc: `docs/footnotes.md`. ADR: `adr/footnote-system.md`. Full agent how-to: `skills/openwriter/docs/footnotes.md`. Skill bumped 0.7.5 → 0.7.6.

### Changed
- **Enrichment drift threshold tightened + meta-descriptive logline guidance dropped.** Drift detection now fires on smaller edits (matches user intuition about when a doc has changed enough to re-enrich). The minion's logline guidance simplified to "précis (non-fiction) or logline (fiction); under 250 chars; describe the content, not the kind of doc" — dropping prescriptive bad/good examples that were biasing minions toward meta-descriptive ("This document is...") openers.

### Fixed
- **Accept-all dropped body content under canonical+overlay model.** The `transferPendingAttrs` call in `updateDocument` was re-stamping server pending markers onto the browser's cleared doc *after* the version gate had already accepted the merge — `stripPendingFromDoc` then filtered those re-stamped nodes out as if they were inserts, dropping the body. Symptom: `populate_document` followed by Accept All produced an empty body. The version gate above renders the safety net redundant and actively harmful under the new model, so the `transferPendingAttrs` call is gone. Regression from `fb666e6` (canonical+overlay refactor).
- **`restore_version` preserves the user's current autoAccept toggle.** Snapshots captured before the user toggled autoAccept off used to silently flip the preference back on at restore time. The handler now surgically edits the snapshot's frontmatter to match the in-memory `autoAccept` state before writing — body and all other metadata untouched. Resolves inbox brief `2026-05-18-restore-version-resets-autoaccept-flag.md`.
- **Trailing empty paragraph stripped from serialized markdown.** Was leaking an `<!-- -->` comment marker between the last body block and the footnote section (or just at end-of-doc on any document). Serializer now drops trailing empty paragraphs unconditionally before emitting. Doesn't touch middle paragraphs.
- **ProseMirror cursor-landing paragraph hidden after isolating footnote section.** ProseMirror auto-inserts a `<p><br class="ProseMirror-trailingBreak"></p>` after `defining: true, isolating: true` blocks; CSS rule `.tiptap section.footnotes ~ p { display: none; }` hides it. Disk markdown stays clean — this is editor-side display only.

## [0.16.0] - 2026-05-19

### Added
- **Frontmatter enrichment system + crawl-then-read pattern.** Every doc now carries a five-field enrichment block — `logline` (≤150 chars, one-sentence "what is this doc about"), `domain` (workspace-aligned classification), `concepts` (3–8 lowercase-hyphenated terms-of-art), `docRole` (canonical/vignette/reference/draft/chapter/beat/scratch), `status` (draft/canonical/stale). Agents can now scan a workspace at concept level (~150 tokens/doc via `crawl`) instead of reading every body. OpenWriter detects drift on every save via per-block sentence-hash Jaccard distance (default 0.3 threshold) and character-volume ratio (default 1.5x), stamping `enrichmentStale: true` automatically. Three new MCP tools: `list_dirty_docs` (returns identity + reason only, no bodies; respects `enrichmentDisabled` workspace opt-out), `mark_enriched` (bulk array; OpenWriter computes the baselines), `crawl` (bulk-read enrichment fields with AND-composed filters on `domain`/`tags`/`concepts`/`docRole`/`hasLogline`). Dirty-doc counts surface through `ENRICHMENT_STATUS` in MCP init instructions and a `⚠ N docs need enrichment` footer on `list_documents` / `list_workspaces` / `get_workspace_structure` — no hook setup required. Workspaces gain optional `vocab` (closed-set domain values), `schema`, `logline`, `domain`, `relatedWorkspaces`, `enrichmentVolumeThreshold`, `enrichmentDriftThreshold`, `enrichmentDisabled` fields; containers gain `logline` + `role`. `get_item_context` and `get_workspace_structure` now include enrichment for progressive disclosure. Total MCP tools: 67 (47 core + 21 publish plugin) — up from 65.
- **Custom Claude Code subagent — `openwriter-enrichment-minion`.** Allowlist-restricted to four MCP tools (`list_dirty_docs`, `get_workspace_structure`, `read_pad`, `mark_enriched`) so it spawns with ~3K tokens of tool registry instead of the ~50K-token full registry that general-purpose subagents inherit. Installed by `npx openwriter install-skill` to `~/.claude/agents/openwriter-enrichment-minion.md`. The main agent dispatches it via `subagent_type` whenever the dirty-doc signal surfaces; the minion reads each doc, synthesizes the five fields, and bulk-stamps once via `mark_enriched`. Verified live: 12K tokens for a single-doc spawn vs 73K for the general-purpose path — 6x reduction holds across batches. Agent file enforces 140-char logline target / 150-char hard cap with explicit rewrite guidance, `maxTurns: 500` to clear the turn ceiling on larger batches, and an explicit-list mode so the orchestrator can hand it specific docIds and skip `list_dirty_docs`.
- **Chunked parallel dispatch for large corpora.** New `docs/enrichment.md` in the openwriter skill teaches the orchestrator to chunk dirty docs into 8–15 per minion grouped by workspace, then dispatch every chunk in a single assistant message with `run_in_background: true` so they run concurrently. Validated live: 129 docs across 14 workspaces enriched in ~3 minutes wall time at ~$0.50 in Haiku tokens, vs ~3 minutes per ~30 docs if serialized.
- **Skill firm rule for enrichment dispatch.** SKILL.md firm rule 5 now teaches the main agent to treat enrichment surfacing as a maintenance reflex (like the inbox protocol), with tiered surfacing phrasing (silent dispatch ≤5, brief explanation 5–20, heads-up first 20–30, chunked parallel >30) and a `update_workspace_context({enrichmentDisabled: true})` opt-out for workspaces the user doesn't want enriched. `install-skill` and the npm `prepublishOnly` script now ship the custom-subagent file and the new skill doc alongside SKILL.md so the install path is one command.

### Changed
- **Matcher frontmatter shrunk ~87% from v0.14 baseline.** Two compaction passes: compact v0.15 fingerprint format (~50% shrink — drops verbose per-block field names) followed by ultra-lean positional tuple format (additional ~75% on what remained). Position is now derived from array index instead of stored explicitly; slim entries skip the per-block body parse on load. Saves on every disk write across the workspace.
- **Sidebar tags ride on `/api/documents`.** Eliminates the N+1 doc-tags fetch the sidebar previously issued on every workspace render. Large workspaces feel materially snappier.
- **Editor instance stays stable across content prop changes.** Was previously recreating the full TipTap editor on every content update; new content-prop watcher reuses the existing editor instance and feeds it transactions instead. Cuts re-mount jank during rapid sidebar navigation.

### Fixed
- **Save no-op gate eliminates wasted serialize on doc switches.** Server-side guard: if the canonical doc hash hasn't changed since the last successful save, the save path short-circuits before serializing. Cuts background CPU spent on sidebar-driven phantom saves.
- **`reload_from_disk` refreshes frontmatter to match new body.** Previously `state.metadata` could drift from disk frontmatter after external writes — body was reloaded but the in-memory metadata stayed at the pre-external-write snapshot. Now reload is paired: canonical content and canonical metadata refresh in lockstep.
- **Container nodes become first-class pending entries.** Container-level inserts and rewrites now participate in the overlay properly instead of being silently dropped between the matcher and the bridge.
- **Auto-accept and reload banners stack cleanly when both visible.** Was overlapping at the top of the editor.
- **Titlebar truncates long titles + keeps sync count on one line.** Was wrapping awkwardly when titles ran long.

## [0.15.0] - 2026-05-17

### Added
- **Pending overlay system — disk stays canonical, pending state lives in a sidecar.** Pending agent rewrites/inserts/deletes awaiting review used to live in the `.md` file's YAML frontmatter as `meta.pending`. They now live in `~/.openwriter/profiles/<profile>/_pending/{docId}.json` sidecars. Disk body = canonical only; pending state travels alongside but never pollutes greps, backups, diffs, or external-tool reads of the markdown. Sidecars are bound to docId existence: delete retires the sidecar, archive/unarchive preserves it, rename is a no-op (sidecar is docId-keyed not path-keyed). Round-trips through `restore_version`, external edits, and switch-document all stay clean because the canonical write path and the overlay write path are now structurally paired at every emission site.
- **Comments system (renamed from "agent marks") with hover popover.** Right-click selected text → leave a comment with a note. Hover-anchored popover renders one card per comment, with multiple comments on the same range stacked as siblings sorted oldest-first. Each card has four icon actions: Edit, Add (sibling on same range), Resolve, Delete. Resolve is now distinct from Delete — resolve = "addressed, archive it" (the record stays, filterable via `includeResolved: true`); delete = "remove the record entirely." Default agent comment-fetch scope is workspace, not document, so agents see comments across the whole project.
- **External-write detection + persistent reload banner.** Server watches the active doc via `fs.watch`. Any external write (Edit tool, VSCode, scripts) reloads canonical from disk, re-attaches the pending overlay by nodeId, and surfaces a banner in the editor with orphan and stale-baseline counts. Banner persists until the user dismisses it and coalesces counts across stacked reloads. Pending decorations re-attach to surviving nodes; entries whose anchor nodeId vanished become "orphan" (rewrites → inserts at end of doc, deletes discarded); entries whose target content drifted from the captured baseline are flagged stale via the `pendingStaleBaseline` attribute.
- **Structured JSON logging with request correlation.** Every MCP / WS / HTTP request gets a correlation ID that threads through every log line for that request. Errors-only by default with redacted-text — public-safe out of the box. Per-machine overrides via `~/.openwriter/log-config.json`. Logs land at `~/.openwriter/profiles/<profile>/events.log` as one-event-per-line JSON, plus legacy text channels for the bridge logs.
- **Per-doc auto-accept inheritance UI.** Sidebar shows inherited auto-accept state via subtle dot indicators on containers and docs that inherit from a parent.
- **Google Docs / Word paste cruft auto-cleaning.** A TipTap input transformer strips Google Docs / Word boilerplate spans, comment markers, and inline styles on paste, so agent rewrites can target clean text instead of accidentally landing inside an exported `<span style="...">` wrapper.
- **Live integrity verifier tool.** New developer tool walks every doc in the active profile and verifies frontmatter `nodes:` matches body, no orphan IDs in `graveyard:`, no duplicate IDs across the workspace.

### Changed
- **Canonical + overlay are now primary in-memory state.** `PadState` has `canonical: PadDocument` and `overlay: Map<string, PendingEntry>` as primary fields; `state.document` (the merged view) is derived from them via `applyOverlayPure` and refreshed by `recomputeMerged()` after every mutation. Direct assignment to `state.document` is forbidden — all writes route through sanctioned helpers (`setCanonical`, `setOverlayFromEntries`, `setPrimaryFromMerged`). Closes a class of cache-corruption bugs where the cache stored a hybrid that was neither canonical nor merged.
- **Sync-merge replaces stale-version reject.** Browser doc-updates with `browserVersion < serverVersion` used to be rejected silently — preserving agent work but discarding the user's in-flight typing. The server now merges instead of rejecting: browser's canonical view is authoritative for content, server overlay entries the browser hadn't seen are preserved (via a new `addedAtVersion` field on entries), conflicts resolve server-wins (the user can reject via the normal review UI if they disagree).
- **Agent write lock scoped per-document.** Was a global lock; an agent writing to doc A would block any browser autosave on doc B for the lock TTL. Now a per-docId map, so concurrent agent activity across docs no longer cross-blocks browser typing.
- **Agent-stub status is session-level, never persisted to disk.** Previously `agentCreated: true` lived in frontmatter and survived across sessions; a years-later reject-all could destroy real work. Stub status now lives only in the in-memory registry during the brief window between `create_document` and the first accepted save.
- **One canonical path per physical file (`CanonPath` branded type).** Path normalization happens at every WS / MCP / HTTP boundary so the same file can never be registered under both forward-slash and backslash variants. Closes a duplication class where `C:\Users\me\...` and `C:/Users/me/...` were treated as separate documents sharing the same disk file.
- **`reload_from_disk` and external-write detection share one pathway.** Both now route through the same reload function, eliminating an asymmetry where MCP-driven reload and watcher-driven reload reattached pending overlay slightly differently.
- **Sidebar barbell brightness hierarchy.** File tree's visual weight emphasizes the active doc and recently-touched docs more strongly; old / cold docs fade. Reduces sidebar noise on large workspaces.
- **Save-time matcher now broadcasts ID rewrites to all connected clients.** Whenever the matcher reassigns a block ID at save time, the server emits an `id-rewrites` WebSocket message carrying the `{oldId, newId}[]` mapping. Browser clients walk their in-memory TipTap doc and call `setNodeMarkup` for each match in a single atomic ProseMirror transaction, so the browser converges to the server's authoritative ID assignment after every save. New listener API: `onIdRewrites(listener)` in `server/state.ts`; new browser export `applyIdRewritesToEditor(editor, rewrites)` in `src/decorations/bridge.ts`.

### Fixed
- **Phantom autosaves on unchanged documents.** TipTap's `onUpdate` fires on any transaction — server-pushed state, reconnect rehydration, decoration plugin transactions, and React re-renders with new `initialContent`. Each of those previously triggered the 1s client autosave, which round-tripped back to the server as if it were a real edit and could resurrect overlay entries the server had already resolved. The client now diff-gates: compares current editor JSON to the last successfully synced state and skips the send if they match. Baseline resets on `document-switched` / `document-reloaded`. Server-side, the two independent `debouncedSave` timers (state.ts 500ms + ws.ts 2s) consolidate into a single 500ms timer.
- **False stale-baseline indicator (dotted underline) on rewrites.** `stripPendingFromDoc` stripped pending markers from rewrite nodes but left the rewrite text in canonical content. Any path that round-tripped a merged doc back through `splitMergedDoc` produced canonical with rewrite text where original should be. The next merge then compared canonical-as-rewrite to baseline-as-original, saw they differed, and stamped `pendingStaleBaseline: true` — surfacing the dotted underline indicator even though nothing had drifted. Disk stayed clean (the serializer's revert path was correct); only the in-memory canonical drifted. Fixed by mirroring the serializer in `stripPendingFromDoc` — restore from `pendingOriginalContent` before stripping markers.
- **Duplicate-insert bug (the "BRIDGE rendered 4 times" class).** `applyOverlay` mutated its input canonical doc and didn't check whether a node with the insert entry's nodeId already existed before splicing. Combined with the cache storing the merged hybrid and the cache-restore path re-running apply on its own output, every switch-away/switch-back to a doc doubled the count of pending-insert nodes. New `applyOverlayPure` enforces idempotency structurally; `splitMergedDoc` separates cache writes into canonical + overlay so re-apply always runs on clean canonical, never on its own output. One-time `repairOverlaysOnStartup` heals existing corrupt sidecars on first boot.
- **Preview-swap echo to server (silent rewrite corruption).** Clicking "Show original" on a pending rewrite in the review panel emitted a doc-update carrying the original content with `pendingStatus=rewrite` still set. Server couldn't distinguish from a real edit. Next save extracted an overlay entry where `newContent === originalBaseline` — degenerate identity rewrite, nothing to review, but persisted forever. Fix: set the preview-suppress flag BEFORE swapping content in both single-node and group branches of `togglePreview`, with rollback if the swap fails.
- **Symmetric overlay save on non-active write paths.** `populate_document` / `write_to_pad` / `edit_text` / `applyChanges` on a non-active doc used to drop pending content silently — canonical was written to disk, overlay sidecar was not. A 25-word populate produced a 0-word file with no sidecar. All non-active write paths (`flushDocToFile`, `saveDocToFile`, `stripPendingAttrsFromFile`) now paired-write canonical and overlay in the same pass.
- **`deleteDocument` orphaned the overlay sidecar.** Sidecar was bound to docId; delete moved the .md to trash but left the JSON behind. Now retires both in lockstep. Archive/unarchive correctly preserves the sidecar (so unarchive can resume the review queue); rename is a no-op (sidecar is docId-keyed).
- **External-write auto-save clobber window.** During an external write to the active doc, the browser's pre-write autosave could fire with stale state and overwrite the just-landed external content. New guard: any external write bumps `docVersion`, the browser's stale autosave is version-rejected. `document-reloaded` carries the post-bump `docVersion` so the browser updates its `docVersionRef` and subsequent post-reload typing isn't silently blocked.
- **`restore_version` corrupted pending state and could cascade deletes.** Now writes a canonical-only checkpoint, clears stale pending entries that no longer attach to surviving nodeIds, and guards against delete cascade via the agent lock.
- **Doc context menu now respects inherited auto-accept state.** Was reading only the per-doc flag, missing inherited values from parent containers / workspace.
- **GFM table roundtrip + ID-rewrite convergence.** Two live-log bugs fixed in the same pass. Tables with blank-line separated rows now roundtrip cleanly; matcher ID rewrites converge instead of looping.
- **Sidebar spinner indent fixed.** Container-targeted writes now show the spinner at the container level instead of at the wrong nesting depth.

### Fixed (originally documented for 0.14.1 — never published independently, rolled into 0.15.0)
- **`link_to` silently operated on the wrong doc and falsely reported duplicates.** Schema took no `source_doc_id`; the handler walked `getDocument()` (the active doc) to find the anchor text. When the user clicked a link in the browser the active doc silently changed, the agent's next `link_to` call landed in the wrong doc, and the result message ("Linked X in node Y") referenced a node the agent had never asked about. Combined with the v0.14.0 matcher bugs (since fixed), the same session produced apparent "duplicate paragraphs" — the agent's `read_pad` IDs were stale by the time `link_to` ran. Fix: `link_to` now requires an explicit `source_doc_id`, dispatches active-vs-non-active just like every other tool (`applyTextEdits` for active, `applyTextEditsToFile` for non-active), and returns a JSON object with the source docId, source filename, node id operated on, and href so the agent can verify. Repeat-call semantics defined: repeat `link_to` calls with the same anchor + same href skip any occurrence already wrapped with that href and find the next plain-text occurrence, returning a clear "all N occurrences already linked" message when there's nothing left to wrap. `applyTextEdits` also now returns descriptive error messages including a 240-char excerpt of the actual node text when no edit matches, so agents can diff unicode/whitespace mismatches (em-dash vs hyphen-minus, NBSP vs space, smart quotes, etc.) without guessing.
- **Doc-level links scroll to top of target doc instead of leaving the editor at the prior doc's scrollTop.** Clicking a `doc:DOCID` link (no `#nodeId`, no `?q=quote`) now sets `pendingScroll.toTop`, which the post-mount scroll consumer applies as `editorContainer.scrollTop = 0`. Without this, the editor container kept whatever scrollTop the previous doc left behind, which felt like a "scroll to bottom" bug. Browser back/forward still restores the saved scroll position for the destination entry (separate code path, unchanged).
- **Silent table corruption from `applyIdsToTiptap` descending into tables.** The matcher's identity walker (`tiptapToBlocks`) treats tables as opaque — emits one Block per table, doesn't descend into rows / cells / cell paragraphs. But `applyIdsToTiptap` (which writes the matcher's pinned IDs back onto the TipTap tree) descended INTO tables via a too-broad `CONTAINER_TYPES` check that included `table`, `tableRow`, `tableCell`, `tableHeader`. Result: the position counters diverged. The matcher's pin for "position N = the target-total paragraph at top level" got applied to whichever table-internal node `applyIdsToTiptap` happened to find at its descended position N. The target-total paragraph ended up with a fresh ID; a table row ended up wearing the paragraph's ID. From there any subsequent rewrite targeting the paragraph's old ID could (depending on whether `findNode` descended) silently corrupt the table. Verified end-to-end on the Beat Sheet doc: an 8-op multi-batch (1 table rewrite + 1 paragraph rewrite + 6 chapter h2 rewrites) now applies cleanly with no skips, accurate `appliedCount`, and zero table corruption. Fix: `applyIdsToTiptap` now descends ONLY into `bulletList`, `orderedList`, `taskList`, `listItem`, `taskItem`, `blockquote` — mirroring `walkNodes` exactly. Counter alignment is restored.
- **Silent table corruption from `findNode` descending into tables.** `write_to_pad` rewrites and deletes resolve their target via `findNode`, which did a depth-first recursive descent and returned the first ID match anywhere in the tree. Table-internal node IDs are regenerated on every `markdownToTiptap` parse via `parseTableTokens` (the matcher never tracks them) and are never exposed by `compactNodes`, so any agent-provided ID that happened to collide with a table-internal node — even a random 8-hex collision across many saves — silently routed the splice INTO the table cell instead of hitting the intended top-level paragraph. The agent saw `appliedCount` go up and assumed success; the target paragraph stayed untouched and an empty paragraph appeared inside the table. Documented in the `2026-05-17 write_to_pad multi-op batches unreliable` brief on the Beat Sheet doc. Fix: `findNode` now skips descent into `OPAQUE_CONTAINER_TYPES = {table, tableRow, tableCell, tableHeader}` — mirroring the matcher's existing opaque-table convention. Every layer of the system (matcher, compactNodes, parseTableTokens, findNode) now agrees that table internals are not addressable. The collision class disappears entirely.
- **Silent data loss when MCP writes to a doc open in the browser.** The save-time matcher introduced in v0.14.0 unconditionally minted a fresh ID for every newly-inserted block — overwriting the ID `applyChangesToDocument` had just stamped and broadcast to the browser. The server's view of the new block diverged from the browser's: subsequent server→browser updates targeting the rewritten ID silently failed in the editor bridge (the anchor lookup returned null and the change was dropped), the browser's debounced autosave then shipped its stale TipTap state via `doc-update`, and the server accepted it because the agent lock had expired, the version stamp matched, and the destructive-size threshold hadn't tripped. Net effect: MCP writes appeared to succeed (version history confirmed the writes) but vanished ~45 s – 2 min later when the autosave fired. Fixed by carrying `attrs.id` through `tiptapToBlocks` into the matcher's `Block` interface and having `applyInsertRule` preserve `candidate.block.id` when present (with `claimedPrevIds`/`claimedGraveIds` updated to prevent the same ID landing in both `nodes:` and `graveyard:`). Slot-continuity additionally skips candidates whose ID is already known to `previousNodes` or `graveyard`, so paste-back and snapshot-restore route through `applyGraveyardRestoreRule` instead of being absorbed by a positional slot match. The bridge's anchor-lookup `continue` and the WebSocket client's `docVersionRef` bump both got defense-in-depth changes: the bridge now logs a `console.warn` when a node ID can't be resolved, and the version bump now happens after the apply callback returns so a thrown apply doesn't lie about success.

## [0.14.0] - 2026-05-16

### Added
- **Node-identity matcher subsystem.** Block-level identity now survives every kind of edit — type-change, paste-back, slot reorder — without polluting the markdown body. Identity lives entirely in YAML frontmatter as `nodes: [{id, fp}, ...]` (per-block math-first fingerprints: charCount, 3-char prefix/suffix, terminator, word-length sequence, full word array) plus a `graveyard:` rolling cache of recently-deleted block fingerprints for paste-back recovery. The matcher runs at both load time AND save time — comparing current TipTap state against the disk's last-saved node graph — so within-session edits reconcile correctly instead of waiting for a doc reload.
- **Sync observer.** Every save re-parses the just-written markdown and logs to console if the TipTap → markdown → TipTap round-trip changes block shape. Catches silent drift before it propagates.

### Changed
- **Markdown body is now completely clean.** No more trailing `^xxxxxxxx` caret anchors on paragraphs and headings. All identity tracking moved to frontmatter. Existing docs with caret anchors continue to load (fallback parsing preserved) — they shed the anchors on next save.
- **Disk is the single source of identity truth.** The save-time matcher reads `previousNodes` + `graveyard` directly from the existing file's frontmatter before serializing. No parallel in-memory cache mirrors the disk — markdown is always live.

### Fixed
- **Type-change preserves block ID in-session.** Rewriting a paragraph as a heading (or vice versa) used to mint a new ID until next reload; now the matcher's type-change rule fires on every save, keeping backlinks valid.
- **Paste-back restores block ID from graveyard in-session.** Deleting a paragraph then pasting it back used to mint a new ID; now the matcher matches the pasted fingerprint against the graveyard and restores the original ID. Same for delete + restore via undo.
- **Multi-row markdown tables auto-heal blank-separated input.** Agents writing tables with blank lines between rows (`| row |\n\n| row |`) used to break the structure into a 1-row table plus N orphan paragraphs; the broken shape then persisted across every save. New parser pre-pass strips blank lines inside confirmed table regions before tokenization. Existing broken docs heal on next load + save. Code fences are honored — pipes inside ` ``` ` blocks are untouched.

## [0.13.0] - 2026-05-14

### Added
- **Cross-doc linking system.** Internal `doc:DOCID#NODEID?q=quote-snippet` href format with stable 8-char docId in frontmatter and persistent paragraph nodeIds. NodeIds round-trip through markdown via trailing ` ^xxxxxxxx` caret anchors, so renaming a doc, moving a paragraph, or rewording the quote all degrade gracefully through layered fallbacks (docId → nodeId → quote text). Three new MCP tools: `link_to` (create a link to a paragraph in another doc), `search_docs` (find docs/paragraphs by text), `get_graph` (forward + back link graph). Total MCP tools: 65 (44 core + 21 publish plugin).
- **Backlinks pipeline.** When a doc saves, server extracts forward links and updates the target docs' `backlinks` frontmatter so each doc knows who links to it. Maintained automatically on every save — no manual rebuild.
- **Backlinks UI.** Linked paragraphs get a subtle dotted underline. Right-click → "See connections" lists every doc that links to this paragraph, click-to-jump. Clicking an internal `doc:` link switches docs and scrolls to the target paragraph (with a brief flash to find it).
- **Manual paragraph picker for cross-doc links.** Right-click → "Link to doc" now has a `▸` drill button on each doc row. Pick a specific paragraph instead of only being able to link the whole doc; agent path already supported this, now the manual UX has parity.
- **Workspace + container level auto-accept with inheritance.** Set auto-accept once at any level (workspace, container, or individual doc); descendants inherit. Sidebar shows a discreet dot on inheriting containers/docs.
- **Cascade delete for containers.** Deleting a folder optionally deletes its documents too instead of orphaning them to the root "documents" folder.
- **Edit existing agent mark notes.** Right-click an agent mark → "Edit note" instead of having to delete and re-create.
- **External links open in new tab.** `http(s)`, `mailto:`, `tel:` clicks in the editor now open in a new tab. Were inert before because `openOnClick:false` was set globally for `doc:` link routing.

### Changed
- **Browser back/forward navigates within OpenWriter.** Top-bar buttons and the browser's own back/forward both walk the same in-app navigation stack via `history.pushState`. Previously the URL never changed and browser back exited the app entirely.
- **Sidebar polish.** Chevrons live on the workspace header (not on every container), dark-mode quote color is now visible, ESC no longer closes modals in unintended ways.
- **Skill leaner (v0.7.0).** Voice frames + anti-ai pass extracted into standalone companion skills (`voice-presets`, `anti-ai`). The openwriter skill no longer ships them internally — install separately if you want them.
- **Skill clarification (v0.6.1).** `switch_document` is for grabbing the user's attention, not for navigation. Skill now spells this out.

### Fixed
- **Mass-deleted orphaned files no longer reappear** briefly during the post-delete re-fetch — server now tracks pending deletions and filters them out of subsequent responses.
- **`doc:` protocol allowed in PadLink.** TipTap 3's `isAllowedUri` was rejecting custom schemes by default; added an override so internal links survive paste / mark application.
- **Internal `.doc-link` no longer renders a double underline on hover.** A duplicate CSS rule in `decorations/styles.css` was stacking a border-bottom on top of the canonical underline from `canvas-styles.css`. Removed the dupe.

## [0.12.1] - 2026-05-12

### Removed
- **Worktree-aware bin walk-up** (v0.12.0 only) — the bin walked up from `process.cwd()` looking for a local openwriter source tree and re-exec'd into its dist. The feature was developer-only and crashed on Windows with `ERR_UNSUPPORTED_ESM_URL_SCHEME` whenever the user was inside any openwriter repo. Removed entirely; v0.12.1 has the simple bin from v0.11.0.

## [0.12.0] - 2026-05-12

### Added
- **Per-doc auto-accept mode** — right-click a doc in the sidebar to turn on auto-accept. Agent edits commit directly with no pending decorations, no review panel for that doc. Used during fast drafting where the user isn't reviewing as the agent writes. Persisted in frontmatter as `autoAccept: true`. Active doc shows a status banner; sidebar entry shows an amber pill. `get_pad_status` surfaces the flag so the agent stops polling for review.
- **Worktree-aware bin** — `bin/pad.js` walks up from `process.cwd()` to find the nearest openwriter source tree and re-execs into its `dist/`. Inside any worktree → that worktree's build runs. Inside main → main runs. Anywhere else → the global-link target runs (no regression for end users). Eliminates manual `npm link` switching between branches.
- **Skill v0.6.0** — new "Auto-accept mode" section documenting `autoAccept: true` so agents adapt their cadence (stop polling when on, respect `pendingChanges` when off).

### Fixed
- **`<` inside inline code marks no longer HTML-escapes on save.** Round-trip preserves `` `C:/<product>/` `` exactly; previously `<` silently became `&lt;` between backticks, corrupting paths in markdown files.
- **`<tag>`-looking text in prose no longer drops silently.** The `html_inline` token handler now emits raw text for anything other than `<br>` (our hardBreak sentinel) so user content like `Foo <bar> baz` doesn't vanish on first open. Round-trip is stable after the first save.

## [0.11.0] - 2026-04-18

### Added
- **`declare_writes` MCP tool** — agents declare filenames upfront before multi-doc creation; server tracks pending-writes registry so sidebar shows spinners on all target docs simultaneously instead of only the latest
- **Pending-writes registry** — server-side tracking of in-flight writes across multiple documents, emits `writing-finished` events reliably between doc transitions
- **Voice frames in skill** (v0.5.0) — 5 rhetorical frames (authority, provocateur, logical, storyteller, business) loaded from `voices/<frame>.md` via progressive disclosure. Triggered by phrases like "authority voice", "contrarian take", "first principles"
- **Anti-AI pass docs** — Tier 1 anti-AI cleanup protocol (`docs/anti-ai.md`) that runs after drafting

### Changed
- **Sidebar pending-write filtering** — sidebar now filters against all pending-write filenames in the registry, not just the latest one (previously only the most recent write showed a spinner)
- **Reply parent rendering** — tweet compose reply view now uses `TweetEmbed` component instead of custom parent quote card; skill guidance updated for thread conversion workflow
- **`writing-finished` event ordering** — always emitted before re-surfacing the next pending write, preventing UI state desync across sequential multi-doc writes
- **Prepublish script** — now bundles voice frames (`skill/voices/*.md`) and voice docs (`docs/voices.md`, `docs/anti-ai.md`) into the npm package alongside SKILL.md

## [0.10.0] - 2026-04-16

### Added
- **Sidebar multi-select** — shift-click to range-select docs, ctrl/cmd-click to add/remove individual docs, right-click selected for bulk delete with count badge
- **Variants** — non-destructive document transforms stored as typed variants under the source doc (separate from master, sidebar-visible)
- **Transform submenu** — plugin actions with 3+ items from the same plugin collapse into a "Transform >" submenu in the context menu
- **Writing spinner in Files mode** — variant generation shows spinner anchored to the source doc, not at list top
- **Optimistic sidebar actions** — create/rename/delete/move all update UI instantly; server confirmation reconciles in background

### Changed
- **Authors Voice plugin** — no longer registers sidebar transforms; publish plugin now owns all transform actions platform-side
- **Transforms architecture** — publish plugin owns transform orchestration, core owns variant storage and UI

## [0.9.3] - 2026-04-03

### Added
- **Insertion loading spinner** — visual feedback during insert/fill actions so users know content is generating
- **Sidebar section action buttons** — inline "+" and container buttons on Documents section and workspace headers, visible on hover
- **Tweet image handling** — inline image extraction from tweets, sharp compression for optimized delivery, hard-delete for image cleanup

### Changed
- **Multi-paragraph marks** — agent marks now span multiple paragraphs correctly; image paste persistence improved; toolbar tracks active editor instance

### Fixed
- **Skill thread docs** — updated thread insertion guidance: prefer full rebuild over fragile mid-thread insertion; documented image node gotchas (empty paragraph dependencies, bulk-delete orphan risk)

## [0.9.2] - 2026-03-26

### Added
- **Drag-and-drop in files sidebar** — full drag support matching card view: reorder docs, move between workspaces/containers, reorder workspaces. Depth-aware drop indicators show target nesting level with indented lines
- **Cross-workspace container moves** — drag a container (with all children) from one workspace into another
- **Container-to-workspace promotion** — drag a container onto a workspace header to promote it to a standalone workspace (children become root items)
- **Drop onto collapsed workspaces** — docs can be dropped directly onto collapsed workspace headers with accent highlight feedback
- **Folder right-click menu in card view** — backported workspace/container context menu (rename, new doc, new container, accept/reject all, delete) from files view to card sidebar

### Changed
- Files sidebar is now the default mode for new installs, appears first in appearance picker
- SVG chevrons replace tiny HTML entity chevrons in files tree

### Fixed
- Sidebar flicker when switching docs — decoupled workspace fetch from doc refresh key to prevent race condition where docs rendered with stale assignedFiles

## [0.9.1] - 2026-03-25

### Added
- **Files sidebar mode** — hierarchical file-system tree with content-type icons (X, LinkedIn, newsletter, blog, etc.), collapsible workspaces and containers with right-aligned chevrons, unified 36px row height
- **Batch accept/reject** — right-click a workspace or container → "Accept All Changes" or "Reject All Changes" to resolve pending changes across multiple documents at once (server-side batch operation)
- **Explicit `content_type` in frontmatter** — documents now store their content type (`tweet`, `article`, `linkedin`, `newsletter`, `blog`) as a first-class field, with backwards-compatible derivation from context keys for existing docs
- **Right-click context menus** — full context menu on all file tree rows: docs get duplicate/archive/delete/schedule/approve/plugin actions; workspaces and containers get rename/new doc/new container/delete/batch accept/reject
- **Double-click rename** — inline rename on docs, workspaces, and containers in the files tree

### Changed
- Shelf sidebar mode hidden from appearance picker (replaced by Files)

### Fixed
- Duplicate inserts via version counter and auto-chained batched inserts

## [0.8.8] - 2026-03-19

### Changed
- **`create_document` requires `content_type`** — no more untyped docs; all documents must declare their type at creation
- **`create_document` `url` param** — required for reply/quote tweet content types, used to fetch and embed referenced tweet
- **Connections panel gated on auth** — only shows when user has publish platform account
- **Image generation fallback** — falls back to publish platform's Gemini key when no local GEMINI_API_KEY configured
- **Auto-set X handle** — connecting X account auto-populates handle in tweet/article compose views

## [0.8.7] - 2026-03-19

### Fixed
- **Image generation error message** — invalid/missing Gemini API key now shows "API key may be invalid or expired" instead of cryptic `Unexpected token '<', "<!DOCTYPE"` JSON parse error. Fixed in both MCP tool and plugin HTTP route, plus client-side guards on all three compose views
- **Skill v0.4.2** — thread creation instructions now use `content_type: "tweet"` + `empty: true` + `write_to_pad` instead of broken `populate_document` pattern that caused agents to create threads incorrectly

## [0.8.6] - 2026-03-19

### Fixed
- **Publish plugin module path** — `helpers.js` used a monorepo-relative import path that broke in the flat npm package layout (`Cannot find module .../packages/openwriter/dist/server/markdown.js`). Now tries npm layout first, falls back to monorepo
- **`install-skill` permissions** — global install failure (EACCES) no longer aborts setup. Falls back to `npx -y openwriter` in MCP config so it works without sudo. Also skips sudo prompt when no TTY (Claude Code TUI)
- **`install-skill` updates** — now detects outdated global installs and updates to latest instead of silently skipping

## [0.8.5] - 2026-03-19

### Changed
- `create_document` tool description strengthened against `empty:true` misuse

## [0.8.4] - 2026-03-19

### Fixed
- Empty paragraphs created by `create_document` now get proper node IDs

## [0.8.3] - 2026-03-19

### Added
- **Billing MCP tools** — `get_billing`, `upgrade_plan`, `manage_billing` for plan management via agent
- **Billing UI** — billing section in plugin dropdown with plan info and upgrade flow
- **Skill v0.4.1** — metadata-first principle, tweet doc workflow, `get_subscribe_embed` tool docs

### Changed
- Pricing updated to $19/$49/$79
- Publisher upgrade button hidden until Publish module ships

## [0.8.2] - 2026-03-18

### Added
- **Tweet image NodeView** — X-style media card with cover crop, rounded corners, frosted glass remove button
- **Tweet image preview grid** — 2-4 images below editor in CSS grid layout, separate from ProseMirror
- **`get_subscribe_embed` MCP tool** — retrieve embed code for newsletter subscription forms
- **Auto-convert `<p>` to hardBreak** — tweet docs auto-merge separate paragraph nodes into single paragraphs with hardBreak, for both markdown and TipTap JSON inputs

### Fixed
- **Tweet image card rendering** — no black bands (global `.tiptap img` margin override), no square corners on hover (pending decoration background override on outer wrapper)
- **Partial range decoration offset** — hardBreak counted as 1 char in frontend `mapTextOffsetToPos`, matching server's `linearText`
- **Double-rewrite partial range** — compute against true original content, not intermediate rewrite, so offsets align with `pendingOriginalContent`
- **Hidden cursor paragraphs** — empty ProseMirror paragraphs after inline images hidden via CSS
- **Newsletter `send_newsletter`** — parse `subscriber_ids` JSON string correctly

## [0.8.1] - 2026-03-16

### Added
- **Tasks** — per-profile checklist persisted as `tasks.json`. Sidebar tasks panel with checkbox completion animation (400ms fade-out). 4 new MCP tools: `list_tasks`, `add_task`, `update_task`, `remove_task`
- Tasks icon in sidebar topbar (replaces density icon)

### Changed
- **Density control** moved from topbar dropdown to right-click context menu on Documents and Workspace section headers (set-and-forget preference, frees topbar slot)
- MCP tool count: 57 → 61 (40 core + 21 publish plugin)
- SKILL.md v0.4.0 — task management tools documented, session-start guidance

### Fixed
- Errant skills framework artifacts removed from repo

## [0.8.0] - 2026-03-15

### Added
- **Thread counter** — shows active tweet position (1/2, 2/3) in tweet compose footer
- **X-weighted char count in read_pad** — uses twitter-text `parseTweet` for official X character counting per tweet (✓ 248/280 or ⚠ 313/280)
- **twitter-text weighted counting** — emojis, CJK, and URLs now count correctly in the browser char counter

### Changed
- **require docId on all document-scoped tools** — `read_pad`, `get_pad_status`, `get_metadata`, `get_nodes`, `list_versions`, `set_metadata`, `create_checkpoint`, `restore_version`, `reload_from_disk` now require docId. Non-active docs read/written via cache or disk without switching browser view
- **merge generate_image into insert_image** — one tool, three modes: inline insert, set cover, or generate to disk only. `generate_image` removed (tool count: 56 → 55)
- **write_to_pad auto-replaces empty first paragraph** — first insert into empty doc silently converts to rewrite (green decoration, no red delete)
- **move_item handler** — cleaner comments, always reports "Moved"

### Fixed
- **Orphaned imageLoading placeholder** — hard-replace by type (not stale ID) + document-switched resync + strip from doc-updates. Browser-side rewrite uses single `tr.replaceWith()` instead of broken chain
- **Infinite render loop in TweetEditor** — `onReady` callback was unstable inline arrow; now uses `useRef`
- **Hard-delete paragraph deletes in tweet threads** — always hard-delete + remove adjacent HR + document-switched resync (pending deletes broke compose view)
- **Pending decorations invisible near HR boundaries** — CSS fix for hidden empty trailing paragraphs + node-changes buffer for resync race
- **Agent lock reset before tweet thread HR resync** — 3s window starts when browser receives new state, not from original insert
- **Partial range snap** — handles `.\n` sentence boundaries (not just `. `)
- **delete_document/archive_document** — remove doc from all workspaces (no stale "(missing)" references)
- **move_item cross-workspace** — remove doc from old workspace when moving across workspaces

## [0.7.0] - 2026-03-14

### Added
- **Scheduler: schedule_post redesign** — reads content + content_type from active document automatically, no content param needed. Sends doc_id for post history tracking
- **Scheduler: thread support** — auto-detects horizontalRule nodes, splits into tweet array, uploads images per tweet, queues as content_type "thread"
- **Scheduler: media upload** — extracts images from TipTap doc, uploads via platform's X API v2 OAuth 2.0 endpoint (media.write scope), includes mediaIds in queue content
- **Scheduler: naturalize_slots MCP tool** — scrambles slot times with per-day jitter so posts don't look scheduled
- **Scheduler: post history sync** — syncs posted items from platform to local doc frontmatter on server startup and schedule sidebar open
- **Doc approval** — right-click context menu checkmark, auto-accepts pending changes on approve, clears approval on send
- **Image paste/drop** in tweet compose mode
- **Images in tweet copy button**

### Changed
- **Scheduler timezone fix** — queue routing now properly converts slot times from configured timezone to UTC (was treating slot times as UTC)
- **Connection disconnect** — error handling + dark theme styling for confirm row, clears scheduler FK references before deleting
- **X OAuth scopes** — added media.write to OAuth flow, callback now uses exported constant instead of hardcoded string
- **Review panel** — hidden when current doc has no pending changes
- **Character counter** — expands circle from 26px to 30px when showing numbers, shrinks font for 2+ digit values
- **move_doc unified into move_item** MCP tool
- Newsletter subject-to-title sync fixes (debounce, flicker, persistence)

### Fixed
- Approve accept-all not persisting to disk
- Newsletter sent status leaking into new documents
- Character counter crash (showNumber referenced before initialization)
- Connection delete failing silently due to scheduler FK constraints

## [0.6.11] - 2026-03-13

### Added
- Timezone dropdown in Slot Settings — 27 curated IANA timezones, auto-detects from existing slots or browser
- Bulk timezone update — changing timezone updates all existing slots via PATCH
- Skill: IANA timezone convention note in Scheduling section

### Changed
- Slot Settings dropdown styled with proper theme vars (dark mode compatible, matches CreateDocDropdown pattern)

## [0.6.10] - 2026-03-13

### Changed
- Skill: added Author's Voice trigger words ("author's voice", "authors voice", "voice plugin")

## [0.6.9] - 2026-03-13

### Added
- Skill: "Updating" section with `npm install -g openwriter@latest` + `npx openwriter install-skill` instructions

## [0.6.8] - 2026-03-13

### Changed
- Update-available badge in titlebar when new version is available
- "Send as Newsletter" removed from sidebar context menu (newsletter docs only)
- "View Analytics" only shows in context menu for newsletter docs

### Added
- Author's Voice plugin setup pointer in skill (links to authors-voice.com for install)

## [0.6.7] - 2026-03-12

### Added
- Image loading placeholder — shimmer rectangle during image generation
- Partial-node decoration for agent rewrites — word-level diff with sentence boundary snapping highlights only changed sentences

### Changed
- External docs show "Remove" instead of "Delete" in sidebar (unlinks only, never trashes the file)
- Timeline sidebar horizontal spacing refined
- Image placeholder border-radius and vertical margins adjusted
- Floating toolbar hidden for node selections (images)

### Fixed
- External doc delete now unlinks only, never trashes the source file
- Trailing empty-paragraph sentinels stripped from external file saves
- Transient frontmatter for external files with title fallback

## [0.6.6] - 2026-03-12

### Changed
- Sidebar background colors refined — darker tones in both light and dark mode for better contrast
- Border colors unified across all CSS files — consistent `#ebebeb` light fallbacks replacing mixed `#e5e7eb`/`#d1d5db`/`#f0f0f0`
- Search bar icon and padding aligned with sidebar section headers
- Timeline card internal padding balanced — content area matches vertical spacing
- Timeline delete button uses absolute positioning matching tree sidebar pattern
- Timeline title ellipsis truncation now works on long titles (moved overflow to inner span)

## [0.6.5] - 2026-03-12

### Added
- Plugin setup hint — plugins with missing required config show "Ask your agent to set up..." inline guidance

### Changed
- Author's Voice plugin `api-key` marked as required config field

## [0.6.4] - 2026-03-12

### Added
- Autoplugs — UI panel, proxy routes, and MCP tools for automated content plugs
- Mark as Sent for articles and quote tweets

### Changed
- Plugin display order: Author's Voice, Publish, Image Generator, X/Twitter

### Fixed
- Plugins now ship with the npm package (were missing for npm install users)
- Mark-as-sent simplified to single click, persists through page refresh
- Disconnect button available for all connection types
- SKILL.md docId vs filename UUID clarification

## [0.6.3] - 2026-03-11

### Added
- Blog published status badge — green checkmark in compose view and sidebar (matches newsletter/tweet pattern)
- Resend-to-unopened feature in newsletter analytics
- Connection config modal for editing provider settings post-OAuth
- Welcome doc onboarding — first-time users get an orientation doc with pending changes
- `install-skill` now copies skill docs directory alongside SKILL.md

### Changed
- SKILL.md v0.2.3 — onboarding welcome doc, populate_document warning, tweet paragraph spacing docs

### Fixed
- Blog publish pipeline — correct YAML frontmatter, slug-based filename, image path rewriting
- Inline images collected and uploaded during blog publish (not just cover image)
- Browser doc-updates no longer overwrite agent writes in tweet threads
- Double-Enter in tweet compose now splits into separate paragraph nodes
- Mark decoration plugin registered in TweetEditor

## [0.6.2] - 2026-03-09

### Added
- Audience selector in newsletter send modal — send to all, remaining, or specific subscribers
- Newsletter analytics rebuild — delivery stats, per-subscriber events, activity feed with deduplication

### Fixed
- Empty space after images in inactive tweet editors (structural CSS selector instead of focus-dependent `.is-empty`)
- Image spacing in tweet compose — top margin and hidden trailing empty paragraphs
- Node changes now route through all tweet editors in thread mode
- Tweet compose server sync and pending image border decorations
- Analytics modal uses `recipient_count` as base metric, detects unsubs from click URL patterns
- Unsubscribe filter detection from URL pattern matching
- Italic marks no longer split around links in email newsletter HTML
- Activity feed deduplicates repeated opens/clicks per subscriber

### Changed
- SKILL.md v0.2.1 — thread creation docs, image insertion workflow

## [0.6.1] - 2026-03-09

### Fixed
- `npx openwriter install-skill` now does everything in one command — installs globally, configures MCP server for Claude Code, and copies the skill. Previously users had to run 3 separate commands despite the site promising "one command."
- SKILL.md setup instructions simplified to match one-command flow (manual steps moved to fallback)

## [0.6.0] - 2026-03-08

### Added
- Profiles — directory isolation with per-profile data, trash-based profile deletion with restore
- Connections — platform-owned OAuth for X, LinkedIn, and 12 social providers with profile scoping
- Content types — typed documents (blog, linkedin, newsletter) with dedicated compose views and sidebar templates
- Blog compose view with cover image, metadata fields, and style presets
- Newsletter compose view — single-step send with preview text, subscriber count, format toggle, and sent status tracking
- Scheduler — recurring time slots, scheduled posts, 7-day timeline view, and schedule management
- Newsletter analytics — per-issue delivery stats, per-subscriber events, and recipient tracking
- Newsletter subscriber selection — send to specific subscribers or exclude previous recipients ("send to remaining")
- CSV subscriber import with auto-detection for ConvertKit, Mailchimp, Substack, Beehiiv formats
- Newsletter image embedding — local images extracted as base64 for R2 upload
- View Analytics context menu + modal for sent newsletters
- Sidebar sent indicator — green checkmark on newsletter docs
- Content type auto-tagging (blog, linkedin, newsletter) in sidebar
- `content_type` parameter on `create_document` for typed doc creation
- 21 new publish platform MCP tools: authentication, custom domains, social posting, scheduling, newsletter management
- 57 total MCP tools (36 core + 21 publish plugin)

### Changed
- Publish plugin split into `helpers.ts` + `newsletter-tools.ts` + `index.ts` (500-line rule)
- Newsletter emails now multipart (text/plain + text/html)
- X posting routes check platform OAuth connection before falling back to plugin
- Physical address required for newsletter sends (CAN-SPAM compliance)
- SKILL.md v0.2.0 — full publish platform tool reference, updated tool counts, subscriber selection and analytics workflows

### Fixed
- Cover image carousel race condition — use live metadata not stale snapshot
- Cover image excluded from Copy as HTML for X articles
- HR separators preserved in getNodesByIds for thread MCP assembly
- Context menu working for tweets 2+ in thread mode
- Image-gen plugin uses profile-aware dataDir instead of hardcoded path
- `mapTextOffsetToPos` counts leaf nodes (hardBreak) in charCount
- `<br>` tags no longer rendered as literal text in newsletter emails
- Review panel scroll for image/atom nodes
- Blockquote color unified across compose views for dark mode readability
- Newsletter frontmatter stripping order
- TipTap `<!-- -->` markers stripped from email content
- Deep-merge context objects in setMetadata to fix metadata persistence
- BlogContext contamination guard (prevents cross-type metadata bleed)
- Pending attrs preservation for decorations

## [0.5.5] - 2026-03-03

### Added
- `delete_container` MCP tool — removes containers while keeping doc files on disk

### Changed
- Removed `add_doc` MCP tool — use `move_doc` instead (handles both add and move)
- Workspace MCP tools (`tag_doc`, `untag_doc`, `move_doc`, `delete_container`) now use `docId` parameter
- SKILL.md updated with docId migration, naming rule, Key Params column

### Fixed
- Workspace drag-drop reorder not persisting (Express route ordering bug — `:filename` captured "reorder")
- Collapsed sidebar sections auto-expanding on any workspace mutation (effect dependency on `workspaces` ref)

## [0.5.4] - 2026-03-03

### Fixed
- npm bundle shipping stale SKILL.md (pre-docId migration)

## [0.5.3] - 2026-03-03

### Added
- `insert_image` MCP tool for inline image generation
- Sidebar search bar with full-text search across titles, tags, and content
- Archive feature — soft-delete docs with metadata flag
- Copy button in tweet compose for manual paste workflow
- Auto-tag tweet/article docs with mode label (quote, reply, post, article)
- Connection banner + WebSocket resilience
- Crash guards to survive MCP pipe disconnect

### Changed
- MCP tools switched from `filename` to `docId` as primary identifier
- Thread char limit raised from 280 to 25k for X Premium long-form
- Archived docs only surface via search (removed sidebar section)
- Auto-merge paragraphs to hardBreaks for tweet compose docs
- Quoted tweet card now clickable (opens original in new tab)

### Fixed
- `create_document` hijacking user's active editor focus
- Cover image race condition — scope to pre-await document
- Agent mark decorations not rendering (stale nodeIds + wrapper block matching)
- Cover image leaking across documents when switching
- Copy button — use DOM extraction instead of getText()
- Workspace rename + auto-expand on `switch_document`
- Silent HTTP server failure + listen retry
- Orphaned server detection via health check

## [0.5.2] - 2026-02-28

### Added
- Agent Marks — inline feedback system for user→agent communication (select text, right-click, leave a note)
- `get_agent_marks` and `resolve_agent_marks` MCP tools (32 → 34 total tools)
- `read_pad` now shows mark counts (active doc + other docs) as a passive hint for agents
- Context menu "Agent Mark" action with inline note input (hidden when selection overlaps pending changes)
- Dotted underline decorations for marked text, synced via WebSocket

### Fixed
- Template docs created with `create_document({ empty: true })` now rename from `_untitled-xxx.md` to title-based filename when `set_metadata` sets a title
- File promotion also updates workspace references, marks sidecars, and caches

## [0.5.1] - 2026-02-28

### Added
- `rename_item` MCP tool for renaming workspaces, containers, and documents
- `filename` parameter on `write_to_pad` and `edit_text` for async agent writes to non-active docs
- In-memory document cache for stable node IDs across doc switches

### Fixed
- "End" sentinel insert — resolve to real node ID before browser broadcast (fixes lost inserts)
- Green decoration for empty-node rewrites (was incorrectly showing blue)
- Ghost pending cache entries for files deleted between server restarts
- `populate_document` race condition — write to disk by filename without switching active doc
- SKILL.md updated to document required `filename` parameter

## [0.5.0] - 2026-02-27

### Added
- Thread compose mode — multi-editor tweet threads with reply chain posting (`/api/x/post-thread`)
- Document reordering via drag-and-drop with `_doc-order.json` manifest
- Duplicate document action in sidebar right-click menu
- Card density dropdown — full/compact/minimal doc card sizes
- Plugin sidebar actions infrastructure with Focus Instructions modal
- Image support in X/Twitter posting flow
- Selection-range decoration system for right-click rewrites (atomic range replacement)
- Prompt debug inspector — writes full AV prompt to timestamped `.md` file
- Plugin attribution in context menus with section headers and dividers

### Changed
- Sidebar redesigned — unified cards style, removed style picker, separator-based sections
- Color palettes simplified to light/dark mode only
- Image gen upgraded from Imagen 4 to Nano Banana 2, works from any node
- Context menus gain viewport-aware positioning
- Templates stored as named docs instead of ephemeral temp files
- Doc-switch flicker eliminated — stable editor with `setContent()`
- Thread footer follows focused tweet, matching X behavior

### Fixed
- Tweet thread loss on refresh — flush was sending only first tweet
- Ctrl+R refresh bug — thread docs only showing first tweet
- Stale pending cache after resolving changes on active doc
- Duplicate link/underline extensions — StarterKit v3 includes them
- Floating toolbar persisting after editor blur with pending decorations
- Right-click selection capture — preserve sub-paragraph selection
- Review panel navigation across all tweet editors in thread
- Pending decorations missing in tweet template editors
- Sidebar reorder triggered by redundant save/mtime changes

### Security
- Localhost hardening — bind 127.0.0.1, WS origin check, block cross-origin flush
- Atomic writes + path traversal hardening + git sync flush

## [0.4.0] - 2026-02-24

### Added
- Marketing site at openwriter.io — Astro 5 + Cloudflare Workers, dark monochromatic design
- Skill v0.4.0 — all 30 MCP tools documented, tweet compose mode, article templates
- `generate_image` and 4 version tools now documented in SKILL.md
- First-position MCP config advice and slow-to-load troubleshooting in skill
- Copy button on skill install command (site hero)

### Changed
- Skill install command on site changed to `npx openwriter install-skill` (cleaner than long GitHub URL)
- SKILL.md synced across all three locations (bundled, repo, local) — tool count 24 → 30
- Decoration system upgrade — inline decorations, active gutter, original/modified toggle
- Themes split into independent colors + typography + spacing axes
- Site logo and favicon updated to app's pencil icon
- Release flow now includes SKILL.md version bump and sync steps

### Fixed
- Insert replaces empty node instead of appending after it

## [0.3.1] - 2026-02-22

### Added
- 4 version MCP tools: `list_versions`, `create_checkpoint`, `restore_version`, `reload_from_disk` — agent self-recovery without browser UI
- Article cover image carousel with save button
- Longform tweets — 280 char limit is now soft, not a gate

### Fixed
- Markdown round-trip preserving hardBreaks and empty paragraphs
- Tweet compose Enter now produces `<br>` not `<p>`
- Empty paragraphs visible in tweet compose mode
- Sidebar title updates live on article title change
- Reject-all cache desync, stuck spinner, workspace doc delete
- `populate_document` desync with `import_gdoc` clarification
- Ephemeral auto-delete removed for tweet/article templates

### Changed
- MCP pipeline speed optimizations (Phase 1)
- 29 core MCP tools (was 25)

## [0.3.0] - 2026-02-20

### Added
- X Article compose view — scoped editor matching X's article format with HTML copy for pasting
- Templates dropdown in titlebar for creating tweets, replies, quote tweets, and articles
- `generate_image` MCP tool — generate images via Gemini Nano Banana 2, optionally set as article cover atomically
- Image generation plugin (`@openwriter/plugin-image-gen`) — right-click empty paragraphs to generate AI images inline
- Plugin category system with `empty-node` context menu condition for category-specific actions
- Tweet Post button wired to X API via plugin system
- Canvas Paper mode with rounded/square corner options
- Live character counter and contextual placeholder text for tweet compose
- Ephemeral doc cleanup — posted tweets auto-trashed on next startup
- Built-in update check with global install recommendation
- Theme-aware scrollbar styling for dark mode

### Changed
- Tweet compose redesigned as document type (metadata-driven) instead of appearance style
- Pixel-accurate X/Twitter CSS overhaul for tweet compose — reply threads, quote cards, action bar
- `create_document` gains `empty` flag for instant template docs that skip the writing spinner
- Article title input shows placeholder instead of default text ("Article", "Untitled", "New Document")
- Ephemeral docs now move to OS trash instead of permanent delete
- MCP server renamed from `open-writer` to `openwriter`
- MCP stdio transport starts before Express/plugin setup for faster agent connection
- 25 core MCP tools (was 24)

### Fixed
- Floating toolbar hanging after text deselection
- Article footer clipped by flex stretch + overflow hidden
- Empty `articleContext` no longer incorrectly triggers article view
- Tweet compose wrapper no longer stretches full page height

## [0.2.2] - 2026-02-18

### Fixed
- Race condition where accepting changes on a populated document while agent creates another document caused accepted changes to revert
- Server now validates doc-update targets match active file, routes mismatched updates to correct file on disk

### Changed
- Tags are now document-scoped (stored in frontmatter) instead of workspace-scoped — tags travel with the document
- Simplified `tag_doc` and `untag_doc` MCP tools (no workspace parameter needed)
- Two-step document creation flow: `create_document` (shows spinner) then `populate_document` (delivers content)
- Documents deleted via OS trash (recoverable) instead of permanent delete

### Removed
- Workspace-level tag storage (`workspace-tags.ts` deleted)

## [0.2.1] - 2026-02-17

### Changed
- Updated SKILL.md for dual-entry orientation (skill-first and MCP-first discovery)
- Added `install-skill` CLI command for skill distribution

## [0.2.0] - 2026-02-17

### Added
- Skill distribution via `npx openwriter install-skill`
- Markdown-native README rewrite
- Plugin selector dropdown with dynamic enable/disable from UI
- Canvas style options in Appearance panel

## [0.1.0] - 2026-02-17

### Added

- TipTap 3.0 rich text editor with React frontend
- 24 MCP tools across document, multi-doc, workspace, and import operations
- Pending change decoration system (insert/rewrite/delete with accept/reject)
- Review panel with vim-style keyboard navigation (j/k/h/l/a/r)
- Multi-document workspaces with containers, tags, and shared context
- 4 sidebar views: tree, timeline, board, shelf
- Right-click context menu with plugin-provided AI actions
- 5 themes (Ink, Novel, Mono, Editorial, Studio) with light/dark modes
- Compact tagged-line wire format for token-efficient agent I/O
- Git sync (GitHub CLI, PAT, or existing repo)
- Version history with rollback
- Export to Markdown, HTML, Word, Plain Text, PDF
- Image upload via paste and drag-and-drop
- Internal document links with click-to-navigate
- Plugin system for extending MCP tools, HTTP routes, and context menu
- Google Doc import with auto-chapter splitting
- Multi-session support (additional instances proxy via HTTP)
- CLI with `--port`, `--no-open`, `--api-key`, `--plugins` flags
