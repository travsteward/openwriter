/**
 * Author's Voice plugin for OpenWriter.
 * Proxies /api/voice/* to the AV backend and adds editor context-menu items
 * for sub-paragraph text actions (Enhance / Modify / Shrink / Expand / Insert / Fill).
 *
 * Sidebar document transforms (Vary / Shrinkify / Threadify / etc.) live in
 * @openwriter/plugin-publish — they go through the metered platform path.
 */

import type { Express, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const PLUGIN_NAME = '@openwriter/plugin-authors-voice';

/**
 * Live-read the model tier from ~/.openwriter/config.json per request.
 * The host passes plugin config ONCE at registerRoutes and never reloads it on save, so the
 * dropdown's value would otherwise require a server restart. Reading the file per request
 * makes a model-picker change take effect on the very next Enhance. Falls back to the
 * load-time value on any error.
 */
function liveModelTier(fallback: string): string {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.openwriter', 'config.json'), 'utf8'));
    const v = cfg?.plugins?.[PLUGIN_NAME]?.config?.model;
    return typeof v === 'string' ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Strip a leading YAML frontmatter block so it never lands in the voice corpus. */
function stripFrontmatter(md: string): string {
  return md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/** Pull OpenWriter's stable doc id out of the on-disk markdown (frontmatter carries
 *  `"docId":"..."`). Returns null when absent so the caller can fall back to the filename. */
function extractOwDocId(md: string): string | null {
  const m = typeof md === 'string' ? md.match(/"docId"\s*:\s*"([^"]+)"/) : null;
  return m ? m[1] : null;
}

interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  env?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>;
}

interface PluginRouteContext {
  app: Express;
  config: Record<string, string>;
}

interface PluginContextMenuItem {
  label: string;
  shortcut?: string;
  action: string;
  condition?: 'has-selection' | 'empty-node' | 'always';
  promptForInput?: boolean;
}

interface PluginSidebarMenuItem {
  label: string;
  action: string;
  promptForFocus?: boolean;
  // When true, OpenWriter also offers this item on workspace/container right-click,
  // applying it to every doc in the folder. Used for ingestion (add to corpus).
  folderCapable?: boolean;
}

interface OpenWriterPlugin {
  name: string;
  version: string;
  description?: string;
  category?: 'writing' | 'social-media' | 'image-generation';
  configSchema?: Record<string, PluginConfigField>;
  registerRoutes?(ctx: PluginRouteContext): void | Promise<void>;
  contextMenuItems?(): PluginContextMenuItem[];
  sidebarMenuItems?(): PluginSidebarMenuItem[];
}

const plugin: OpenWriterPlugin = {
  name: '@openwriter/plugin-authors-voice',
  version: '0.4.0',
  description: "Rewrite text in your voice using Author's Voice",
  category: 'writing',

  configSchema: {
    'api-key': {
      type: 'string',
      required: true,
      env: 'AV_API_KEY',
      description: 'Author\'s Voice API key',
    },
    'backend-url': {
      type: 'string',
      env: 'AV_BACKEND_URL',
      description: 'AV backend URL',
    },
    // Model tier for rewrites. Sent as `modelTier` on /api/voice/* (the AV API owns the
    // tier→model map + default — this is a pure pass-through of the user's pick). Blank =
    // API default (strongest). Labels mirror the API's TIER_PICKER_OPTIONS.
    'model': {
      type: 'select',
      env: 'AV_MODEL_TIER',
      description: 'Writing model',
      options: [
        { value: '', label: 'Default (Strongest)' },
        { value: 'strongest', label: 'Strongest — Claude Opus (best quality, $$$)' },
        { value: 'fast-plus', label: 'Fast+ — Gemini 3.8 Flash (rapid, no cooldowns, $)' },
        { value: 'fast', label: 'Fast — Gemini 3.8 Flash (free, slower, cooldowns)' },
      ],
    },
  },

  registerRoutes(ctx: PluginRouteContext) {
    const backendUrl = ctx.config['backend-url'] || process.env.AV_BACKEND_URL || 'https://authors-voice.com';
    const apiKey = ctx.config['api-key'] || process.env.AV_API_KEY || '';
    const debugEnabled = process.env.AV_DEBUG === '1' || process.env.AV_DEBUG === 'true';
    const modelTier = ctx.config['model'] || process.env.AV_MODEL_TIER || '';

    const authHeaders = (): Record<string, string> => {
      const h: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
      return h;
    };

    const withDebug = (body: unknown): unknown => {
      if (!debugEnabled || !body || typeof body !== 'object') return body;
      return { ...(body as Record<string, unknown>), debug: true };
    };

    // Inject the user's model-tier pick, read LIVE per request (dropdown changes take effect
    // immediately, no restart). Pure pass-through: the AV API validates the slug and falls
    // back to its own default if absent/unknown. Blank → nothing injected.
    const withModel = (body: unknown): unknown => {
      const tier = liveModelTier(modelTier);
      if (!tier || !body || typeof body !== 'object') return body;
      return { ...(body as Record<string, unknown>), modelTier: tier };
    };

    // Sidebar ingestion: right-click a doc (or a whole workspace/container) → "Add to
    // Author's Voice". OpenWriter pre-fetches the doc's on-disk markdown and hands it here
    // as `content`, so no file-upload primitive is needed — the doc IS the sample. We strip
    // frontmatter, key the corpus docId off the OW doc's stable id (idempotent re-sync:
    // re-running replaces that doc's chunks), and post to the AV corpus endpoint. Registered
    // BEFORE the /api/voice/* wildcard so it isn't proxied straight through to the backend.
    ctx.app.post('/api/voice/sidebar-action', async (req: Request, res: Response) => {
      try {
        const { filename, title, content } = req.body || {};
        const body = stripFrontmatter(typeof content === 'string' ? content : '');
        if (!body.trim()) {
          res.status(400).json({ error: 'Document is empty — nothing to add to your voice.' });
          return;
        }
        // Stable, namespaced corpus id so re-adding the same doc replaces its prior chunks.
        const owId = extractOwDocId(content) || String(filename || '').replace(/\.[^.]+$/, '');
        const docId = `ow-${owId}`;

        const upstream = await fetch(`${backendUrl}/api/voice/content`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ docId, content: body, categories: ['openwriter'], authenticity: 'Human' }),
        });

        const text = await upstream.text();
        let data: any;
        try { data = JSON.parse(text); } catch {
          console.error('[AV Plugin] Non-JSON response (sidebar-action):', text.substring(0, 500));
          res.status(502).json({ error: 'AV backend returned non-JSON response' });
          return;
        }
        if (!upstream.ok) {
          res.status(upstream.status).json(data);
          return;
        }
        res.json({
          success: true,
          action: 'add-to-corpus',
          title: title || docId,
          docId,
          chunksCreated: data?.chunksCreated ?? 0,
        });
      } catch (err: any) {
        console.error('[AV Plugin] sidebar-action error:', err?.message || err);
        res.status(502).json({ error: 'AV backend unreachable' });
      }
    });

    // Wildcard proxy for /api/voice/* routes. Pure pass-through: the AV API owns the
    // engine choice (v1/v2) via its own AV_DEFAULT_ENGINE setting, so the plugin injects
    // nothing but the optional owner-only dev debug flag.
    ctx.app.post('/api/voice/*', async (req: Request, res: Response) => {
      try {
        const subPath = (req.params as any)[0] || '';
        const targetUrl = `${backendUrl}/api/voice/${subPath}`;
        const body = withModel(withDebug(req.body));
        console.log(`[AV Plugin] ${req.method} ${req.path} → ${targetUrl}`);

        const upstream = await fetch(targetUrl, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        });

        res.status(upstream.status);
        const forwardHeaders = ['x-usage-rewrite-count', 'x-usage-rewrite-limit', 'x-usage-resets-at'];
        for (const h of forwardHeaders) {
          const val = upstream.headers.get(h);
          if (val) res.setHeader(h, val);
        }

        const responseText = await upstream.text();
        try {
          const data = JSON.parse(responseText);
          res.json(data);
        } catch {
          console.error('[AV Plugin] Non-JSON response:', responseText.substring(0, 500));
          res.status(502).json({ error: 'AV backend returned non-JSON response' });
        }
      } catch (err: any) {
        console.error('[AV Plugin] Backend error:', err?.message || err);
        res.status(502).json({ error: 'AV backend unreachable' });
      }
    });

    // Wildcard GET proxy for /api/voice/* — same key-injection + base-URL pattern as the POST
    // proxy above, no body. Covers the wallet/top-up reads (GET /api/voice/billing and
    // /api/voice/billing/topup-options); the matching POST /api/voice/billing/topup rides the
    // POST wildcard. Query string is forwarded so any future paginated read just works.
    ctx.app.get('/api/voice/*', async (req: Request, res: Response) => {
      try {
        const subPath = (req.params as any)[0] || '';
        const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        const targetUrl = `${backendUrl}/api/voice/${subPath}${qs}`;
        console.log(`[AV Plugin] ${req.method} ${req.path} → ${targetUrl}`);

        const upstream = await fetch(targetUrl, {
          method: 'GET',
          headers: authHeaders(),
        });

        res.status(upstream.status);
        const responseText = await upstream.text();
        try {
          res.json(JSON.parse(responseText));
        } catch {
          console.error('[AV Plugin] Non-JSON response:', responseText.substring(0, 500));
          res.status(502).json({ error: 'AV backend returned non-JSON response' });
        }
      } catch (err: any) {
        console.error('[AV Plugin] Backend error:', err?.message || err);
        res.status(502).json({ error: 'AV backend unreachable' });
      }
    });
  },

  contextMenuItems() {
    return [
      // Selection actions (require highlighted text)
      { label: 'Enhance', shortcut: 'R', action: 'av:rewrite', condition: 'has-selection' as const },
      { label: 'Modify...', action: 'av:custom', condition: 'has-selection' as const, promptForInput: true },
      { label: 'Shrink', shortcut: 'S', action: 'av:shrink', condition: 'has-selection' as const },
      { label: 'Expand', shortcut: 'E', action: 'av:expand', condition: 'has-selection' as const },
      // Empty node actions (cursor on empty line)
      { label: 'Insert', shortcut: 'I', action: 'av:insert', condition: 'empty-node' as const, promptForInput: true },
      { label: 'Fill paragraph', shortcut: 'F', action: 'av:fill', condition: 'empty-node' as const },
      { label: 'Fill sentence', action: 'av:fill-sentence', condition: 'empty-node' as const },
    ];
  },

  // Sidebar (file tree) right-click. `voice:` prefix routes the dispatch to this plugin's
  // POST /api/voice/sidebar-action. folderCapable → also offered on workspaces/containers,
  // where OpenWriter applies it to every doc in the folder.
  sidebarMenuItems() {
    return [
      { label: "Add to Author's Voice", action: 'voice:add-to-corpus', folderCapable: true },
    ];
  },
};

export default plugin;
