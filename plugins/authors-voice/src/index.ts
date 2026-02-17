/**
 * Author's Voice plugin for OpenWriter.
 * Proxies /api/voice/* to the AV backend and adds context menu items
 * for rewriting, shrinking, expanding, and custom instructions.
 */

import type { Express, Request, Response } from 'express';

interface PluginConfigField {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  env?: string;
  description?: string;
}

interface PluginRouteContext {
  app: Express;
  config: Record<string, string>;
}

interface PluginContextMenuItem {
  label: string;
  shortcut?: string;
  action: string;
  condition?: 'has-selection' | 'always';
  promptForInput?: boolean;
}

interface OpenWriterPlugin {
  name: string;
  version: string;
  description?: string;
  configSchema?: Record<string, PluginConfigField>;
  registerRoutes?(ctx: PluginRouteContext): void | Promise<void>;
  contextMenuItems?(): PluginContextMenuItem[];
}

const plugin: OpenWriterPlugin = {
  name: '@openwriter/plugin-authors-voice',
  version: '0.1.0',
  description: "Rewrite text in your voice using Author's Voice",

  configSchema: {
    'api-key': {
      type: 'string',
      env: 'AV_API_KEY',
      description: 'Author\'s Voice API key',
    },
    'backend-url': {
      type: 'string',
      env: 'AV_BACKEND_URL',
      description: 'AV backend URL',
    },
  },

  registerRoutes(ctx: PluginRouteContext) {
    const backendUrl = ctx.config['backend-url'] || process.env.AV_BACKEND_URL || 'https://authors-voice.com';
    const apiKey = ctx.config['api-key'] || process.env.AV_API_KEY || '';

    ctx.app.post('/api/voice/*', async (req: Request, res: Response) => {
      try {
        const subPath = (req.params as any)[0] || '';
        const targetUrl = `${backendUrl}/api/voice/${subPath}`;
        console.log(`[AV Plugin] ${req.method} ${req.path} → ${targetUrl}`);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const upstream = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(req.body),
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
  },

  contextMenuItems() {
    return [
      { label: 'Rewrite', shortcut: 'R', action: 'av:rewrite', condition: 'has-selection' as const },
      { label: 'Shrink', shortcut: 'S', action: 'av:shrink', condition: 'has-selection' as const },
      { label: 'Expand', shortcut: 'E', action: 'av:expand', condition: 'has-selection' as const },
      { label: 'Custom...', action: 'av:custom', condition: 'has-selection' as const, promptForInput: true },
      { label: 'Fill paragraph', shortcut: 'F', action: 'av:fill', condition: 'has-selection' as const },
      { label: 'Insert after', shortcut: 'I', action: 'av:insert', condition: 'has-selection' as const },
    ];
  },
};

export default plugin;
