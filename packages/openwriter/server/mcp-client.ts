/**
 * Client-mode MCP server: lightweight proxy to the running primary server.
 * Zero local imports — fetches tool metadata via HTTP, proxies calls via HTTP.
 * Used when another terminal already owns the port.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function startMcpClientServer(port: number): Promise<void> {
  const baseUrl = `http://localhost:${port}`;

  // Tool metadata is fetched on demand, not at boot: this process may start
  // while the port holder is mid-restart, and it must stay a client rather
  // than fail (a client that can't start used to become a second server).
  // adr: adr/single-server-ownership.md
  async function fetchTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${baseUrl}/api/mcp-tools`);
        if (res.ok) return ((await res.json()) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }).tools;
        if (attempt >= 10) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (attempt >= 10) throw new Error(`Failed to fetch tools from ${baseUrl}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const server = new Server(
    { name: 'openwriter-client', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await fetchTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const callRes = await fetch(`${baseUrl}/api/mcp-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: request.params.name, arguments: request.params.arguments }),
      });
      if (!callRes.ok) {
        const text = await callRes.text();
        return { content: [{ type: 'text' as const, text: `Server error (${callRes.status}): ${text}` }] };
      }
      return await callRes.json();
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Connection error: ${err.message}` }] };
    }
  });

  console.error(`[MCP-Client] Proxying tools to ${baseUrl}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
