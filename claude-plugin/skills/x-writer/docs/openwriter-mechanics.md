## Tweet Compose Mode

OpenWriter doubles as a tweet compose surface. When `tweetContext` is set in a document's metadata, the editor switches to a pixel-accurate X/Twitter compose view — reply thread or quote tweet layout with embedded parent tweet, character counter, and action bar.

### Setting up a tweet document

```
1. create_document({ title: "Reply to @username", content_type: "reply", url: "https://x.com/user/status/123", empty: true })
```

- **`url`** — the tweet URL to reply to or quote
- **`mode`** — `"reply"` (thread layout with parent above) or `"quote"` (compose above, quoted card below)

The view activates automatically when `tweetContext` is present — no manual toggle needed. Documents are auto-tagged `"x"` in the sidebar for discoverability.

### Working on an existing tweet document

When the user asks you to work on a tweet doc, follow this exact sequence:

```
1. read_pad              → get content + node IDs + docId
2. get_metadata          → get tweetContext (url, mode), tags
3. Extract tweet URL     → parse username + tweet ID from tweetContext.url
4. WebFetch fxtwitter    → read the parent tweet for FREE
5. Check workspaces      → find relevant reference docs for context
6. Write                 → now you have everything, edit the pad
```

**Step 3-4 in detail:** Parse the URL from `tweetContext.url` (e.g. `https://x.com/HustleBitch_/status/2033641235739496554`) → extract username and ID → fetch via fxtwitter:

```
WebFetch: https://api.fxtwitter.com/{username}/status/{tweet_id}
```

This returns full text, metrics, media, quoted tweets — all for FREE. **Never use paid X API search to find a tweet that's already in the document metadata.**

**Step 5:** If the tweet references concepts the user has written about (their recurring frameworks and coined terms), check their workspaces via `list_workspaces` → `get_workspace_structure` → `read_pad` on relevant reference docs. This gives you the user's framework to write from, not generic knowledge.

### Reading the parent tweet (when creating new tweet docs)

Use the x-reader skill or fxtwitter API to fetch tweet data before setting up:

```
WebFetch: https://api.fxtwitter.com/{username}/status/{tweet_id}
```

The compose view fetches and renders the parent tweet (text, author, avatar, media, metrics) automatically from the URL.

### Template Documents

Users can also create tweet and article templates directly from the browser UI using the **Templates** dropdown in the titlebar. For agent-initiated creation, `content_type` handles all metadata automatically:

**Tweet:** `create_document({ title: "Tweet", content_type: "tweet", empty: true })`

**Reply:** `create_document({ title: "Reply", content_type: "reply", url: "https://x.com/user/status/123", empty: true })`

**Quote tweet:** `create_document({ title: "Quote Tweet", content_type: "quote", url: "https://x.com/user/status/123", empty: true })`

**Article:** `create_document({ title: "Article", content_type: "article", empty: true })`

### Removing tweet mode

```
set_metadata({ tweetContext: null })
```

This restores the normal editor view and removes the "x" tag.

### Placeholder text

- Quote mode: "Add a comment"
- Reply mode: "What is happening?!"

### Compose avatar

Users set their X handle by clicking the avatar circle in the compose area. The handle is saved to localStorage and the pfp loads from `unavatar.io/twitter/{handle}`.

### Creating Tweet Threads

Threads are single documents with `horizontalRule` nodes separating each tweet. The compose view splits at HRs into separate tweet editors.

**Do NOT use `populate_document` for threads.** Use `create_document` with `content_type: "tweet"` + `empty: true`, then `write_to_pad` with `horizontalRule` JSON nodes between tweets. The `content_type` flag sets `tweetContext` metadata automatically.

**THREE RULES for thread HRs:**

1. **`horizontalRule` separators MUST use TipTap JSON `{ type: "horizontalRule" }`.** Markdown `---` does NOT create proper HR nodes.
2. **Each HR must be its own change.** Do NOT use content arrays `[{type: "horizontalRule"}, {type: "paragraph", ...}]` — this silently drops the HR.
3. **Send the ENTIRE thread in ONE `write_to_pad` call.** Do NOT split across multiple calls. Multiple calls create race conditions — if the user accepts changes between calls, pending HRs can be dropped. One call = atomic = no race conditions.

```
1. create_document({ title: "Thread title", content_type: "tweet", empty: true })
2. write_to_pad({ docId: "<docId>", changes: [
     { operation: "insert", afterNodeId: "end", content: "Tweet 1 paragraph 1" },
     { operation: "insert", afterNodeId: "end", content: "Tweet 1 paragraph 2" },
     { operation: "insert", afterNodeId: "end", content: { type: "horizontalRule" } },
     { operation: "insert", afterNodeId: "end", content: "Tweet 2 paragraph 1" },
     { operation: "insert", afterNodeId: "end", content: "Tweet 2 paragraph 2" },
     { operation: "insert", afterNodeId: "end", content: { type: "horizontalRule" } },
     { operation: "insert", afterNodeId: "end", content: "Tweet 3 paragraph 1" }
   ]})
```

**For long threads (many tweets):** still send in ONE call. The changes array can hold dozens of items. Atomicity matters more than streaming feel for threads — a half-built thread with missing HRs is worse than waiting for the full thread to arrive.

### Inserting New Tweets into Existing Threads

**Mid-thread insertion is unreliable.** `afterNodeId: "end"` always means document end, not after your last insert. Inserting after specific node IDs mid-document has edge cases with pending changes and image nodes.

**Preferred approach: rebuild the full thread.** Delete the document and recreate with all tweets in one atomic `write_to_pad` call. This is the only pattern that reliably produces correct thread structure.

**If you must insert mid-thread:** use a single `write_to_pad` call with the HR and all content targeting the same `afterNodeId` (the last node of the preceding tweet). Content inserts in reverse order when sharing an afterNodeId, so list changes in reverse. This is fragile — prefer full rebuild.

**Do NOT delete empty paragraphs after images.** Images create empty `<p>` nodes after them. These look like junk but HRs (thread separators) are dependent on them. Deleting the empty paragraph kills the HR too, merging two tweets into one. Leave them alone.

**NEVER bulk-delete text nodes in a thread that contains images.** Image nodes survive text deletion and become orphans — stranded in the wrong position with no surrounding content. The user must then manually delete every orphan image from the browser. This is catastrophic. If you need to reorder tweets, move text around the existing images, or delete the entire document and start fresh (which properly removes everything including images).

### Paragraph Spacing in Tweets

Tweet compose uses `<br>` (hardBreak) for line breaks within a paragraph. Double Enter in the browser creates a new `<p>` node (paragraph split) with visual spacing.

**For agents writing via `write_to_pad`:** use separate paragraph nodes for paragraph spacing. Each paragraph gets its own node ID, enabling independent editing.

```
// Correct: separate paragraph nodes for paragraph spacing
write_to_pad({ docId: "...", changes: [
  { operation: "insert", afterNodeId: "end", content: "First paragraph of tweet." },
  { operation: "insert", afterNodeId: "end", content: "Second paragraph — separate node, visual gap." }
]})
```

For line breaks WITHIN a single paragraph (no gap), use TipTap JSON with hardBreak:

```
{
  type: "paragraph",
  content: [
    { type: "text", text: "Line one" },
    { type: "hardBreak" },
    { type: "text", text: "Line two (same node, no gap)" }
  ]
}
```

This applies to all tweet modes — single tweets, replies, quotes, and individual tweets within threads.

### Inserting Images into Thread Tweets

After creating a thread, use `read_pad` to get node IDs, then `insert_image` to add images after specific tweets:

```
1. read_pad()                    → shows [p:abc123] for each tweet paragraph
2. insert_image({
     docId: "...",
     afterNodeId: "abc123",      ← paragraph node ID from read_pad
     prompt: "...",
     aspect_ratio: "16:9"
   })
```

All `insert_image` calls can run **in parallel** — no dependencies between them. Images appear with green pending decorations for user review.

### Inserting Existing Images (from disk)

Copy to `~/.openwriter/profiles/Default/_images/`, then use TipTap JSON in `write_to_pad`:

```
content: { "type": "image", "attrs": { "src": "/_images/my-image.png", "alt": "..." } }
```

**Markdown `![alt](path)` does NOT work** — creates an empty paragraph. Always use TipTap JSON.
