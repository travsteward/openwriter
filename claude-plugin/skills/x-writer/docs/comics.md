# X Comics — Thread-Aware Comic Strip Generator

Generate character-consistent comic panels for X threads. The thread IS the storyboard.

## Quick Start

```bash
# Create a character
node <x-writer skill folder>/scripts/generate-image.js \
  -p "Character portrait: [DESCRIPTION]. Front-facing, neutral background, even studio lighting. No text, no watermarks, no logos." \
  -o <x-writer skill folder>/scripts/characters/{name}.png -a "1:1"

# Generate a panel with character reference
node <x-writer skill folder>/scripts/generate-image.js \
  -p "This is Character A (face reference). [SCENE]. [STYLE SUFFIX]. No text, no watermarks, no logos." \
  -o /c/tmp/panel-1.png \
  -r <x-writer skill folder>/scripts/characters/{name}.png \
  -a "16:9"
```

## Workflows

### 1. CREATE — New character
→ Read `comics/characters.md`

### 2. GENERATE — Comic strip from thread
→ Read `comics/workflow.md` + `comics/styles.md`

### 3. MANAGE — List/delete characters
```bash
ls <x-writer skill folder>/scripts/characters/   # list
rm <x-writer skill folder>/scripts/characters/{name}.png  # delete
```

## CLI Reference

```
node <x-writer skill folder>/scripts/generate-image.js [options]

  -p, --prompt         Scene prompt (required)
  -o, --output         Output file path (required)
  -r, --reference      Reference image path(s) — repeat for multiple
  -a, --aspect-ratio   1:1, 16:9, 9:16, 4:3, 3:4 (default: 1:1)
  -m, --model          Gemini model (default: gemini-3.1-flash-image-preview)
```

## Thread → Panels Pipeline

1. **Read the thread** — `read_pad` to get `[p:nodeId]` for each tweet
2. **Identify which tweets need panels** — not every tweet needs an image (hook = text-only)
3. **Pick ONE style** from `comics/styles.md` — use for ALL panels
4. **Generate & insert panels** — two options:
   - **Fast path:** `insert_image(docId, prompt, afterNodeId)` — generates via Gemini + inserts atomically. All panels in parallel. No character references.
   - **Consistent path:** CLI `generate-image.js` with `-r` reference images, then insert manually (see below).
5. **Review with user** — regenerate any inconsistent panels

## Inserting Pre-Generated Images into OpenWriter

When using the **consistent path** (CLI-generated panels with reference images), you must copy them to OpenWriter's image directory and insert via `write_to_pad`:

```bash
# 1. Copy panels to the PROFILE images dir (NOT ~/.openwriter/_images/)
cp /c/tmp/panel-*.png ~/.openwriter/profiles/Default/_images/

# 2. Insert via write_to_pad with TipTap image nodes
write_to_pad(docId, changes: [
  { operation: "insert", afterNodeId: "<tweet-node-id>",
    content: { type: "image", attrs: { src: "/_images/panel-1.png", alt: "..." } } }
])
```

**CRITICAL:** Images MUST go in `~/.openwriter/profiles/Default/_images/` (or the active profile). The server serves `/_images/*` from `getDataDir()/_images/`, which resolves to the profile directory. Copying to `~/.openwriter/_images/` will result in broken images.

## Prompt Rules

1. ALWAYS describe character roles when passing reference images
2. ALWAYS describe clothing explicitly in every panel prompt
3. ALWAYS end with "No text, no watermarks, no logos."
4. Use the SAME style suffix for every panel in a strip
5. Keep prompts to 2-3 sentences — Gemini works better focused
6. Be specific about body language, posture, and action

## Character Storage

`<x-writer skill folder>/scripts/characters/{name}.png`

Optional registry: `<x-writer skill folder>/scripts/characters/registry.md`
