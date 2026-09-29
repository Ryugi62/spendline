import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// AC-43 demo mode: `npm run mcp -- --demo` — no key, no chain, an in-memory vault on the live line's rules, so anyone can try the
// tools from their own MCP host in a minute. Same tools, same rule (evaluate), same receipts and audit; nothing is sent anywhere.
const text = (r: unknown) => (r as { content: { text: string }[] }).content.map((c) => c.text).join('');

describe('MCP demo mode (keyless, in memory)', () => {
  it('over stdio: the line, a paid call, a stop for the unlisted seller, and the audit of that stop', async () => {
    const client = new Client({ name: 'demo-test', version: '0' });
    await client.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/infrastructure/mcp-server.ts', '--demo'], env: { PATH: process.env.PATH ?? '' }, stderr: 'ignore' }));
    const line = JSON.parse(text(await client.callTool({ name: 'spendline_line', arguments: {} })));
    expect(line).toMatchObject({ budget_usdt: '9.90', per_payment_cap_usdt: '8.00', stop: false, demo: true });
    const paid = JSON.parse(text(await client.callTool({ name: 'spendline_pay', arguments: { to: 'GPU Shop', amount_usdt: 2.4, fee_usdt: 0.2, why: '1 GPU hour' } })));
    expect(paid).toMatchObject({ ok: true, receipt_seq: 1 });
    const stop = JSON.parse(text(await client.callTool({ name: 'spendline_pay', arguments: { to: 'Unknown seller', amount_usdt: 0.9, why: 'cheaper' } })));
    expect(stop).toMatchObject({ ok: false, reason: 'MERCHANT_NOT_ALLOWED', receipt_seq: 2 });
    expect(JSON.parse(text(await client.callTool({ name: 'spendline_check', arguments: { seq: 2 } })))).toMatchObject({ verdict: 'STOPPED', problems: 0 });
    await client.close();
  }, 30_000);
});
