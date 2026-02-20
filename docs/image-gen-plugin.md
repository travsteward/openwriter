# Image Generation Plugin

> Right-click an empty paragraph to generate an AI image inline. Starts with Google Gemini, extensible to other models later.

---

## Overview

New plugin: `@openwriter/plugin-image-gen`. Category: `image-generation`. Registers a context menu item on empty paragraphs. User provides a prompt, server generates an image via Gemini, saves to `/_images/`, inserts a TipTap image node.

Depends on:
- `empty-node` context menu condition (from [plugin-categories](plugin-categories.md))
- Existing image upload plumbing (`/_images/` storage, TipTap image node, markdown serialization)

---

## Plugin Structure

```
plugins/
└── image-gen/
    ├── package.json
    ├── tsconfig.json
    └── src/
        └── index.ts
```

### Plugin Definition

```typescript
import type { OpenWriterPlugin } from '@openwriter/plugin-types';

const plugin: OpenWriterPlugin = {
  name: '@openwriter/plugin-image-gen',
  version: '0.1.0',
  description: 'Generate images with AI — right-click empty paragraphs',
  category: 'image-generation',

  configSchema: {
    'gemini-api-key': {
      type: 'string',
      env: 'GEMINI_API_KEY',
      required: true,
      description: 'Google Gemini API key for image generation',
    },
  },

  registerRoutes(ctx) {
    // POST /api/image-gen/generate
  },

  contextMenuItems() {
    return [
      {
        label: 'Generate image',
        action: 'img:generate',
        condition: 'empty-node',
        promptForInput: true,
      },
    ];
  },
};

export default plugin;
```

---

## Server Route: POST /api/image-gen/generate

### Request

```json
{
  "prompt": "A minimalist illustration of a writer at a desk with floating holographic documents"
}
```

### Flow

1. Validate prompt (non-empty, max 1000 chars)
2. Call Gemini API (Imagen 3 or latest available model) with prompt
3. Receive image bytes (PNG)
4. Generate filename: `{8-char-uuid}.png`
5. Save to `{DATA_DIR}/_images/{filename}` (same dir as upload-image)
6. Return response

### Response

```json
{
  "success": true,
  "src": "/_images/a1b2c3d4.png"
}
```

### Error Response

```json
{
  "success": false,
  "error": "Generation failed: content policy violation"
}
```

---

## Client-Side Flow

The context menu already handles plugin actions. The image-gen flow needs custom handling since it inserts an image node rather than replacing text (which is what AV actions do).

### In ContextMenu.tsx

When a plugin action starts with `img:`, use a different handler than `callPluginAction`:

```typescript
if (action.startsWith('img:')) {
  await handleImageGenAction(action, instruction);
} else if (action.startsWith('av:') || isPlugin) {
  await callPluginAction(action, instruction);
}
```

### handleImageGenAction Flow

1. **Show loading state** on the empty paragraph:
   - Apply a loading decoration (reuse `applyLoadingEffect` pattern)
   - Display a placeholder graphic + spinner in the empty paragraph
   - The paragraph visually transforms into an image placeholder while generating

2. **Call API**:
   ```typescript
   const res = await fetch('/api/image-gen/generate', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ prompt: instruction }),
   });
   const data = await res.json();
   ```

3. **On success** — insert TipTap image node:
   ```typescript
   const { from } = editor.state.selection;
   editor.chain()
     .focus()
     .deleteRange({ from: from - 1, to: from + 1 }) // remove empty paragraph
     .insertContent({
       type: 'image',
       attrs: { src: data.src, alt: instruction },
     })
     .run();
   ```

   This follows the exact same pattern as `uploadAndInsertImage()` in PadEditor.tsx (paste/drop handler).

4. **On error** — remove loading state, show toast with error message.

### Loading Placeholder UX

While generating (typically 5-15 seconds):

```
┌─────────────────────────────────┐
│                                 │
│     ┌───────────────────┐       │
│     │   🖼  Generating...│       │  ← placeholder with spinner
│     │                   │       │
│     │   "a writer at    │       │  ← shows the prompt text
│     │    a desk..."     │       │
│     └───────────────────┘       │
│                                 │
└─────────────────────────────────┘
```

Options for implementation:
- CSS animation on the paragraph node (pulsing border, shimmer effect)
- Or a temporary widget decoration (like the loading effect used by AV actions)

The simpler approach: reuse `applyLoadingEffect` which already creates a blur/pulse decoration on the target node. Just needs a slightly different visual treatment for "generating image" vs "rewriting text."

---

## Image Lifecycle

Generated images use the exact same plumbing as uploaded images:

| Step | Mechanism | Already Exists? |
|------|-----------|----------------|
| Save to disk | `/_images/{uuid}.png` | Yes (image-upload.ts) |
| Serve statically | Express static middleware at `/_images/` | Yes |
| TipTap node | `image` extension with `src`, `alt`, `id` attrs | Yes (extensions.ts) |
| Markdown serialize | `![alt](src)` | Yes (markdown-serialize.ts) |
| Markdown parse | Image token → TipTap image node | Yes (markdown-parse.ts) |
| Compact format | `[img:id] ![alt](src)` | Yes (compact.ts) |
| Paste/drop | `uploadAndInsertImage()` | Yes (PadEditor.tsx) |
| Cleanup | None (no GC for images) | N/A |

Zero new image infrastructure required.

---

## Gemini API Integration

### Model

Use Gemini's image generation capability (Imagen 3 via `gemini-2.0-flash-exp` or `imagen-3.0-generate-002` — check latest available model at implementation time).

### API Call Pattern

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(config['gemini-api-key']);
const model = genAI.getGenerativeModel({ model: 'imagen-3.0-generate-002' });

const result = await model.generateImages({
  prompt: userPrompt,
  numberOfImages: 1,
  aspectRatio: '16:9',  // good default for article images
});

const imageBytes = result.images[0].imageBytes; // base64
const buffer = Buffer.from(imageBytes, 'base64');
```

Exact API shape may vary — verify against current Gemini SDK at implementation time.

### Configuration

```json
{
  "plugins": {
    "@openwriter/plugin-image-gen": {
      "enabled": true,
      "config": {
        "gemini-api-key": "AIza..."
      }
    }
  }
}
```

Falls back to `GEMINI_API_KEY` env var (standard across other skills that use Gemini).

---

## Future Extensions

The plugin is designed as a generic `image-gen` wrapper, not Gemini-specific:

- **Multiple providers**: Add config fields for other API keys, model selection dropdown
- **Provider-specific options**: Aspect ratio, style presets, negative prompts
- **Image editing**: Right-click existing image → "Edit image" → inpainting/outpainting
- **Batch generation**: Generate multiple options, pick the best one
- **Context-aware prompts**: Auto-generate prompts from surrounding article text

These are future scope — v1 is Gemini-only, single image, text prompt.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `plugins/image-gen/package.json` | Create | Plugin package metadata |
| `plugins/image-gen/tsconfig.json` | Create | TypeScript config |
| `plugins/image-gen/src/index.ts` | Create | Plugin definition, routes, context menu items |
| `src/context-menu/ContextMenu.tsx` | Modify | Add `img:` action handler with image insertion |

### Dependencies

- `@google/generative-ai` (Gemini SDK) — installed in the plugin package
- Existing: `image-upload.ts` (DATA_DIR path), `extensions.ts` (image node), `ContextMenu.tsx`
