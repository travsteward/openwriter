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

  // Fetch tool metadata from the primary server
  const res = await fetch(`${baseUrl}/api/mcp-tools`);
  if (!res.ok) throw new Error(`Failed to fetch tools from ${baseUrl}: ${res.status}`);
  const { tools } = await res.json() as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };

  const server = new Server(
    { name: 'openwriter-client', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

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

  console.error(`[MCP-Client] Proxying ${tools.length} tools to ${baseUrl}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
