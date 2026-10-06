# Writer Convention

Shared contract for channel-master writer skills (`/blog-writer`, `/book-writer`, `/newsletter-writer`, `/x-writer` — plus `/seo-writer` if you have it installed; it is not bundled with OpenWriter). Defines the brief shape a strategist hands off, the return shape a writer hands back, and the sub-form catalog per channel.

This is the contract. Each writer skill's SKILL.md is the implementation. When the two disagree, this doc wins for inter-skill handoffs; the writer skill wins for its own internal mechanics.

## What a channel-master writer is

A channel-master writer owns end-to-end work for ONE distribution channel: ideation → structure → voice → image → publish. Channels: blog, book, newsletter, X, SEO.

Each writer skill is responsible for the SHAPE of work in its channel. Voice (prose generation, NEVER rules, fingerprint, post-write audit) is always delegated to `/authors-voice`. Publish mechanics are always delegated to the appropriate openwriter MCP plugin.

## Brief shape (strategist → writer)

A strategist (or content-advisor) hands a writer a brief in this shape:

```json
{
  "channel": "blog" | "book" | "newsletter" | "x" | "seo",
  "sub_form": "<channel-specific — see catalog below>",
  "angle": "<one-sentence framing of the take or claim, optional>",
  "source_material": [
    { "type": "doc" | "pr" | "url" | "scene" | "prior-post", "ref": "..." }
  ],
  "constraints": {
    "word_target": "<optional number or range>",
    "deadline": "<optional ISO date>",
    "tone_override": "<optional, rare>"
  }
}
```

Brief omissions are fine. A writer with no `angle` ideates. A writer with no `source_material` queries the author. A writer with no `sub_form` infers from the source material or asks once.

## Return shape (writer → strategist)

Every writer mode returns:

```json
{
  "status": "draft-ready" | "needs-input" | "blocked",
  "artifact": {
    "doc_id": "<primary doc>",
    "workspace_id": "<workspace>",
    "container_id": "<optional — per-post / per-chapter container>",
    "<channel-specific fields>": "..."
  },
  "next_steps": ["<slash-command suggestions in order>"],
  "notes": "<optional, one paragraph>"
}
```

`status` values:
- **`draft-ready`** — work done, ready for next stage (most successful returns)
- **`needs-input`** — writer paused awaiting an author decision (shape commits, voice anchor choice, etc.)
- **`blocked`** — writer cannot proceed without external action (setup missing, auth missing, source material 404, etc.)

`next_steps` is ordered. The strategist (or user) takes the first one unless a different path is signaled.

## Sub-form catalog

Per channel. Sub-forms shape beat count, dispatch granularity, voice register defaults.

### Blog (`/blog-writer`)

| sub_form | Word range | Use |
|---|---|---|
| `short` | 500-1000 | Opinion take, single-feature drop |
| `announcement` | 600-1200 | Feature launch with context + demo + CTA |
| `long` | 1500-3000 | Deep dive, framework, multi-section exploration |
| `tutorial` | 1500-2500 | Step-by-step walkthrough with code/screenshots |

### Book (`/book-writer`)

| sub_form | Scope | Use |
|---|---|---|
| `chapter` | 5000-10000 | One chapter beat draft + prose pour |
| `vignette` | 500-2000 | Self-contained scene / aphoristic micro-essay inside a chapter |
| `architecture` | n/a | Chapter list / TOC commit (no prose) |
| `reshape` | n/a | Restructure existing committed work (no fresh draft) |

### Newsletter (`/newsletter-writer`)

| sub_form | Use |
|---|---|
| `weekly` | Standard weekly issue |
| `digest` | Compilation of recent shipped work |
| `essay` | Single-topic long-form newsletter |
| `announcement` | Newsletter announcing a launch |

### X (`/x-writer`)

| sub_form | Use |
|---|---|
| `tweet` | Single post |
| `thread` | Multi-post thread (3-15 posts) |
| `article` | Long-form X article (paragraph-based medium form) |
| `reply` | Reply or QT to an existing post |

### SEO (`/seo-writer` — optional, not bundled with OpenWriter)

Channel `seo`. Upstream is your project's SEO strategy layer (e.g. `docs/seo/`), not a personal-voice brief — the "brief" is the target keyword + intent + SERP gap + cluster from the project's SEO docs.

| sub_form | Word range | Use |
|---|---|---|
| `pillar` | 2000-4000 | Comprehensive hub for an informational head term; cluster hub |
| `landing` | 800-1800 | SEO landing page for a buyer-intent keyword (rank + convert) |
| `spoke` | 1000-2000 | Supporting article linking up to a pillar; builds topical authority |
| `comparison` | 1000-2000 | "X alternative" / "X vs Y" for competitor-consideration intent |
| `refresh` | n/a | Re-optimize an existing page (restructure / re-pour / strip AI tells) |

## Universal firm rules

These apply to every writer skill regardless of channel:

1. **Shape is the writer's job; voice is /authors-voice's job.** Beat structure, container layout, dispatch granularity — writer. Prose generation, NEVER rules, register, fingerprint — `/authors-voice`. Never inline.
2. **Drafts live in OpenWriter, not in chat.** Every artifact returns a `doc_id`. Don't paste prose into the chat surface as the deliverable.
3. **Two-step doc creation.** `create_document` (spinner) → `populate_document` (content). Never inline a 30s generation.
4. **Beats before prose.** Even for short forms — the smallest meaningful sequencing pass catches broken handoffs before they lock into prose. Skill-specific docs spell out the per-channel beat methodology.
5. **Voice runs through a per-site or per-project anchor.** Channel-master writers discover the anchor by convention (`voice/anchor-<site-slug>.md`, `voice/anchor-<book>.md`, etc.); silent fallback to `voice/anchor.md` if no specific anchor exists.
6. **Silent build — never yank the user's view.** Build docs in the background by targeting `docId` directly. Don't call `switch_document` (or any other view-control MCP) as part of the workflow. The user watches the OpenWriter **activity feed** to track agent progress and navigates to artifacts when they're ready to read them; the view stays under user control. The agent's job is to make the docs ready, not to force a context switch on top of a channel that already surfaces every action. Only honor an explicit user instruction ("open the Draft," "show me the Beats") with a view change.

7. **The operator owns the ANGLE and the BEATS — the writer ASKS and REFINES, never ORIGINATES.** This is the canonical method, taken from `/x-writer`'s [!QT-WORKFLOW]. It fires FIRST in any writer run, before any outline locks or prose pours. Sequence: **FORMAT/TYPE → ANGLE → BEATS → WRITE.**
   - **ANGLE.** Ask one line — *"What's your angle?"* — **no menu, no proposals, no candidates.** The operator provides it from their own head (agent taste = training-data averaging = dead voice). Then REFINE only: if sharp, confirm in one sentence; if it could sharpen, propose ONE tightening (not three options); if weak, flag the specific weakness and push back ONCE, then defer. Offer source material as *sparks* ONLY if the operator is explicitly stuck and asks — never a finished angle.
   - **BEATS.** The operator DUMPS the beats however they come (list, paragraph, voice-memo). The writer MIRRORS them back cleanly, flags structural concerns, and suggests ONE-PER-BEAT refinements — never rewrites the sequence, never originates the beats. If the operator asks for a starting structure, offer a SHAPE (e.g. HOOK/SETUP/…/LAND) but never the CONTENT of each beat.
   - **WRITE** runs only on the operator's approval. Gauge dump-vs-thin: a near-final dump is EDITED (preserve their words; `/anti-ai` mandatory), not regenerated; thin beats use the heavy generation path.
   A menu of angles, or a finished outline handed over as "any changes?", VIOLATES this — that's the writer originating taste.

## What this convention does NOT cover

- **Voice composition mechanics** — `/authors-voice` SKILL.md
- **Per-channel beat methodology** — each writer skill's `docs/beats.md`
- **Image generation** — the relevant images doc per channel
- **Publish mechanics** — the openwriter MCP plugin for each channel (github plugin for blog, x-publish for X, newsletter plugin for newsletter)

If you're a writer skill and your behavior diverges from this contract for a real reason, document the divergence in your SKILL.md "Convention" section explicitly — don't drift silently.
