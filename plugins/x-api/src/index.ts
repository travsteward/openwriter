/**
 * X API plugin for OpenWriter.
 * Registers routes for checking X connection status and posting tweets.
 * Uses @xdevplatform/xdk with OAuth1 credentials from plugin config.
 */

import type { Express, Request, Response } from 'express';
import { Client, OAuth1 } from '@xdevplatform/xdk';

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

interface OpenWriterPlugin {
  name: string;
  version: string;
  description?: string;
  configSchema?: Record<string, PluginConfigField>;
  registerRoutes?(ctx: PluginRouteContext): void | Promise<void>;
}

function createXClient(config: Record<string, string>): Client | null {
  const apiKey = config['api-key'] || process.env.X_API_KEY || '';
  const apiSecret = config['api-secret'] || process.env.X_API_SECRET || '';
  const accessToken = config['access-token'] || process.env.X_ACCESS_TOKEN || '';
  const accessTokenSecret = config['access-token-secret'] || process.env.X_ACCESS_TOKEN_SECRET || '';

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;

  const oauth1 = new OAuth1({
    apiKey,
    apiSecret,
    callback: 'oob',
    accessToken,
    accessTokenSecret,
  });

  return new Client({ oauth1 });
}

const plugin: OpenWriterPlugin = {
  name: '@openwriter/plugin-x-api',
  version: '0.1.0',
  description: 'Post tweets from OpenWriter',

  configSchema: {
    'api-key':             { type: 'string', env: 'X_API_KEY', description: 'X API Key' },
    'api-secret':          { type: 'string', env: 'X_API_SECRET', description: 'X API Secret' },
    'access-token':        { type: 'string', env: 'X_ACCESS_TOKEN', description: 'X Access Token' },
    'access-token-secret': { type: 'string', env: 'X_ACCESS_TOKEN_SECRET', description: 'X Access Token Secret' },
  },

  registerRoutes(ctx: PluginRouteContext) {
    // GET /api/x/status — check if plugin is configured + authenticated
    ctx.app.get('/api/x/status', async (_req: Request, res: Response) => {
      try {
        const client = createXClient(ctx.config);
        if (!client) {
          res.json({ connected: false });
          return;
        }

        const me = await client.users.getMe();
        const username = (me as any)?.data?.username;
        res.json({ connected: true, username: username || undefined });
      } catch (err: any) {
        console.error('[X Plugin] Status check failed:', err.message);
        res.json({ connected: false, error: err.message });
      }
    });

    // POST /api/x/post — post a tweet
    ctx.app.post('/api/x/post', async (req: Request, res: Response) => {
      try {
        const { text, replyTo, quoteTweetId } = req.body;

        if (!text || typeof text !== 'string') {
          res.status(400).json({ success: false, error: 'text is required' });
          return;
        }

        const client = createXClient(ctx.config);
        if (!client) {
          res.status(400).json({ success: false, error: 'X API credentials not configured' });
          return;
        }

        const body: { text: string; reply?: Record<string, any>; quoteTweetId?: string } = { text };

        if (replyTo) {
          body.reply = { inReplyToTweetId: replyTo };
        }
        if (quoteTweetId) {
          body.quoteTweetId = quoteTweetId;
        }

        const result = await client.posts.create(body);
        const tweetId = (result as any)?.data?.id;
        const tweetUrl = tweetId ? `https://x.com/i/status/${tweetId}` : undefined;

        res.json({ success: true, tweetId, tweetUrl });
      } catch (err: any) {
        console.error('[X Plugin] Post failed:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });
  },
};

export default plugin;
