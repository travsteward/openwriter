/**
 * Start OpenWriter inside another Node program: `import { startOpenWriter } from 'openwriter/server'`.
 *
 * The embedder owns the process. This starts the HTTP + WebSocket server and the plugins and
 * nothing else: no client mode, no stdio MCP server, no single-server lock, no browser. Give it its
 * own data folder by setting OW_DATA_DIR before importing this module (it is read once at load).
 *
 * Every option is off by default; with none set the server behaves like the local app.
 * adr: adr/open-source-boundary.md
 */

import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { setEmbedOptions, type EmbedOptions } from './embed-options.js';
import { readConfig, setActiveProfile } from './helpers.js';
import { TOOL_REGISTRY } from './mcp.js';
import { load } from './state.js';
import { startHttpServer } from './index.js';
import { seedFirstRunDocuments } from './first-run.js';

export type { EmbedOptions, GateRefusal, FirstRunDocument } from './embed-options.js';
export type { OpenWriterPlugin, PluginHost, PluginRouteContext, PluginMcpTool, PluginConfigField } from './plugin-types.js';
// For an embedder running OpenWriter's tools for its own agent: pass each result through with
// that agent's session so it gets the documents' format contracts. adr: adr/in-system-guidance.md
export { appendDocGuidance } from './mcp.js';
export { GUIDANCE_NOTICE } from './doc-guidance.js';
// Each tool's title and read-only / destructive marks, for an embedder serving the tools over MCP itself.
export { toolLabels, type ToolLabels } from './tool-labels.js';
// For an embedder that keeps images in its own storage: answer for an image missing from
// _images/ (and, with holdings, list them so GitHub sync can hand them to the repo), and find
// the folder it sweeps. adr: adr/open-source-boundary.md
export { addImageSource } from './image-upload.js';
export type { ImageHoldings } from './image-upload.js';
export { getDataDir, getActiveProfile } from './helpers.js';
// The publish server as the signed-in writer (their key, the pinned API address, the active profile).
export { platformFetch } from './connections.js';
// Writing in the writer's voice, for an embedder with its own Rewrite UI. adr: adr/authors-voice.md
export {
  runEditor, defaultEditorModel, type EditorRequest, LENGTH_HINTS, type LengthHint, MAX_SELECTION_WORDS, VoiceError, explainApiError, redactKey, type ClientFactory, defaultClientFactory, usingBalance,
  balanceAccess, type AiCall, type BalanceRoute,
  MODELS, DEFAULT_REWRITE_MODEL, DEFAULT_CHAT_MODEL, modelFor, resolveChoice, type ModelChoice, type LiveModel,
} from './voice/index.js';

export interface StartOptions extends EmbedOptions {
  /** Port to listen on (default 5050; 0 picks a free one). */
  port?: number;
  /** Address to listen on (default 127.0.0.1). */
  host?: string;
  /** Discovered plugins to enable at start, by package name. */
  enable?: string[];
}

export interface RunningOpenWriter {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export async function startOpenWriter(options: StartOptions = {}): Promise<RunningOpenWriter> {
  const { port = 5050, host = '127.0.0.1', enable = [], ...embed } = options;
  setEmbedOptions(embed);
  setActiveProfile(readConfig().activeProfile || 'Default');

  // The tool filter applies to the built-in tools once, before anything lists them;
  // plugin tools are filtered as each plugin is enabled (plugin-manager.ts).
  if (embed.toolFilter) {
    for (let i = TOOL_REGISTRY.length - 1; i >= 0; i--) {
      if (!embed.toolFilter({ name: TOOL_REGISTRY[i].name })) TOOL_REGISTRY.splice(i, 1);
    }
  }

  // Bind before loading state, like the CLI: a failed bind leaves nothing half-started.
  const server = createServer((_req, res) => { res.statusCode = 503; res.end('starting'); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const boundPort = (server.address() as AddressInfo).port;

  if (embed.firstRunDocuments?.length) seedFirstRunDocuments(embed.firstRunDocuments);
  load();
  await startHttpServer({ server, port: boundPort, noOpen: true, plugins: enable });

  return {
    server,
    port: boundPort,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
