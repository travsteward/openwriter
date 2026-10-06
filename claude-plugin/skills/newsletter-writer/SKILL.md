---
name: newsletter-writer
description: |
  Channel-master writer for email newsletter. Weekly pipeline: scaffold structure,
  gather data, query the author, synthesize in their voice, review, send. Companion
  doc workflow. Voice-matched via the authors-voice skill. Works for any
  behind-the-scenes weekly newsletter built on proven content.

  Use when: "/newsletter-writer", "newsletter", "draft newsletter", "scaffold
  newsletter", "newsletter gather", "newsletter review", "newsletter send",
  "newsletter status", "newsletter to blog", "convert newsletter".

  Requires: OpenWriter MCP server configured.
metadata:
  author: travsteward
  version: "0.2.1"
license: MIT
---

# Newsletter Writer Skill — /newsletter-writer

Weekly newsletter pipeline: scaffold structure, gather data, query the author, synthesize in their voice, review, send.

**Worked example throughout:** a fictional newsletter, **The Sleep Brief**, written by a popular-science sleep author whose community site is `deeprest.example.com` and whose X handle is `@sleepauthor`. Substitute your own newsletter name, brand, domain, and handle — they live in your project's `config.md` (see Configuration).

## Philosophy

This newsletter is **behind the scenes**, not a content recap. Readers can go read the tweets and articles themselves. The newsletter gives them what they can't get anywhere else: WHY the author wrote it, what they were trying to achieve, the deeper reasoning that didn't fit in 280 characters, and how the author's project interacted with the world that week. Every section answers "what was I thinking?" not "what did I post."

## Commands

- `/newsletter-writer` or `/newsletter-writer draft` — Full pipeline: scaffold → gather → query → enhanced scaffold → draft → review
- `/newsletter-writer scaffold` — Create doc with empty skeleton structure (header, HRs, placeholder sections, footer)
- `/newsletter-writer gather` — Data collection only (metrics, top tweets, article)
- `/newsletter-writer review` — Pre-send checklist + /polish 90/100 scoring on every section
- `/newsletter-writer send` — Send via OpenWriter newsletter system
- `/newsletter-writer status` — Subscriber count, last sent, domain status

## Critical Rules

1. **ALWAYS pour prose through `/authors-voice` Apply Protocol**, then `/anti-ai`. You supply the brief and the author's answers; the minion writes. Never skip this. The authors-voice skill ships with the OpenWriter authors-voice plugin.
2. **NEVER write the author's position for them.** You gather data and present structure. You ASK the author what they think. They tell you. You synthesize their input in their voice. The author's original thinking is the product — you are the editor, not the writer.
3. **Source article content from OpenWriter docs FIRST.** X Articles may not be readable via fxtwitter. The drafts live in OpenWriter. Search `list_documents` before trying external APIs.
4. **Every section headline is specific to that week's content.** No generic recurring labels like "This Week on X" or "The Author's Position." Each section gets a unique, attention-grabbing headline based on the actual topic — crafted and scored with `/polish` (90/100). Example: "Why the 8-Hour Rule Is Wrong for Shift Workers" not "The Author's Position." "The Tweet That Got 1.75M Views About Sleep Debt" not "This Week on X." Specificity is what grabs attention.
5. **No outbound links except the footer CTA.** The newsletter summarizes and screenshots everything — readers don't need to leave. No "View the post →" or "Read the full article →" links to X or anywhere else. The only link in the entire newsletter is the footer CTA to your brand site. Every other link is a leak.

## Phase 1: Scaffold

Create the newsletter document with the empty skeleton FIRST. The author sees the structure in OpenWriter before any ideation begins. This is the visceral starting point — the bones of the newsletter visible in the editor.

### Determine Issue Number
Check `list_newsletter_issues` for the latest sent issue number. Increment by 1.

### Create & Populate Skeleton
```
1. create_document({ title: "The Sleep Brief #N", content_type: "newsletter" })
2. populate_document with the full skeleton below
```

Use a single `populate_document` call with this TipTap JSON structure. All section titles are placeholders — they get replaced during drafting after gather/query:

```json
[
  {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "In this Issue:"}]},
  {"type": "paragraph", "content": [
    {"type": "text", "text": "Section 1"},
    {"type": "hardBreak"},
    {"type": "text", "text": "Section 2"},
    {"type": "hardBreak"},
    {"type": "text", "text": "Section 3"},
    {"type": "hardBreak"},
    {"type": "text", "text": "Section 4"},
    {"type": "hardBreak"},
    {"type": "text", "text": "Section 5"}
  ]},
  {"type": "horizontalRule"},
  {"type": "paragraph", "content": [
    {"type": "text", "marks": [{"type": "italic"}], "text": "The Sleep Brief: Weekly current events and X highlights from the "},
    {"type": "text", "marks": [{"type": "italic"}, {"type": "bold"}, {"type": "link", "attrs": {"href": "https://deeprest.example.com"}}], "text": "DeepRest"},
    {"type": "text", "marks": [{"type": "italic"}], "text": " worldview."}
  ]},
  {"type": "horizontalRule"},
  {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Section 1"}]},
  {"type": "paragraph", "content": [{"type": "text", "text": "[Current events or lead reflection]"}]},
  {"type": "horizontalRule"},
  {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Section 2"}]},
  {"type": "paragraph", "content": [{"type": "text", "text": "[Tweet commentary]"}]},
  {"type": "horizontalRule"},
  {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Section 3"}]},
  {"type": "paragraph", "content": [{"type": "text", "text": "[Tweet commentary]"}]},
  {"type": "horizontalRule"},
  {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Section 4"}]},
  {"type": "paragraph", "content": [{"type": "text", "text": "[Article or thread deep dive]"}]},
  {"type": "horizontalRule"},
  {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Section 5"}]},
  {"type": "paragraph", "content": [{"type": "text", "text": "[From the Archives]"}]},
  {"type": "horizontalRule"},
  {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "The Reading Room"}]},
  {"type": "paragraph", "content": [
    {"type": "text", "marks": [{"type": "link", "attrs": {"href": "https://deeprest.example.com"}}], "text": "DeepRest"},
    {"type": "text", "text": " is the home for people fixing their sleep for good. [Edition-specific CTA — echo themes]."}
  ]},
  {"type": "paragraph", "content": [
    {"type": "text", "marks": [{"type": "italic"}], "text": "The Sleep Brief is a weekly email from DeepRest."}
  ]},
  {"type": "paragraph", "content": [
    {"type": "text", "marks": [{"type": "italic"}], "text": "Powered by "},
    {"type": "text", "marks": [{"type": "italic"}, {"type": "bold"}, {"type": "link", "attrs": {"href": "https://www.openwriter.io"}}], "text": "OpenWriter"}
  ]}
]
```

After scaffolding, tell the author the skeleton is live at localhost:5050. Then proceed to gather.

### Workspace Ordering
All newsletter docs live in the "Newsletter" workspace. Order: most recent at top, working notes directly below its newsletter, oldest at bottom.
```
The Sleep Brief #N        ← newest
SB#N — Working Notes
The Sleep Brief #N-1
...
The Sleep Brief #1        ← oldest
```
When creating the scaffold and companion doc, add both to the Newsletter workspace and use `move_item` with `afterId` to place the working notes directly after its newsletter.

### Standalone `/newsletter-writer scaffold`
When run standalone (not part of the full pipeline), just scaffold and stop. The author reviews the bones in the editor.

## Phase 2: Gather

Collect all data before presenting anything to the author.

### Tweet Metrics

If the author keeps a local tweet-metrics database (a JSON file of posts + view counts, refreshed via fxtwitter or similar), pull from it:

- `recent_performance[]` — tweets from last 7 days sorted by views
- `threshold_crossings[]` — tweets that crossed 10K/25K/50K/100K this week

If there's no metrics database, ask the author for their top 2-3 posts of the week (links or IDs) and fetch each via fxtwitter (below).

### Archive Candidates (From the Archives section)

If a historical metrics database exists, search it directly for thematically relevant older posts:

```javascript
// Search a tweets.json-style database for archive candidates by theme
node -e "
const arr = JSON.parse(require('fs').readFileSync('<path-to-your-tweets.json>','utf8'));
const themes = /your|regex|here/i;
const hits = (Array.isArray(arr) ? arr : Object.values(arr))
  .filter(e => themes.test(e.title + ' ' + (e.topic || '') + ' ' + (e.notes || '')));
hits.sort((a,b) => (a.iterations[0]?.posted_at || '').localeCompare(b.iterations[0]?.posted_at || ''));
hits.forEach(t => {
  const i = t.iterations[0];
  console.log((i?.posted_at||'?') + ' | ' + t.peak_views_thousands + 'K | ' + t.title + ' | ' + (t.topic||'') + ' | ' + (i?.tweet_id||'no-id'));
});
"
```

Guidance:
- Build the regex from the edition's themes to find thematically relevant archive tweets
- Prefer the oldest entries — they're the founding ideas. The point of an archives section is resurfacing forgotten ideas, not recapping last month
- If no database exists, ask the author to nominate an old favorite

### Top Tweet Content
Read the top 2-3 performing tweets via fxtwitter (free):
```
WebFetch: https://api.fxtwitter.com/{user}/status/{tweet_id}
```
Get full text, metrics, quoted tweet context.

### Tweet Screenshots
Screenshot every tweet referenced in the newsletter (e.g. via a tweet-screenshot tool such as the x-reader skill, if installed, or any screenshot service). This is a required step — every section that references a tweet gets a visual.

Copy each screenshot into OpenWriter's image directory before inserting:
```bash
cp <screenshot-output-dir>/{tweet_id}.png ~/.openwriter/profiles/Default/_images/{descriptive-name}.png
```

Insert into the newsletter doc via `write_to_pad` using TipTap JSON:
```json
{"type": "image", "attrs": {"src": "/_images/{descriptive-name}.png", "alt": "description"}}
```

#### Screenshot Logic: Original vs QT

For each tweet section, determine what to screenshot:

1. **Quote tweets** → screenshot the ORIGINAL tweet (the one being quoted). Use fxtwitter to trace the quoted tweet ID. Then blockquote the author's punchiest lines from their QT below the image. This is the proven pattern:
   ```
   [h2] Section Headline
   [img] ← screenshot of the ORIGINAL tweet being quoted
   [p]  ← brief context line
   [bq] ← author's key quote from their QT response
   [p]  ← **view count** + extended commentary
   ```
   The screenshot shows what sparked the response. The blockquote shows the author's take. The prose below delivers the WHY. This avoids screenshotting long-form QTs which render as massive images.
2. **If the original fails** (deleted, protected, the screenshot service can't fetch it) → screenshot the author's FULL QUOTE TWEET instead. The QT card embeds the original tweet visually. But then **trim the redundant written text** — delete blockquotes of what was said and what the original said, since the screenshot already shows both. Keep only the author's extended thoughts paragraph.
3. **Standalone tweets** (not QTs) → screenshot the tweet directly.
4. **Archive tweets** → screenshot the archive tweet directly. Delete the blockquote copy of the tweet text — the screenshot replaces it. Keep only the context paragraphs.

#### Naming Convention
Use descriptive names, not tweet IDs: `caffeine-study.png`, `sleepauthor-90min-qt.png`, `sleepauthor-naps.png`.

### Article Content
Search OpenWriter for this week's article:
```
mcp__openwriter__list_documents → find by date + title
mcp__openwriter__read_pad({ docId, force: true }) → read full content
```
Articles are always in OpenWriter. Do NOT rely on fxtwitter for long-form content.

### Current Events Context (optional)
If the author has X API access set up (e.g. via an x-api tooling skill), pull personalized trending topics. Otherwise skip — current events context can come straight from the author in the query phase.

## Phase 3: Present & Query

Present your findings, then ask questions. **Do not write any content yet.**

### Present the Data
Show the author:
1. **Top tweets this week** — text, views, bookmarks, likes for each
2. **The article** — title, word count, brief description
3. **Archive candidates** — 2-3 options for From the Archives
4. **Metrics summary** — total views, follower count, top performer

### Ask These Questions (in order)

**Q1: Current Events**
> "What was the most prominent discussion topic in your community this week? What's the conventional viewpoint you're challenging?"

Wait for answer.

**Q2: The Author's Position**
> "What's your position that differs from the conventional viewpoint? Give me the reasoning."

Wait for answer.

**Q3: Tweet Highlights**
For each top tweet, ask:
> "Here's your [X views] tweet: '[first line]'. Why did you write this? What were you trying to achieve? What's the thinking behind it that the tweet itself didn't say?"

Wait for answer on each.

**Q4: Article Framing**
> "Your article '[title]' — why did you write this one? What were you trying to accomplish? What should the reader take away that goes beyond just reading the piece?"

Wait for answer (or synthesize from the article content if they defer).

**Q5: Archive Pick**
> "For From the Archives, here are your options: [list]. Which one, and any context you want to add?"

Wait for answer.

## The Position Pattern

This is the meta-pattern for any section where the author explains a position. It applies to the current events section, tweet sections, article section — anywhere the author gives their thinking.

1. **Author gives their position raw.** Stream of consciousness, voice notes, rough explanation. They provide the THINKING — the core argument, the framing, the reasoning.
2. **Agent researches supporting evidence.** Search for specific names, dates, facts, quotes, events that back the author's position. The author says "the melatonin supplement market exploded" — the agent finds the market size, the year-over-year growth figure, the FDA's non-regulation status. The author says "the 8-hour rule is recent" — the agent finds the pre-industrial segmented-sleep research, the historian's name, the publication year.
3. **Agent synthesizes position + evidence in the author's voice.** The author's argument structure stays intact. The agent weaves in the specifics — names, numbers, dates, quotes — that make it concrete and credible. Then applies full authors-voice protocol (profile + samples + anti-AI).

The author provides the WHY. The agent provides the WHAT (facts) and the HOW (voice-matched prose). Never the other way around.

## Phase 3.5: Companion Doc

After the query, create a companion document in OpenWriter that captures everything gathered and discussed. This is the working doc — the newsletter skeleton stays clean.

### Create the Companion Doc
```
create_document({ title: "SB#N — Working Notes", content_type: "document" })
```

Contents:
1. **Tweet metrics table** — all recent performers with IDs, views, dates
2. **Author's query answers** — verbatim or close, organized by section
3. **Research notes** — supporting evidence, facts, dates gathered for each section
4. **Section lineup** — proposed order, headlines, content assignments
5. **Draft iterations** — refine section prose HERE before committing to the newsletter

**Why this exists:** If context is lost mid-build, the companion doc has everything needed to resume. More importantly, refining content shape in the companion doc BEFORE writing to the newsletter prevents gnarled implementations where early AI text marshals rewrites in the wrong direction.

## Phase 4: Enhanced Scaffold

After gather and query, update the skeleton with real headlines and content assignments. The author now sees the newsletter with concrete section titles and knows what goes where before any prose is written.

### Screenshots
Screenshot every tweet that will appear in the newsletter. Do this NOW, during enhanced scaffold, so images are ready for drafting. Skip if a section doesn't reference a tweet. Copy screenshots into `~/.openwriter/profiles/Default/_images/` with descriptive names (see Phase 2).

### Update the Skeleton
Use `read_pad` to get node IDs from the Phase 1 skeleton, then `write_to_pad` to:
1. Replace "Section 1"–"Section 5" H2 headings with crafted headlines (use /polish scoring, 90+ required)
2. Replace placeholder paragraphs with one-line content assignments (e.g. "Caffeine half-life tweet — 1.75M views — afternoon-coffee angle")
3. Update the "In this Issue" paragraph to match the new headlines
4. Reorder sections if the data suggests a different lead

The author reviews the enhanced skeleton and approves the lineup before any writing begins.

## Phase 5: Voice-Matched Drafting

Now you write. Using the author's answers as raw material, enriched with researched specifics.

**Where to draft depends on whether the author has written seed content in the newsletter:**
- **Author wrote seed content/angles directly in the newsletter** → Draft directly on the newsletter. The author's raw text anchors the direction. Apply the authors-voice protocol to polish in place.
- **No seed content from the author** → Draft in the companion doc first. Apply authors-voice, get approval, THEN commit to the newsletter. Never write unvetted AI text directly into a blank newsletter section — early AI prose poisons the direction of all subsequent rewrites.

Voice profile + writing samples are loaded by `/authors-voice` Apply Protocol. If the author hasn't set up authors-voice yet, run its setup first — voice-matched drafting is non-negotiable for this pipeline.

### Craft Section Headlines
Each section gets a specific, content-driven headline — not a generic label. Use /polish (ad-legends scoring) to craft headlines that grab on specificity. Score each 0-100 on stopping power + specificity + brand fit. Don't settle below 90.

Examples of what TO do:
- "Why Shift Workers Have the 8-Hour Rule Wrong"
- "1.75M Views on the Afternoon Coffee Question"
- "The Napping Article Nobody Read (Yet)"

Examples of what NOT to do:
- "The Author's Position" / "Current Events" / "What Nobody's Saying"
- "This Week on X" / "Top Tweet"
- "The Article" / "Long Form"

### Write Each Section
Apply voice profile rules as hard constraints — the specifics come from the author's authors-voice profile (diction, syntax, rhetoric, sentence distribution, contraction pattern). Treat every profile rule as a behavioral constraint, not a suggestion.

### Anti-AI Detection
Run `/anti-ai` on every section.

### Fill the Skeleton
The doc already exists from Phase 1. Use `read_pad` to get node IDs, then `write_to_pad` to replace each placeholder section with voice-matched content. Update the "In this Issue" list titles to match final headlines.
```
1. read_pad → get node IDs for each [Section N content] placeholder
2. write_to_pad for each section (images, paragraphs, links)
3. Update "In this Issue" paragraph with final section titles
4. Update footer CTA to echo edition themes
5. User reviews at localhost:5050
6. Iterate via write_to_pad as needed
```

## Document Skeleton

The newsletter has a precise structure in OpenWriter. Follow this exactly.

### Header Block
```
[h1] In this Issue:
[p]  ← hardBreak-separated list of section titles (see below)
[hr]
[p]  ← italics tagline (see below)
[hr]
```

**Intro list** — each item on its own line using TipTap hardBreak nodes, NOT markdown `\n`:
```json
{"type": "paragraph", "content": [
  {"type": "text", "text": "Section Title One"},
  {"type": "hardBreak"},
  {"type": "text", "text": "Section Title Two"},
  {"type": "hardBreak"},
  {"type": "text", "text": "Section Title Three"}
]}
```

**Tagline** — italics with bold link, sits between two HRs:
```
*The Sleep Brief: Weekly current events and X highlights from the **[DeepRest](deeprest.example.com)** worldview.*
```

### Section Block (repeat for each section)

**For quote tweets (most common):**
```
[h2] Section Headline
[img] ← screenshot of the ORIGINAL tweet being quoted
[p]  ← brief context line
[bq] ← author's punchiest lines from their QT response
[p]  ← **view count** + extended commentary (2-4 paragraphs)
[hr]
```

**For standalone tweets / articles:**
```
[h2] Section Headline
[img] ← tweet screenshot or article cover
[p]  ← bold callout (view count, word count)
[p]  ← commentary paragraphs (2-4)
[hr]
```

### Footer Block
```
[hr]
[h2] The Reading Room
[p]  ← CTA with link to your brand site
[p]  ← *The Sleep Brief is a weekly email from DeepRest.*
[p]  ← *Powered by **[OpenWriter](www.openwriter.io)*
```

### TipTap Gotchas
- **H2 headings**: Markdown `## Title` via insert often renders as empty paragraphs. Use TipTap JSON: `{"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Title"}]}`
- **HRs**: Use TipTap JSON `{"type": "horizontalRule"}` for reliable HR insertion
- **Images**: Always TipTap JSON `{"type": "image", "attrs": {"src": "/_images/name.png", "alt": "desc"}}` — markdown `![alt](path)` creates empty paragraphs
- **Line breaks in a paragraph**: Use `hardBreak` nodes, not `\n`

## Section Strategy: Proven Content + Objection Angles

### Picking Sections from Proven Content

The newsletter is built from **proven content** — tweets and articles that already hit. Don't invent new topics. Identify the week's top performers from your metrics database (or the author's nominations), plus archive candidates for the final section. Check OpenWriter doc metadata for `tweetContext.lastPost.tweetUrl` to find post URLs.

### The Objection Angle

The most powerful newsletter sections don't just recap a thread or article — they address the **#1 objection** readers would have even if they agree with the premise.

Pattern:
1. Reference the post/thread and its performance (views, engagement)
2. Briefly state the core thesis (1 paragraph)
3. Name the most common objection or misconception
4. Dismantle it with the thinking that didn't fit in the original post
5. Connect back to the brand worldview

Example: a "Sleep Debt" thread (126K views) argues lost sleep compounds and can't be fully repaid on weekends. The newsletter section isn't "here's what the thread said." It's **"So Just Sleep In on Saturday?"** — the #1 objection, dismantled. The section title IS the objection.

This pattern works because:
- Readers who saw the thread get NEW value (the objection addressed)
- Readers who didn't see it get the thesis + the nuance in one section
- The objection headline is a better hook than the original thesis

### Image Extraction for Sections

Every section needs a visual. For articles and threads posted to X:

1. Fetch the tweet via fxtwitter: `https://api.fxtwitter.com/{user}/status/{id}`
2. Extract the image URL from the response (article cover, thread image, media)
3. Download to OpenWriter images:
   ```bash
   curl -sL "{image_url}" -o ~/.openwriter/profiles/Default/_images/{descriptive-name}.jpg
   ```
4. Insert via TipTap JSON in `write_to_pad`

For tweet screenshots, use your screenshot tool (see Phase 2: Gather).

## Phase 6: Review (`/newsletter-writer review`)

Pre-send checklist. Run this before sending. Can also be invoked standalone.

### Structural Checklist
Read the full newsletter via `read_pad` and verify every item:

- [ ] **H1 "In this Issue:"** — present, lists all 5 section titles
- [ ] **Tagline** — italic, brand link, between two HRs
- [ ] **5 sections** — each has H2 + image + prose + HR separator
- [ ] **Images** — every section has a screenshot or cover image (no broken paths)
- [ ] **Blockquotes** — QT sections have the author's quote blockquoted
- [ ] **No outbound links** — zero links to X, external sites. Only the brand site in footer
- [ ] **Footer** — branded H2 + CTA paragraph + branding lines
- [ ] **Preview text** — `set_metadata` with `previewText` field filled (the snippet email clients show before opening). Should be a compelling 1-line hook, not the first sentence of the body.
- [ ] **Subject line** — drafted and scored. Format: "The Sleep Brief #N — [hook]"

### Content Quality (90/100 scoring)
For each section, run /polish on the opening sentence. Score hook, angle, rhythm, punch, closer on a 0-10 scale. Overall must be 90+. Fix any section below 90 before proceeding.

### Anti-AI Check
Run `/anti-ai` on the full newsletter.

### Cross-Section Check
- No repeated phrases or closers across sections
- Section openers are varied (no two start the same way)
- Thematic throughline is coherent but not repetitive

Present the full review to the author. Fix any issues. Then proceed to send.

## Phase 7: Send

After author approves the review:
```
mcp__openwriter__send_newsletter({
  subject: "The Sleep Brief #N — [hook]",
  format: "html"
})
```

## Newsletter Structure

### 5 Sections + Footer

Always exactly 5 content sections. Modeled after the strongest early issue of the worked-example newsletter.

| # | Section Type | Source | Author Input Required |
|---|-------------|--------|----------------------|
| 1 | **Current events OR lead reflection** | HOT current event decoded through the brand lens, OR the week's biggest post | YES — position or objection angle |
| 2 | **Tweet commentary** | High-performing tweet with behind-the-scenes thinking | YES — why you wrote it |
| 3 | **Tweet commentary** | Another high-performing tweet, different topic | YES — why you wrote it |
| 4 | **Article or thread deep dive** | This week's X Article or long thread | YES — objection angle + position |
| 5 | **From the Archives** | High-performing historical tweet (50K+) with fresh insights | Optional — pick + new angle |
| — | **Footer** | Static CTA + branding | NO — same every week |

### Section 1: Lead — Current Events or Reflection

If there's a HOT current event (major news, new study, cultural moment), it leads. Decoded through the brand worldview — state the conventional position, then the author's position with reasoning. This takes priority over reflections.

If no hot current event, section 1 is a timely reflection on the week's top performer — same format as sections 2-3.

### Sections 2-3: Tweet Commentary

Commentary on the week's proven tweets. Each section covers a different tweet on a different topic.

**What they are NOT:** recaps. Readers already saw the post. The newsletter gives them what they can't get anywhere else.

**What they ARE:** objection-as-angle pieces. For each section:
1. Pick a top-performing tweet
2. Identify the #1 objection — even from people who agree with the premise
3. The H2 headline IS the objection (e.g. "So Just Sleep In on Saturday?", "So Coffee Is Poison Now?")
4. The section addresses and dismantles the objection with extended thinking

**Format:** H2 (objection headline) → image (tweet screenshot) → bold callout (view count) → 2-4 commentary paragraphs.

### Section 4: Article or Thread Deep Dive

Extended commentary on this week's X Article or long thread. Same objection-angle pattern but with more room to breathe — this is the meatiest section.

**Format:** H2 (specific headline) → image (article cover or thread screenshot) → bold callout (word count, view count) → 2-4 commentary paragraphs.

### Section 5: From the Archives

A high-performing historical tweet resurfaced with **fresh insights** — not just "look at this old banger."

- Search the metrics database directly (see Phase 2 archive search) — filter by edition themes, prefer the oldest entries
- Screenshot the tweet
- Write 2-3 paragraphs of NEW thinking — what this idea became, how it evolved, what readers should understand now that wasn't obvious then
- Rotate — don't repeat within 3 months
- No view counts in the headline — lead with the idea, not the metrics

### Footer

NOT a hard sell. The H2 and branding lines are static. The CTA paragraph changes each edition to **echo the edition's themes through the brand's features** — but never explicitly connect the dots.

**The rule:** The newsletter sections lay breadcrumbs (the edition's recurring themes). The footer lists brand features that ARE those solutions. The reader who noticed the breadcrumbs will feel it. The reader who didn't just sees a clean CTA. Never say "this is why the brand exists" or "as we described above."

**How to write the CTA:** List 3-4 brand features as short punchy phrases that mirror the edition's problems-as-solutions. For the worked-example sleep brand, that might be:
- Sleep tracking → accountability for the habit you keep breaking
- Cohort challenges → not fixing it alone
- Office hours with the author → direct answers
- "No supplements, no gadgets, no 30-day miracle" → always available

**Mid-newsletter CTA:** A single italic linked line placed after section 3 (the halfway point), before the HR into section 4. Must be directly related to the section it follows — echo the specific topic, state the benefit of the brand in that context. No mystery, all benefit. Full line is one italic link to the brand site. Changes every edition.

Examples (worked-example brand):
- After a caffeine section: *[DeepRest members run a 2-week caffeine reset every quarter. Join the next one →](https://deeprest.example.com)*
- After a sleep-debt section: *[We track sleep debt weekly. See where you stand →](https://deeprest.example.com)*

**Footer CTA hook line:** Every edition gets a single punchy sentence placed BEFORE the feature list. This line ties the edition's themes into a cost-of-not-clicking feeling. One sentence. Changes every edition.

Examples (worked-example brand):
- SB#1 (caffeine, sleep debt, shift work): *"The people who fix their sleep first win the decade."*
- SB#2 (naps, melatonin, screens): *"Everyone knows what to do. Almost nobody builds the system that makes them do it."*

**Example footer:**
```
[p] The people who fix their sleep first win the decade.
[p] [DeepRest](https://deeprest.example.com) is the home for people fixing their
    sleep for good. Sleep tracking that keeps you honest. Cohort challenges so
    you are not fixing it alone. Office hours with the author. No supplements,
    no gadgets, no 30-day miracle.
[p] *The Sleep Brief is a weekly email from DeepRest.*
[p] *Powered by **[OpenWriter](www.openwriter.io)*
```

**Structure:**
```
[hr]
[h2] The Reading Room
[p] CTA — edition-specific feature list echoing themes. Compel, don't coerce.
[p] *The Sleep Brief is a weekly email from DeepRest.*
[p] *Powered by **[OpenWriter](www.openwriter.io)*
```

## Tone Rules

- **No pity vibes.** Never use phrases like "because nobody else was going to" or "readers have nowhere to go." State what exists, not what's missing.
- **No AI-sounding filler.** "Interestingly," "It's worth noting," "Notably" — cut all of it.
- **No repetitive section openers.** Never start sections with "I wrote this because" / "This is why I wrote this" / "I posted a thread on." Each section needs a distinct, elegant opening that drops the reader straight into the thinking. Vary the entry point: start with the objection, start with the image the reader should hold, start with the claim, start mid-argument. The reader should not be able to predict how the next section begins.
- **WHY is the product.** Every section delivers the thinking behind the content. The content itself is just the entry point.
- **Short paragraphs.** Break up extended thoughts into 2-3 short paragraphs. Thesis paragraph, evidence paragraph, conclusion paragraph. Never a wall of text. Email readers scan — give them air.
- **One section of extended thoughts.** Not an essay. Not five paragraphs. Two or three short ones. Concise. Voice-matched.
- **Never summarize what the reader can already see.** If you blockquote a tweet, do not restate what the tweet says. Add new thinking.
- **Always use /authors-voice.** Every time you write in the author's voice. No exceptions.

## Configuration

Brand-specific config lives next to this skill: [config.md](config.md) — newsletter name, brand, domain, handle, tagline, CTA conventions. The shipped file is a worked example (the fictional Sleep Brief); replace its values with your own.

## Cost

$0/week. All data sources are free:
- Tweet metrics: fxtwitter (free)
- Article content: OpenWriter docs (local)
- Newsletter send: via OpenWriter's newsletter system
