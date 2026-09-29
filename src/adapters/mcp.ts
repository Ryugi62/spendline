// AC-43 — the MCP wire: the official SDK's low-level Server, tools listed with their JSON schemas, results as JSON text.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpTool } from '../application/mcp';

export function createMcpServer(tools: McpTool[], info: { name: string; version: string }): Server {
  const server = new Server(info, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: 'object'; [k: string]: unknown } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return { content: [{ type: 'text' as const, text: `unknown tool ${req.params.name}` }], isError: true };
    try {
      const r = await tool.run((req.params.arguments ?? {}) as Record<string, unknown>, (req.params._meta ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  });
  return server;
}
