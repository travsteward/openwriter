# X Article View

> Compose long-form X Articles in OpenWriter. No API posting — copy HTML to clipboard, paste into X's article editor with formatting preserved.

---

## Why It's Different

The three existing tweet views (plain, reply, quote) share: 280-char limit, `POST /api/x/post`, and a stripped-down editor. Articles have none of that:

- No character limit
- Rich formatting (bold, italic, headers, images, links, lists, blockquotes)
- No X API endpoint — articles can only be created in-browser on x.com
- Workflow is compose in OpenWriter, copy as HTML, paste into X

---

## Activation

Same pattern as tweet views — metadata-driven via `set_metadata` MCP tool:

```json
{ "articleContext": {} }
```

**App.tsx** checks for it:
```typescript
if (metadata?.articleContext) {
  document.documentElement.setAttribute('data-view', 'article');
} else if (metadata?.tweetContext) {
  document.documentElement.setAttribute('data-view', 'tweet');
}
```

Setting `articleContext` to `null` exits article mode. Auto-tags doc with `"x"` (same as tweet docs).

---

## Component: ArticleComposeView

New component at `src/article-compose/ArticleComposeView.tsx`. Completely separate from TweetComposeView — articles are structurally different enough that sharing code would create coupling for no benefit.

### Layout

```
┌──────────────────────────────────────────┐
│                                          │
│  Title                                   │  ← large bold input, placeholder "Title"
│                                          │
│  ─────────────────────────────────────── │  ← subtle divider
│                                          │
│  Body text starts here. Full rich        │  ← scoped TipTap editor
│  formatting. **Bold**, *italic*,         │
│  headers, images, links, lists.          │
│                                          │
│  [inline image here]                     │
│                                          │
│  More body text continues...             │
│                                          │
│                                          │
│                     ┌──────────────────┐ │
│                     │  Copy as HTML 📋 │ │  ← primary action button
│                     └──────────────────┘ │
└──────────────────────────────────────────┘
```

### Scoped Editor Extensions

Only what X Articles actually supports. Using a reduced TipTap extension set:

**Included:**
- StarterKit (paragraph, text, bold, italic, heading, bulletList, orderedList, blockquote, hardBreak)
- Image (existing `@tiptap/extension-image`)
- Link
- UniqueID (for node tracking)
- PadLink (for internal doc links)

**Excluded (not supported by X Articles):**
- Table
- CodeBlock
- HorizontalRule
- Strikethrough
- Any other extensions beyond core formatting

**Headings** scoped to H1-H3 only (X Articles supports these).

### Styling

Match X's article reading experience:
- Serif font (Georgia or similar) for body text
- Wider content column than tweet view
- Article-style paragraph spacing
- Title in large sans-serif (matching X's article title treatment)
- Clean, minimal chrome — the content is the focus

---

## HTML Copy Button

Primary action for the article view. Port the dual-format clipboard pattern from BreeWriter's `copyDocumentContentAsHtml()`.

### Mechanism

```typescript
// 1. Get editor HTML, strip OpenWriter decorations
const editorEl = document.querySelector('.ProseMirror');
const clone = editorEl.cloneNode(true);
// Remove: .ProseMirror-widget, [data-widget], decoration artifacts
clone.querySelectorAll('.ProseMirror-widget, [data-widget]').forEach(el => el.remove());
const cleanedHtml = clone.innerHTML;

// 2. Derive plain text companion
const plainText = extractPlainText(clone); // paragraphs joined with \n\n

// 3. Dual-format clipboard write
const item = new ClipboardItem({
  'text/html': new Blob([cleanedHtml], { type: 'text/html' }),
  'text/plain': new Blob([plainText], { type: 'text/plain' }),
});
await navigator.clipboard.write([item]);
```

When pasted into X's article editor, X reads the `text/html` format and preserves:
- Bold, italic
- Headings (H1-H3)
- Links
- Images (if URLs are accessible)
- Lists
- Blockquotes

### Fallback Chain

1. Modern Clipboard API (`navigator.clipboard.write` with `ClipboardItem`)
2. `navigator.clipboard.writeText()` (plain text only)
3. `document.execCommand('copy')` with textarea (legacy)

### Copy Button UX

- Button label: "Copy as HTML" with clipboard icon
- On click: copy, then show "Copied!" for 2 seconds
- Position: bottom-right of the article view (floating or fixed)

---

## What's NOT in Article View

- No character counter
- No "Post" button (can't post via API)
- No tweet embed cards (not replying to or quoting anything)
- No avatar display
- No X connect prompt (no credentials needed for copy-paste workflow)

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/article-compose/ArticleComposeView.tsx` | Create | Main article view component |
| `src/article-compose/ArticleComposeView.css` | Create | Article-specific styling (serif fonts, spacing) |
| `src/article-compose/useArticleCopy.ts` | Create | HTML copy hook (ported from BreeWriter copyUtils) |
| `src/App.tsx` | Modify | Add `data-view="article"` detection from metadata |
| `src/App.css` | Modify | Add `[data-view="article"]` CSS rules (hide sidebar, titlebar, etc.) |
| `server/state.ts` | Modify | Auto-tag docs with `"x"` when articleContext set (same as tweetContext) |
| `src/editor/extensions.ts` | Modify | Export a scoped extension set for article mode |

---

## MCP Workflow Example

```
Agent: set_metadata({ articleContext: {} })
  → Browser enters article view

Agent: set_metadata({ title: "Why AI Writing Tools Are Inevitable" })
  → Title field populates

Agent: write_to_pad({ changes: [...] })
  → Content appears as pending decorations, user reviews

User: accepts changes, edits freely, adds images
User: clicks "Copy as HTML"
User: pastes into x.com/compose/article
User: publishes on X

Agent: set_metadata({ articleContext: null, ephemeral: true })
  → Exits article view, marks doc for cleanup
```
