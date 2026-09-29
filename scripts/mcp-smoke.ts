// AC-43 smoke: start `npm run mcp` over stdio with the official SDK client, list the tools, read the line, check one receipt. No payment.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'spendline-smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/infrastructure/mcp-server.ts'], stderr: 'inherit' }));
const text = (r: unknown) => (r as { content: { text: string }[] }).content.map((c) => c.text).join('');
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('spendline_line →', text(await client.callTool({ name: 'spendline_line', arguments: {} })));
console.log('spendline_check #14 →', text(await client.callTool({ name: 'spendline_check', arguments: { seq: Number(process.argv[2] ?? 14) } })));
await client.close();
