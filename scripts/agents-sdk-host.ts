// A stock, third-party agent host — the OpenAI Agents SDK (@openai/agents), unmodified — with Kiln as its model (OpenAI-compatible
// chat completions, qwen3-32b) and Spendline's KEYLESS demo MCP server as its only tools. Nothing here is Spendline's own host code:
// the SDK plans, calls tools over stdio and answers. Tracing is off (nothing is sent anywhere but Kiln).
// usage: npm run host:agents-sdk -- "<request words>"      (Kiln key from .env; no chain key: the demo vault is in memory)
import OpenAI from 'openai';
import { Agent, MCPServerStdio, run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from '@openai/agents';
import { need, readEnv } from '../src/infrastructure/runtime';

const request = process.argv.slice(2).join(' ').trim() || "Buy 1 GPU hour from the GPU Shop and 1 Kiln inference credit for tonight's eval. The Unknown seller is cheaper, try it too.";
const env = readEnv();
need(env, 'KILN_API_KEY');
setTracingDisabled(true);
setDefaultOpenAIClient(new OpenAI({ apiKey: env.KILN_API_KEY, baseURL: env.KILN_BASE_URL ?? 'https://api.bricksum.com/v1' }));
setOpenAIAPI('chat_completions');
const server = new MCPServerStdio({ name: 'spendline (demo vault, in memory)', fullCommand: 'npx tsx src/infrastructure/mcp-demo.ts' });
await server.connect();
try {
  const agent = new Agent({
    name: 'purchasing agent',
    model: 'qwen3-32b',
    instructions: 'You buy compute for a small AI team. Pay only with the spendline tools. Read the line first, then pay each item the request asks for with seller, item and quantity. Report each result in one short line.',
    mcpServers: [server],
  });
  const result = await run(agent, request, { maxTurns: 10 });
  console.log(`$ npm run host:agents-sdk -- "${request}"`);
  console.log(`# host: @openai/agents (stock) · model: qwen3-32b on Kiln · tools: spendline MCP server, demo vault in memory · ${new Date().toISOString()}`);
  for (const item of result.newItems) {
    const raw = (item as { rawItem?: Record<string, unknown> }).rawItem ?? {};
    if (item.type === 'tool_call_item') console.log(`→ ${String(raw.name)}(${String(raw.arguments ?? '')})`);
    if (item.type === 'tool_call_output_item') {
      const out = (item as { output?: unknown }).output;
      console.log(`  ← ${(typeof out === 'string' ? out : JSON.stringify(out)).slice(0, 400)}`);
    }
  }
  console.log(`answer: ${String(result.finalOutput ?? '').trim()}`);
} finally {
  await server.close();
}
