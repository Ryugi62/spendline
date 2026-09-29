// AC-43 composition root — Spendline as an MCP server over stdio, for any MCP host (Claude Desktop, Cursor, an agent SDK, …):
//   npm run -s mcp [-- --receipts docs/receipts-nile-live.jsonl] [--vault T…]
// Host config: { "command": "npm", "args": ["run", "-s", "mcp"], "cwd": "<this repo>" }. The agent key and the vault come from .env,
// exactly like `npm run agent`; the host never sees a key. stdout is the protocol channel, so every log line goes to stderr.
console.log = console.error;
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JsonCatalog, JsonlReceiptStore } from '../adapters/files';
import { createMcpServer } from '../adapters/mcp';
import { TronChain } from '../adapters/tron';
import { TronGridEvents } from '../adapters/trongrid';
import { mcpTools } from '../application/mcp';
import { CATALOG, flag, LIVE_RECEIPTS, need, readEnv, sha256, vaultOf } from './runtime';
// @ts-expect-error plain ESM script without types
import { compile } from '../../scripts/compile-contract.mjs';

async function main(args: string[]) {
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
    vault,
  });
  await createMcpServer(tools, { name: 'spendline', version: '1.1.0' }).connect(new StdioServerTransport());
  console.error(`spendline MCP server on stdio · vault ${vault} · tools: ${tools.map((t) => t.name).join(', ')}`);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
