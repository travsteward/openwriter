# X Images

Generate images for X content. Two modes based on context.

## Modes

### COVER — Single image for an X Article
1. Get article context (topic, title, draft text)
2. Walk the decision tree → find the ONE concept
3. Pick style → craft prompt → generate
4. Set as article cover via `insert_image(prompt, set_cover: true)`

### THREAD — Multiple images for a tweet thread
1. `read_pad` to get thread structure (`[p:nodeId]` per tweet)
2. Identify which tweets need images (not every tweet does)
3. Pick ONE style for ALL images in the thread
4. Generate & insert via `insert_image(docId, prompt, afterNodeId)` — all panels in parallel
5. Review with user, regenerate inconsistent ones

For character-consistent thread images, use the CLI with reference images:
```bash
node <x-writer skill folder>/scripts/generate-image.js \
  -p "Scene prompt. [STYLE SUFFIX]. No text, no watermarks, no logos." \
  -o /c/tmp/panel-1.png \
  -r <x-writer skill folder>/scripts/characters/{name}.png \
  -a "16:9"
```

Then copy to `~/.openwriter/profiles/Default/_images/` and insert via `write_to_pad`.

## Styles

### 1. Dark Editorial
Best for: culture war takes, institutional critique, provocative intellectual arguments.

**Look:** Dark backgrounds, dramatic lighting, single focal subject. Moody, authoritative.
- Color palettes: deep charcoal + amber, black + cold steel blue, midnight + warm gold
- Lighting: single dramatic source, rim lighting, chiaroscuro

**Prompt suffix:** `Dark editorial style. Dramatic single-source lighting, deep shadows. Rich dark tones with [COLOR] accents. Shot on medium format, shallow depth of field. No text, no watermarks, no logos.`

### 2. Cinematic Realism
Best for: masculinity, fitness, human behavior, relationship dynamics, personal development.

**Look:** Photo-realistic scenes with cinematic lighting. Could be a still from a prestige TV show.
- Color palettes: warm amber/gold, desaturated cool, natural earth tones
- Lighting: golden hour, hard contrast, natural available light

**Prompt suffix:** `Cinematic photograph. Realistic, candid feel. [LIGHTING]. [COLOR PALETTE]. Shot on 35mm film, natural grain, shallow depth of field. No text, no watermarks, no logos.`

### 3. Abstract/Conceptual
Best for: evo psych theory, sexual selection mechanics, complex biological concepts.

**Look:** Symbolic imagery — DNA helixes, silhouettes, geometric overlays, split compositions. Cerebral.
- Color palettes: monochromatic with one accent, deep blue + gold, black + red
- Lighting: studio-style, controlled, graphic

**Prompt suffix:** `Conceptual editorial photograph. Symbolic composition. [LIGHTING]. [COLOR PALETTE]. Clean, graphic quality, sharp focus. No text, no watermarks, no logos.`

### 4. Raw/Documentary
Best for: biology, nature references, animal behavior, evolutionary competition.

**Look:** National Geographic meets editorial. Real animals, real environments, unstaged.
- Color palettes: natural earth tones, golden savanna, cold arctic blue
- Lighting: natural — golden hour, overcast, harsh midday

**Prompt suffix:** `Wildlife/documentary photograph. [SCENE]. [LIGHTING]. [COLOR PALETTE]. Shot on telephoto lens, shallow depth of field, National Geographic quality. No text, no watermarks, no logos.`

### 5. Dark Infographic
Best for: mechanism diagrams, distance measurement, bell curves, trait comparisons, data-visual threads.

**Look:** Dark background with illustrated figures and measurement/diagram overlays. Labels, arrows, comparison lines. Scientific but stylized.
- Color palettes: dark charcoal + white labels + accent color
- Lighting: flat/even on figures, dark surround
- Feel: educational, authoritative, shareable

**Prompt suffix:** `Dark infographic illustration. [FIGURES/COMPARISON]. Clean measurement lines and labels on dark background. Bold outlines, diagrammatic feel. No text bubbles, no watermarks, no logos.`

## Decision Tree — Finding the Image

Walk through in order. Use the FIRST one that fits:

**A. Cultural Archetype** — Is there a person/type that EMBODIES the concept?
**B. Concrete Metaphor** — Does the content use a specific visual metaphor?
**C. Symbolic Scene** — Can a constructed scene tell the story?
**D. Atmospheric/Abstract** — Fallback: mood, texture, color.

## Brand Notes

- Never corporate or sterile
- Never stock-photo energy
- Masculine but not cringe (no shirtless gym selfies, no flag eagles)
- Intellectual but accessible
- Scroll-stop factor — X timeline moves fast

## CLI Reference

```
node <x-writer skill folder>/scripts/generate-image.js [options]

  -p, --prompt         Scene prompt (required)
  -o, --output         Output file path (required)
  -r, --reference      Reference image path(s) — repeat for multiple
  -a, --aspect-ratio   1:1, 16:9, 9:16, 4:3, 3:4 (default: 1:1)
  -m, --model          Gemini model (default: gemini-3.1-flash-image-preview)
```

## Character Storage

`<x-writer skill folder>/scripts/characters/{name}.png`

For character creation workflow → `images/characters.md`

## Prompt Rules

1. Be SPECIFIC — describe posture, lighting, environment in detail
2. Include lighting details — they drive mood more than anything
3. Keep prompts to 2-3 sentences — Gemini works better focused
4. Always end with "No text, no watermarks, no logos."
5. Never say "leave area empty" — Gemini draws literal boxes
6. Use the SAME style suffix for every image in a thread set
