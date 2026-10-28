/**
 * GitHub Plugin for OpenWriter.
 * Provides two capabilities:
 *   1. Docs sync — two-way: commit, fetch, merge GitHub in, push.
 *      Auth: `gh auth`, a PAT, or "Sign in with GitHub" (device flow).
 *   2. Blog sites — list of blog repos, post via local git ops.
 *
 * Routes match the previous core mount points so SyncButton + SyncSetupModal
 * keep working. adr: adr/two-way-sync.md
 */

import type { Request, Response } from 'express';
import type { OpenWriterPlugin, PluginRouteContext } from './helpers.js';
import { getServerModules } from './helpers.js';
import {
  getSyncStatus,
  getCapabilities,
  getPendingFiles,
  setupWithGh,
  setupWithToken,
  connectExisting,
  connectRepo,
  findDocsRepos,
  pullNow,
  startAutoSync,
  undoNotice,
  dismissNotice,
  docHistory,
  restoreDocVersion,
  rollbackPreview,
  rollbackTo,
  saveDeviceName,
  suggestDeviceName,
  syncNow,
  writingOnlyImage,
  type SyncStatus,
} from './git-sync.js';
import { startDeviceFlow, pollDeviceFlow } from './device-flow.js';
import { blogTools } from './blog-tools.js';

const plugin: OpenWriterPlugin = {
  name: '@openwriter/plugin-github',
  version: '0.1.0',
  description: 'GitHub Plugin: Sync files and publish blogs.',
  category: 'productivity',

  // No user-input credentials — auth piggybacks on the user's existing
  // `gh auth`, a PAT, or device flow (verified in getCapabilities). Blog-site
  // list is stored outside the configSchema as structured data.
  configSchema: {
    pullOnStart: {
      type: 'boolean',
      env: 'OW_GITHUB_PULL_ON_START',
      description: 'Bring in changes from GitHub when OpenWriter starts',
    },
  },

  mcpTools() {
    return blogTools();
  },

  registerRoutes(ctx: PluginRouteContext) {
    const broadcast = async (status: SyncStatus) => {
      try {
        const srv = await getServerModules();
        srv.broadcastSyncStatus(status);
      } catch (err: any) {
        console.error('[GitHub Plugin] broadcast failed:', err.message);
      }
    };

    // MCP-15: log the real error server-side; return a generic message to the
    // client so internal details (paths, git output, tokens) never leak.
    const fail = (res: Response, where: string, err: any, extra: Record<string, any> = {}) => {
      console.error(`[GitHub Plugin] ${where} failed:`, err?.message || err);
      res.status(500).json({ error: 'Internal error', ...extra });
    };

    ctx.app.get('/api/sync/status', async (_req: Request, res: Response) => {
      try { res.json(await getSyncStatus()); }
      catch (err: any) { fail(res, 'sync/status', err, { state: 'error' }); }
    });

    ctx.app.get('/api/sync/capabilities', async (_req: Request, res: Response) => {
      try { res.json(await getCapabilities()); }
      catch (err: any) { fail(res, 'sync/capabilities', err); }
    });

    ctx.app.get('/api/sync/pending', async (_req: Request, res: Response) => {
      try { res.json(await getPendingFiles()); }
      catch (err: any) { fail(res, 'sync/pending', err); }
    });

    // After sign-in: the writer's existing documents repos (so a second device
    // joins the first one's repo) and a suggested name for this device.
    ctx.app.get('/api/sync/repos', async (_req: Request, res: Response) => {
      try {
        const found = await findDocsRepos();
        res.json({ repos: found.repos, login: found.login, deviceSuggestion: suggestDeviceName(found.name || found.login) });
      } catch (err: any) {
        console.error('[GitHub Plugin] sync/repos failed:', err?.message || err);
        res.status(err?.signIn ? 401 : 500).json({ error: err?.message || 'Could not reach GitHub', signIn: !!err?.signIn });
      }
    });

    ctx.app.post('/api/sync/setup', async (req: Request, res: Response) => {
      try {
        const { method, repoName, remoteUrl, pat, isPrivate, repo, deviceName } = req.body;
        if (typeof deviceName === 'string' && deviceName.trim()) await saveDeviceName(deviceName);

        let conflicts: string[];
        if (method === 'use') {
          conflicts = await connectRepo(String(repo || ''));
        } else if (method === 'gh') {
          conflicts = await setupWithGh(repoName || 'openwriter-docs', isPrivate !== false);
        } else if (method === 'pat') {
          // No PAT in the body: use the stored token (device-flow sign-in).
          conflicts = await setupWithToken(pat || undefined, repoName || 'openwriter-docs', isPrivate !== false);
        } else if (method === 'connect') {
          if (!remoteUrl) { res.status(400).json({ error: 'Remote URL is required' }); return; }
          conflicts = await connectExisting(remoteUrl, pat);
        } else {
          res.status(400).json({ error: 'Invalid method. Use: use, gh, pat, or connect' });
          return;
        }

        const status = await getSyncStatus();
        await broadcast(status);
        await startAutoSync((s) => { void broadcast(s); });
        res.json({ success: true, status, conflicts });
      } catch (err: any) {
        // Setup surfaces GitHub's own API feedback (e.g. "name already exists",
        // "bad credentials") which is user-actionable; the remote is now
        // credential-free so this carries no secret. Still log the full error.
        console.error('[GitHub Plugin] sync/setup failed:', err?.message || err);
        res.status(500).json({ error: err?.message || 'Setup failed' });
      }
    });

    // "Sign in with GitHub": start gives the writer a code; the browser then
    // polls until GitHub hands over the token. adr: adr/two-way-sync.md
    ctx.app.post('/api/sync/device/start', async (_req: Request, res: Response) => {
      try { res.json(await startDeviceFlow()); }
      catch (err: any) {
        console.error('[GitHub Plugin] sync/device/start failed:', err?.message || err);
        res.status(500).json({ error: err?.message || 'Sign-in failed' });
      }
    });

    ctx.app.post('/api/sync/device/poll', async (_req: Request, res: Response) => {
      try { res.json(await pollDeviceFlow()); }
      catch (err: any) { fail(res, 'sync/device/poll', err, { status: 'error' }); }
    });

    const onStatus = (s: SyncStatus) => { void broadcast(s); };

    // Two-way sync now: the status line's click, and the page's last word on
    // close (sendBeacon). The route keeps its old name for existing clients.
    ctx.app.post('/api/sync/push', async (_req: Request, res: Response) => {
      try {
        const result = await syncNow(onStatus);
        res.json(result);
      } catch (err: any) {
        fail(res, 'sync/push', err, { state: 'error' });
      }
    });

    // The browser catches up on open, on focus, before opening a document and
    // every minute while it is connected. Waits (deferred) while the writer types.
    ctx.app.post('/api/sync/pull', async (_req: Request, res: Response) => {
      try { res.json(await pullNow(onStatus)); }
      catch (err: any) { fail(res, 'sync/pull', err, { state: 'error' }); }
    });

    // Notices a sync left (a replaced paragraph, a deleted open document): undo or dismiss.
    ctx.app.post('/api/sync/notices/:id/undo', async (req: Request, res: Response) => {
      try { res.json(await undoNotice(String(req.params.id), onStatus)); }
      catch (err: any) { fail(res, 'sync/notices/undo', err); }
    });

    ctx.app.post('/api/sync/notices/:id/dismiss', async (req: Request, res: Response) => {
      try {
        await dismissNotice(String(req.params.id));
        const status = await getSyncStatus();
        onStatus(status);
        res.json(status);
      } catch (err: any) { fail(res, 'sync/notices/dismiss', err); }
    });

    // History on GitHub for the Versions tab, and rolling everything back to a time.
    ctx.app.get('/api/sync/history/:docId', async (req: Request, res: Response) => {
      try { res.json({ versions: await docHistory(String(req.params.docId)) }); }
      catch (err: any) { fail(res, 'sync/history', err); }
    });

    ctx.app.post('/api/sync/history/restore', async (req: Request, res: Response) => {
      try { res.json(await restoreDocVersion(String(req.body?.docId || ''), String(req.body?.sha || ''), onStatus)); }
      catch (err: any) { fail(res, 'sync/history/restore', err); }
    });

    ctx.app.get('/api/sync/rollback', async (req: Request, res: Response) => {
      try { res.json(await rollbackPreview(String(req.query.at || ''))); }
      catch (err: any) { fail(res, 'sync/rollback preview', err); }
    });

    ctx.app.post('/api/sync/rollback', async (req: Request, res: Response) => {
      try { res.json(await rollbackTo(String(req.body?.at || ''), onStatus)); }
      catch (err: any) { fail(res, 'sync/rollback', err); }
    });

    // A writing-only copy answers for the images it left on GitHub, wherever one is read.
    void getServerModules().then((srv) => srv.addImageSource(writingOnlyImage))
      .catch((err: any) => console.error('[GitHub Plugin] image source failed:', err?.message || err));

    // Every save is committed here and sent after the writer pauses.
    void startAutoSync(onStatus).catch((err: any) => console.error('[GitHub Plugin] auto-sync failed to start:', err?.message || err));

    // Opt-in: catch up with GitHub once at start-up, for an OpenWriter that is
    // often started after edits elsewhere (an online copy waking up).
    if (ctx.config.pullOnStart === 'true' || ctx.config.pullOnStart === '1') {
      void (async () => {
        try {
          if ((await getSyncStatus()).state === 'unconfigured') return;
          await syncNow((s) => { void broadcast(s); }, { push: false });
        } catch (err: any) {
          console.error('[GitHub Plugin] start-up pull failed:', err?.message || err);
        }
      })();
    }
  },
};

export default plugin;
