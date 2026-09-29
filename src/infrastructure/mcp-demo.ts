// AC-43 demo entry: the MCP server on an in-memory vault, no key — for MCP clients that cannot pass a flag (e.g. the MCP Inspector CLI).
process.env.SPENDLINE_DEMO = '1';
await import('./mcp-server');
export {};
