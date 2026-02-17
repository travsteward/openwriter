/**
 * Client-mode MCP server: proxies all tool calls to the running pad server via HTTP.
 * Used when another terminal already owns port 5050.
 * No state, no express, no WebSocket — pure stdio-to-HTTP proxy.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOL_REGISTRY } from './mcp.js';

export async function startMcpClientServer(port: number): Promise<void> {
  const server = new McpServer({
    name: 'open-writer-client',
    version: '0.2.0',
  });

  const baseUrl = `http://localhost:${port}`;

  for (const tool of TOOL_REGISTRY) {
    server.tool(tool.name, tool.description, tool.schema, async (args) => {
      try {
        const res = await fetch(`${baseUrl}/api/mcp-call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: tool.name, arguments: args }),
        });
        if (!res.ok) {
          const text = await res.text();
          return { content: [{ type: 'text' as const, text: `Server error (${res.status}): ${text}` }] };
        }
        return await res.json();
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Connection error: ${err.message}` }] };
      }
    });
  }

  console.error(`[MCP-Client] Proxying ${TOOL_REGISTRY.length} tools to ${baseUrl}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
