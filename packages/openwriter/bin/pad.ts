#!/usr/bin/env node

/**
 * CLI entry point for OpenWriter.
 * Usage: openwriter [--api-key av_live_xxx] [--port 5050] [--no-open] [--av-url URL] [--plugins name1,name2]
 *
 * API key resolution (first wins):
 *   1. --api-key CLI flag
 *   2. AV_API_KEY environment variable
 *   3. Saved in ~/.openwriter/config.json (from a previous --api-key)
 *
 * If no key found, server starts anyway — plugins that need it will report errors.
 *
 * Boot order optimized for fast MCP startup:
 *   1. Parse args + config (light imports only)
 *   2. Port check (fast TCP probe)
 *   3. Start MCP stdio transport (what Claude Code waits for)
 *   4. Lazy-load Express server + plugins (heavy deps deferred)
 */

// Redirect all console output to stderr so MCP stdio protocol stays clean on stdout
const originalLog = console.log;
console.log = (...args: any[]) => console.error(...args);

// Only light imports here — helpers.js uses fs/path/os/crypto (all Node stdlib)
import { createConnection } from 'net';
import { readConfig, saveConfig } from '../server/helpers.js';

const args = process.argv.slice(2);

// Subcommands (run and exit, don't start server)
if (args[0] === 'install-skill') {
  import('../server/install-skill.js').then(m => m.installSkill());
} else {
  let port = 5050;
  let noOpen = false;
  let cliApiKey: string | undefined;
  let cliAvUrl: string | undefined;
  let plugins: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === '--no-open') {
      noOpen = true;
    }
    if (args[i] === '--api-key' && args[i + 1]) {
      cliApiKey = args[i + 1];
      i++;
    }
    if (args[i] === '--av-url' && args[i + 1]) {
      cliAvUrl = args[i + 1];
      i++;
    }
    if (args[i] === '--plugins' && args[i + 1]) {
      plugins = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    }
  }

  // Resolve API key: CLI flag → env var → saved config
  const config = readConfig();
  const avApiKey = cliApiKey || process.env.AV_API_KEY || config.avApiKey || '';
  const avBackendUrl = cliAvUrl || process.env.AV_BACKEND_URL || config.avBackendUrl;

  // Persist new values to config so future starts don't need them
  const updates: Record<string, string> = {};
  if (cliApiKey && cliApiKey !== config.avApiKey) updates.avApiKey = cliApiKey;
  if (cliAvUrl && cliAvUrl !== config.avBackendUrl) updates.avBackendUrl = cliAvUrl;
  if (Object.keys(updates).length > 0) {
    saveConfig(updates);
    console.log('Config saved to ~/.openwriter/config.json');
  }

  // Set env vars for downstream code (plugins read process.env)
  if (avApiKey) process.env.AV_API_KEY = avApiKey;
  if (avBackendUrl) process.env.AV_BACKEND_URL = avBackendUrl;

  // Fast port check — determines primary vs client mode
  const portTaken = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { resolve(false); });
  });

  if (portTaken) {
    // Client mode: proxy MCP calls to existing primary server via HTTP
    console.error(`[OpenWriter] Port ${port} in use — entering client mode (proxying to existing server)`);
    const { startMcpClientServer } = await import('../server/mcp-client.js');
    startMcpClientServer(port).catch((err) => {
      console.error('[MCP-Client] Failed to start:', err);
    });
  } else {
    // Primary mode: start MCP stdio FIRST, then lazy-load Express
    const { load } = await import('../server/state.js');
    load();

    const { startMcpServer } = await import('../server/mcp.js');
    startMcpServer().catch((err) => {
      console.error('[MCP] Failed to start:', err);
    });

    // Deferred: load Express + plugins (heavy deps) after MCP is connecting
    const { startHttpServer } = await import('../server/index.js');
    startHttpServer({ port, noOpen, plugins });
  }
}
