# Character Management

## Character Storage

Characters are stored as PNG files in `<x-writer skill folder>/scripts/characters/`.

Naming convention: `{name}.png` — lowercase, hyphens for spaces.
- `alex.png`
- `jordan.png`
- `narrator.png`

## Creating a Character

### From scratch (AI-generated)
Generate a clear reference portrait:

```bash
node <x-writer skill folder>/scripts/generate-image.js \
  -p "Character portrait of [DETAILED DESCRIPTION]. Front-facing, neutral background, even studio lighting, clear facial features visible. High detail. No text, no watermarks, no logos." \
  -o <x-writer skill folder>/scripts/characters/{name}.png \
  -a "1:1"
```

**Best practices for character creation prompts:**
- Specify: age range, build, hair (color, style, length), facial hair, skin tone
- Specify: clothing (be specific — this becomes the "default outfit")
- Specify: expression (neutral or characteristic)
- Always: "front-facing, neutral background, even studio lighting"
- The more specific the description, the more consistent the character stays across panels

### From an existing image
Copy any clear portrait to the characters directory:
```bash
cp /path/to/reference.png <x-writer skill folder>/scripts/characters/{name}.png
```

Requirements for good reference images:
- Clear face visible (no heavy shadows or occlusion)
- Decent resolution (512x512 minimum, 1024x1024+ preferred)
- Single subject (no group photos)
- Even lighting (no dramatic shadows hiding features)

### Multi-angle references (advanced)
For maximum consistency, create 3 reference angles:
- `{name}-front.png` — straight-on
- `{name}-left.png` — 3/4 left view
- `{name}-right.png` — 3/4 right view

Pass all three as references when generating panels:
```bash
node generate-image.js \
  -p "Images 1-3 are reference angles for Character A. Maintain exact appearance. [SCENE]" \
  -r characters/{name}-front.png \
  -r characters/{name}-left.png \
  -r characters/{name}-right.png \
  -o panel.png
```

## Listing Characters

```bash
ls <x-writer skill folder>/scripts/characters/
```

## Deleting Characters

```bash
rm <x-writer skill folder>/scripts/characters/{name}.png
```

## Character Description Registry

When creating a character, also save a text description alongside it so future sessions
can reference it without re-analyzing the image. Create a simple `characters/registry.md`:

```markdown
## alex
Male, early 30s, athletic build. Short dark brown hair, light stubble.
Sharp jawline. Wearing a fitted black henley. Confident neutral expression.

## jordan
Male, late 20s, muscular build. Blonde hair swept back. Clean-shaven.
Wearing a grey fitted t-shirt. Slightly arrogant smirk.
```

This registry lets Claude reconstruct character descriptions without loading images,
and ensures clothing/feature descriptions stay consistent across prompts.
