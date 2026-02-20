# Plugin Categories

> Introduce a `category` field to the plugin interface. Groups plugins by function for UI organization and future plugin marketplace.

---

## Motivation

With three plugin types emerging (writing, social media, image generation), plugins need categorization. Flat lists don't scale. Categories enable:
- Grouped display in plugin browser UI
- Context-aware plugin suggestions (e.g., show image-gen plugins when in article view)
- Future marketplace filtering

---

## Categories

| Category | Slug | Description | Examples |
|----------|------|-------------|----------|
| Writing | `writing` | Text generation, rewriting, voice | Authors Voice, grammar, translation |
| Social Media | `social-media` | Platform integrations, posting | X API, Bluesky, LinkedIn |
| Image Generation | `image-generation` | AI image creation and editing | Gemini Imagen, DALL-E, Stable Diffusion |

Categories are a fixed enum, not freeform strings. New categories added to the type as needed.

---

## Interface Changes

### plugin-types.ts

```typescript
export type PluginCategory = 'writing' | 'social-media' | 'image-generation';

export interface OpenWriterPlugin {
  name: string;
  version: string;
  description?: string;
  category?: PluginCategory;          // NEW — optional for backwards compat
  configSchema?: Record<string, PluginConfigField>;
  registerRoutes?(ctx: PluginRouteContext): void | Promise<void>;
  mcpTools?(config: Record<string, string>): PluginMcpTool[];
  contextMenuItems?(): PluginContextMenuItem[];
}
```

### Existing Plugin Updates

**authors-voice/src/index.ts:**
```typescript
const plugin: OpenWriterPlugin = {
  name: '@openwriter/plugin-authors-voice',
  version: '0.1.0',
  category: 'writing',
  // ... rest unchanged
};
```

**x-api/src/index.ts:**
```typescript
const plugin: OpenWriterPlugin = {
  name: '@openwriter/plugin-x-api',
  version: '0.1.0',
  category: 'social-media',
  // ... rest unchanged
};
```

---

## Context Menu Condition Fix

While updating plugin types, also fix the context menu condition system. Currently only `has-selection` and `always` exist. The `empty-node` condition is needed for image-gen (and fixes `fill paragraph` which is incorrectly using `has-selection`).

### plugin-types.ts

```typescript
export interface PluginContextMenuItem {
  label: string;
  shortcut?: string;
  action: string;
  condition?: 'has-selection' | 'empty-node' | 'always';  // ADD empty-node
  promptForInput?: boolean;
}
```

### ContextMenu.tsx — getActions()

Add empty-node detection:

```typescript
const isEmptyNode = (() => {
  const editor = editorRef.current;
  if (!editor) return false;
  const { $from } = editor.state.selection;
  return $from.parent.content.size === 0;
})();

// In the filter loop:
for (const pi of pluginItems) {
  if (pi.condition === 'has-selection' && !hasSelection) continue;
  if (pi.condition === 'empty-node' && !isEmptyNode) continue;
  items.push({...});
}
```

### authors-voice fix

Change `fill paragraph` from `has-selection` to `empty-node`:

```typescript
// Before:
{ label: 'Fill paragraph', shortcut: 'F', action: 'av:fill', condition: 'has-selection' as const }

// After:
{ label: 'Fill paragraph', shortcut: 'F', action: 'av:fill', condition: 'empty-node' as const }
```

---

## Plugin Discovery Metadata

`plugin-manager.ts` already exposes plugin metadata via `GET /api/available-plugins` and `GET /api/plugins`. The `category` field flows through automatically since plugin descriptors include all exported fields.

No additional server-side changes needed beyond the type definition.

---

## Files to Modify

| File | Change |
|------|--------|
| `server/plugin-types.ts` | Add `PluginCategory` type, `category` field to `OpenWriterPlugin`, `empty-node` to condition union |
| `plugins/authors-voice/src/index.ts` | Add `category: 'writing'`, fix fill paragraph condition to `empty-node` |
| `plugins/x-api/src/index.ts` | Add `category: 'social-media'` |
| `src/context-menu/ContextMenu.tsx` | Add `isEmptyNode` detection, filter `empty-node` condition |
