// AC-43 composition root — Spendline as an MCP server over stdio, for any MCP host (Claude Desktop, Cursor, an agent SDK, …):
//   npm run -s mcp [-- --receipts docs/receipts-nile-live.jsonl] [--vault T…]
//   npm run -s mcp -- --demo          no key, no chain: an in-memory vault on the live line's rules (try it from any MCP host)
// Host config: { "command": "npm", "args": ["run", "-s", "mcp"], "cwd": "<this repo>" }. The agent key and the vault come from .env,
// exactly like `npm run agent`; the host never sees a key. stdout is the protocol channel, so every log line goes to stderr.
console.log = console.error;
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MemoryChain, MemoryReceiptStore } from '../adapters/memory';
import type { Mandate } from '../domain/mandate';
import { JsonCatalog, JsonlReceiptStore } from '../adapters/files';
import { createMcpServer } from '../adapters/mcp';
import { TronChain } from '../adapters/tron';
import { TronGridEvents } from '../adapters/trongrid';
import { mcpTools } from '../application/mcp';
import { CATALOG, flag, LIVE_RECEIPTS, need, readEnv, sha256, vaultOf } from './runtime';
// @ts-expect-error plain ESM script without types
import { compile } from '../../scripts/compile-contract.mjs';

/** `--demo`: no key, no chain — an in-memory vault with the live line's budget, cap and sellers (docs/live/mandate-4.json), a 7-day window. */
async function demoTools() {
  const m = JSON.parse(readFileSync('docs/live/mandate-4.json', 'utf8')) as Omit<Mandate, 'id'>;
  const now = Math.floor(Date.now() / 1000);
  const line: Mandate = { ...m, id: 'demo', deadline: now + 7 * 86400, paused: false };
  const chain = new MemoryChain(line, now);
  await chain.grant(line);
  return mcpTools({ chain, store: new MemoryReceiptStore(), hash: sha256, events: { events: async () => chain.events }, labels: JsonCatalog.fromFile(CATALOG).labels(), offers: JsonCatalog.fromFile(CATALOG).all(), vault: 'demo (in memory)', demo: true });
}

async function main(args: string[]) {
  if (args.includes('--demo') || process.env.SPENDLINE_DEMO === '1') {
    const tools = await demoTools();
    await createMcpServer(tools, { name: 'spendline-demo', version: '1.1.0' }).connect(new StdioServerTransport());
    console.error('spendline MCP server on stdio · DEMO: in-memory vault, no key, nothing sent to TRON');
    return;
  }
  const env = readEnv();
  need(env, 'AGENT_PRIVATE_KEY', 'TRON_FULLHOST');
  const vault = vaultOf(env, flag(args, '--vault'));
  if (!vault) throw new Error('no vault: pass --vault T…');
  const tools = mcpTools({
    chain: new TronChain({ fullHost: env.TRON_FULLHOST, agentKey: env.AGENT_PRIVATE_KEY, vault, abi: compile().abi }),
    store: new JsonlReceiptStore(flag(args, '--receipts') ?? LIVE_RECEIPTS),
    hash: sha256,
    events: new TronGridEvents(),
    labels: JsonCatalog.fromFile(CATALOG).labels(),
    offers: JsonCatalog.fromFile(CATALOG).all(),
    vault,
  });
  await createMcpServer(tools, { name: 'spendline', version: '1.1.0' }).connect(new StdioServerTransport());
  console.error(`spendline MCP server on stdio · vault ${vault} · tools: ${tools.map((t) => t.name).join(', ')}`);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
