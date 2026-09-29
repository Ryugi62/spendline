// AC-44 composition root — an MCP host with Qwen3-32B on Kiln as its planner, talking to `npm run mcp` over stdio (the same way
// Claude Desktop or any MCP host would):   npm run mcp:host -- "<request words>" [--out docs/live/mcp-host-….json]
// Prints a transcript; saves the run (request, each tool call with its Kiln generation id and result, the answer, every Kiln call).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runHost, type McpClientPort } from '../application/mcpHost';
import { flag, kilnFrom, positionals, readEnv } from './runtime';

async function main(args: string[]): Promise<number> {
  const [request] = positionals(args);
  if (!request?.trim()) return console.error('usage: npm run mcp:host -- "<request words>"'), 2;
  const env = readEnv();
  const llm = kilnFrom(env);
  const transport = new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/infrastructure/mcp-server.ts'], stderr: 'inherit' });
  const client = new Client({ name: 'spendline-kiln-host', version: '1.1.0' });
  await client.connect(transport);
  const mcp: McpClientPort = {
    list: async () => (await client.listTools()).tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> })),
    call: async (name, a) => {
      const r = (await client.callTool({ name, arguments: a })) as { content: { type: string; text?: string }[]; isError?: boolean };
      return { text: r.content.map((c) => c.text ?? '').join(''), isError: !!r.isError };
    },
  };
  const started = new Date().toISOString();
  const commit = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain --untracked-files=no -- . ":(exclude)docs" ":(exclude)web/public"').toString().trim() ? '+dirty' : '');
  const run = await runHost({ llm, mcp }, request);
  await client.close();
  const lines = [`$ date -u; git rev-parse --short HEAD; npm run mcp:host -- "${request}"`, started.slice(0, 19) + 'Z', commit];
  for (const s of run.steps) {
    const u = run.calls.find((c) => c.generationId === s.generationId)!;
    lines.push(`Kiln qwen3-32b → ${s.tool}(${JSON.stringify(s.args)}) · ${u.promptTokens}+${u.completionTokens} tokens · $${u.costUsd.toFixed(8)} · gen ${s.generationId} · via ${s.via.replace(/_/g, ' ')}`);
    lines.push(`  ← ${s.text}`);
  }
  const last = run.calls.at(-1)!;
  lines.push(`Kiln qwen3-32b → answer · ${last.promptTokens}+${last.completionTokens} tokens · gen ${last.generationId}`, `  "${run.answer}"`);
  console.log(lines.join('\n'));
  const out = flag(args, '--out') ?? `docs/live/mcp-host-${started.slice(0, 19).replace(/[-:T]/g, '')}.json`; // to the second: two runs in one minute once overwrote a log
  writeFileSync(out, JSON.stringify({ started, commit, ...run }, null, 1) + '\n');
  console.error(`→ ${out}`);
  return run.steps.some((s) => s.isError) ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  },
);
