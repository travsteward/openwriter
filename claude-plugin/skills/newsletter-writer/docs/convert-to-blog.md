# Mode: Convert (newsletter → blog)

Convert a sent newsletter into a blog-type document in OpenWriter. The newsletter content is preserved as-is (it's already polished and published). Only newsletter-specific framing is stripped.

## When to use

- User says "newsletter to blog" / "convert newsletter" / "blog from newsletter" / "archive newsletter as blog" / "turn newsletter into blog post"
- `/newsletter-writer convert` invoked explicitly
- A newsletter has been sent and the user wants it on the public blog

## Two-step process

1. **This sub-mode** — reads newsletter, strips framing, creates blog doc in OpenWriter
2. **`/blog-writer integrate`** — user reviews the blog doc in the browser, then `/blog-writer integrate` pushes it to the project's GitHub

## Requirements

- OpenWriter MCP server configured
- The newsletter being converted must already be sent (we only archive sent newsletters)
- A GitHub connection in OpenWriter (so the blog doc knows where to push later)

## Step 1: Identify the newsletter

If the user specifies a newsletter by name, find it via `list_documents`. Otherwise, read the current pad via `read_pad` and `get_metadata`.

**Verify it's a newsletter:** Check that `newsletterContext` exists and `lastSend` is present. If not sent yet, warn the user — we only archive sent newsletters.

Extract from metadata:
- `title` — newsletter title (e.g. "The Sleep Brief #1")
- `newsletterContext.previewText` — becomes blog description input
- `newsletterContext.lastSend.sentAt` — becomes blog date
- `newsletterContext.lastSend.sentCount` — note for reference

## Step 2: Identify target project

Run `list_connections`. Find the connection with `provider: "github"`.

- If exactly one GitHub connection: use it (confirm with user)
- If multiple: ask user which one
- If none: warn user they need a GitHub connection to push later, but still create the blog doc

The GitHub connection tells us which project this blog post targets. Note it for the user so they know where `/blog-writer integrate` will push.

## Step 3: Transform content

Read the full newsletter content via `read_pad` (or if not the active doc, read from disk).

### Strip these sections

Remove newsletter-specific framing. Match by content pattern, not exact strings:

1. **"In this Issue" / TOC block** — The opening section that lists issue contents with `<br>` separators. Remove the heading and the list.
2. **Tagline / subtitle** — The italic line describing the newsletter (e.g. *"The Sleep Brief: Weekly current events..."*). Remove it.
3. **Both horizontal rules** that bracket the tagline (the `---` before and after it)
4. **Footer CTA section** — The final section promoting the brand/community (e.g. a "Reading Room"-style section with community pitch). Remove the heading and content.
5. **"Powered by" line** — The italic closing line crediting OpenWriter or any platform. Remove it.
6. **Newsletter self-reference** — Any italic line like *"The Sleep Brief is a weekly email from..."*. Remove it.

### Keep everything else

- All article sections with their headings, body text, images, and links
- Block quotes
- Bold / italic formatting
- "View the post" and "Read the full article" links
- All inline images (they reference `/_images/` paths which OpenWriter already serves)

### Clean up

- Remove any orphaned `---` horizontal rules at the very top or bottom of the document after stripping (but keep `---` rules between article sections — they're section dividers)
- Ensure the document starts with the first real content section heading

## Step 4: Build blog metadata

Construct `blogContext`:

```json
{
  "active": true,
  "description": "<SEO-focused summary — see below>",
  "date": "<from newsletterContext.lastSend.sentAt, formatted YYYY-MM-DD>",
  "author": "<from GitHub connection display_name or ask user>",
  "tags": ["<inferred from content — 3-5 relevant tags>"],
  "slug": "<keyword-focused slug — see below>",
  "draft": false
}
```

**Description:** Do NOT copy `newsletterContext.previewText` — that's an email preheader written to tease opens, not describe content. Instead, write a 1-2 sentence blog description that summarizes what the post covers. Target the same keywords as the slug. This appears in search results and social cards.

- Newsletter previewText: "Weekly field notes on sleep, energy, and the biology underneath both."
- Blog description: "Why sleep debt compounds, what the afternoon coffee actually costs you, and the case for a fixed wake time over a fixed bedtime."

**Slug derivation:** Keyword-focused for SEO, not just the title slugified. Read the content and identify the primary search-worthy topic. The slug should contain keywords someone would actually search for.

- "The Sleep Brief #1" (title) → `sleep-debt-compounding-sleep-brief-1` (keyword slug)
- "The Sleep Brief #4" about naps → `afternoon-naps-science-sleep-brief-4`

Ask the user to confirm the slug before setting it. Suggest 2-3 options.

**Cover image:** Use the first `![...]()` image in the content as `coverImage`. Remove that image from the body markdown before populating — it would be redundant with the blog's feature image display. All other section images stay.

If the user requests a generated cover instead, hand off to `/blog-writer images`.

## Step 5: Create the blog document

1. `create_document` with:
   - `title`: same as newsletter title (or let user rename)
   - `content_type`: `"blog"`
   - `empty`: `true` (we'll set content immediately)

2. `set_metadata` with the `blogContext` from Step 4

3. `populate_document` with the cleaned markdown content

4. Tell the user:
   - Blog doc created, ready for review in the browser
   - Target project (from GitHub connection)
   - Next step: review in browser, then `/blog-writer integrate` to push

## Output

```json
{
  "status": "draft-ready",
  "artifact": { "doc_id": "<new blog doc>", "workspace_id": "..." },
  "next_steps": ["/blog-writer integrate"],
  "notes": "Blog doc created from newsletter <title>. Target project: <github-connection-name>. Review and integrate when ready."
}
```

## Anti-patterns

- ❌ Rewriting or rephrasing newsletter content — it's already published, leave it
- ❌ Pushing to GitHub from this skill — that's `/blog-writer integrate`'s job
- ❌ Generating a new cover image by default — offer it as an option, but the newsletter's first image usually works
- ❌ Converting a newsletter that hasn't been sent — we only archive sent ones
