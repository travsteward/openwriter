# Tweet Pipeline

Brainstorm with user → polish in their voice → compose/schedule via OpenWriter.

**Prerequisites:** OpenWriter MCP server connected, `/authors-voice` voice profile configured (or `AV_API_KEY` env var for the CLI polish path).

## Tweet Formats

Three tiers. **Medium form is the default for all original content.**

### Short form (< 280 chars)
Classic Twitter. One-liner punches. Good for replies, dunks, and engagement farming. NOT the primary format.

### Medium form (2-5 paragraphs, sweet spot 3-4) — THE DEFAULT
This is the money zone. X shows a "read more" fold after ~280 chars. When someone clicks to expand:
- **They've invested** — click = commitment, they'll read the whole thing
- **It's digestible** — 3-4 paragraphs is short enough they finish it
- **It's not a bookmark trap** — long-form gets "saved for later" (never read)

Use medium form for: **epicenter QTs, iterations, original takes, all content pipeline output.**

Structure:
- **P1**: Hook — provocative claim or observation that stops the scroll
- **P2**: Tension — the insight, the contradiction, the "why this matters"
- **P3**: Resolution — the framework, the reframe, the punchline
- **P4** (optional): Identity/call — "This is what X means" or territorial claim

### Long form (6+ paragraphs)
Deep threads, essays, manifestos. Gets bookmarked, lower completion rate. Use sparingly — only for flagship content.

---

## [!WORKFLOW]

### Step 0: Read trending epicenters for inspiration (optional, FREE)

If the user wants to write tweets that ride trending conversations, read the epicenter tweets first:
```
WebFetch: https://api.fxtwitter.com/{handle}/status/{id}
```
This returns full tweet text, metrics, media, and quoted tweets — completely free, no X API cost. Use tweet URLs from the epicenter skill or any URL the user provides. Swap `x.com` → `api.fxtwitter.com` in any tweet URL.

Use this to understand what's resonating, what angles are getting engagement, and what the conversation looks like before crafting tweets.

### Step 1: Brainstorm tweets with the user

Discuss the topic, angle, and hook. Draft raw tweets together. Don't worry about voice — that comes next. Focus on:
- **Medium form by default** (3-4 paragraphs) — see Tweet Formats above
- Strong hooks (first line matters most — it's what shows before the fold)
- One core idea per tweet, developed across paragraphs
- Provocative > informative for engagement
- Short form (< 280 chars) only for replies or quick dunks

### Step 2: Polish in your voice

Invoke `/authors-voice` to rewrite each draft via MCP (category `x`, mode `rewrite`). Without Author's Voice, run `/anti-ai` and `/polish` on each draft instead.

### Step 3: Review with user

Present original vs polished side by side. The user picks the version they prefer, or asks for adjustments. Flag anything over 280 chars unless it's intentionally a thread/article.

### Step 4: Compose in OpenWriter

Approved drafts go into OpenWriter as the composition surface. Use OpenWriter mechanics for `tweetContext` / `articleContext` metadata, `content_type` (`tweet` / `reply` / `quote` / `article`), thread HRs, images, previews — see [`openwriter-mechanics.md`](openwriter-mechanics.md).

### Step 5: Schedule via OpenWriter native

Scheduling and posting are OpenWriter-native — no separate CLI scheduler:

- **`mcp__openwriter__schedule_post`** — queue a doc for posting at a specific time
- **`mcp__openwriter__post_to_x`** — post immediately
- **`mcp__openwriter__list_schedule`** — review what's queued
- **`mcp__openwriter__manage_schedule`** — edit / cancel scheduled posts

OpenWriter owns the X integration, time math, retries, and queue persistence.

## [!POLISH-ONLY]

To polish without composing/scheduling (just get the voice rewrite), run Step 2 on the draft and return the rewrite.

## [!FREE-TWEET-READING]

Read ANY tweet for free by swapping `x.com` → `api.fxtwitter.com` in the URL:
```
x.com/handle/status/123  →  api.fxtwitter.com/handle/status/123
```
Use `WebFetch` on the fxtwitter URL. Returns: full text, author, metrics (likes, RTs, views, quotes), media URLs, and quoted tweet data. No auth, no API key, no cost.

**Use cases:**
- Read epicenter tweets before writing responses
- Check engagement on tweets the user wants to quote-tweet
- Read thread context before writing a reply
- Study high-performing tweets in the niche for style/angle inspiration

## [!TIPS]

- **Medium form is the default** — 3-4 paragraphs, not one-liners
- **One core concept per tweet** — develop it across paragraphs, don't pack multiple ideas
- **Threads:** compose as a single OpenWriter doc with HR breaks between tweets; schedule the whole thread as one unit
- **Quote tweets:** use OpenWriter's `tweetContext` with `content_type: "quote"` and the source `tweet_id`
- **Author's Voice category is `x`** — the voice API uses the user's Twitter writing samples for voice matching
