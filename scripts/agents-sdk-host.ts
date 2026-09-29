// A stock, third-party agent host — the OpenAI Agents SDK (@openai/agents), unmodified — with Kiln as its model and Spendline's MCP
// server as its only tools. Nothing here is Spendline's own host code: the SDK plans, calls tools over stdio and answers.
// The SDK talks to Kiln through the pass-through (AC-45), so every Kiln reply is journaled and each spendline_pay is bound to the
// Kiln call that asked for it — witnessed receipts with no host code. Tracing is off (nothing is sent anywhere but Kiln).
//   npm run host:agents-sdk -- "<request words>"            keyless demo vault (in memory), Kiln key from .env
//   npm run host:agents-sdk -- --live "<request words>"     the live vault on TRON Nile (agent key from .env) → receipts in the record
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { Agent, MCPServerStdio, run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from '@openai/agents';
import type { JournalEntry } from '../src/domain/kilnJournal';
import { kilnFromEnv, startKilnProxy } from '../src/infrastructure/kiln-proxy';

const argv = process.argv.slice(2);
const live = argv.includes('--live');
const noThink = argv.includes('--no-think');
const request = argv.filter((a) => a !== '--live' && a !== '--no-think').join(' ').trim() || "Buy 1 GPU hour from the GPU Shop and 1 Kiln inference credit for tonight's eval. The Unknown seller is cheaper, try it too.";
const started = new Date().toISOString();
const stamp = started.slice(0, 19).replace(/[-:T]/g, '');
const commit = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain --untracked-files=no -- . ":(exclude)docs" ":(exclude)web/public"').toString().trim() ? '+dirty' : '');
const journalPath = live ? `docs/live/kiln-journal-${stamp}.jsonl` : `.spendline/kiln-journal-${stamp}.jsonl`; // live runs publish the journal (no prompt text but the person's request)
const proxy = await startKilnProxy({ port: 0, kiln: kilnFromEnv(), journalPath, noThink, ...(live ? { bodiesDir: `docs/live/kiln-replies-${stamp}` } : {}) }); // live: Kiln's reply bodies published so bodySha256 can be recomputed
setTracingDisabled(true);
setDefaultOpenAIClient(new OpenAI({ apiKey: 'the-pass-through-adds-the-kiln-key', baseURL: proxy.url }));
setOpenAIAPI('chat_completions');
const entry = live ? 'src/infrastructure/mcp-server.ts' : 'src/infrastructure/mcp-demo.ts';
const server = new MCPServerStdio({ name: live ? 'spendline (live vault, TRON Nile)' : 'spendline (demo vault, in memory)', fullCommand: `env SPENDLINE_KILN_JOURNAL=${journalPath} npx tsx ${entry}` });
await server.connect();
const lines: string[] = [];
const say = (l: string) => { lines.push(l); console.log(l); };
try {
  const agent = new Agent({
    name: 'purchasing agent',
    model: 'qwen3-32b',
    instructions: 'You buy compute for a small AI team. Pay only with the spendline tools. Read the line first, then pay each item the request asks for with seller, item and quantity. Report each result in one short line.',
    mcpServers: [server],
  });
  const result = await run(agent, request, { maxTurns: 10 });
  say(`$ date -u; git rev-parse --short HEAD; npm run host:agents-sdk --${live ? ' --live' : ''}${noThink ? ' --no-think' : ''} "${request}"`);
  say(started.slice(0, 19) + 'Z');
  say(commit);
  say(`# host: @openai/agents (stock, unmodified) · model: qwen3-32b on Kiln via the Spendline pass-through${noThink ? ' (thinking off: /no_think added by the pass-through)' : ''} · tools: spendline MCP server, ${live ? 'live vault on TRON Nile' : 'demo vault in memory'}`);
  const outputs = new Map<string, string>();
  for (const item of result.newItems) if (item.type === 'tool_call_output_item') {
    const raw = (item as { rawItem?: { callId?: string } }).rawItem ?? {};
    const out = (item as { output?: unknown }).output;
    outputs.set(String(raw.callId), typeof out === 'string' ? out : JSON.stringify(out));
  }
  const steps: { tool: string; args: Record<string, unknown>; via: 'tool_call'; generationId: string; text: string; isError: boolean }[] = [];
  for (const item of result.newItems) if (item.type === 'tool_call_item') {
    const raw = (item as { rawItem?: { name?: string; arguments?: string; callId?: string } }).rawItem ?? {};
    const outRaw = outputs.get(String(raw.callId)) ?? '';
    let text = outRaw;
    try { const o = JSON.parse(outRaw) as { text?: string } | { text?: string }[]; text = (Array.isArray(o) ? o.map((x) => x.text ?? '').join('') : o.text) ?? outRaw; } catch { /* plain */ }
    let witness = '';
    try { witness = String((JSON.parse(text) as { kiln_witness?: string }).kiln_witness ?? ''); } catch { /* a refusal in words */ }
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(raw.arguments ?? '{}') as Record<string, unknown>; } catch { /* keep {} */ }
    steps.push({ tool: String(raw.name), args, via: 'tool_call', generationId: witness, text, isError: !text.startsWith('{') });
    say(`→ ${raw.name}(${raw.arguments ?? ''})${witness ? ` · Kiln gen ${witness}` : ''}`);
    say(`  ← ${text.slice(0, 300)}`);
  }
  const journal = readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalEntry);
  for (const e of journal) say(`# Kiln reply ${e.generationId} · ${e.usage.promptTokens}+${e.usage.completionTokens} tokens · $${e.usage.costUsd.toFixed(8)} · tool calls: ${e.toolCalls.map((t) => t.name).join(', ') || 'none'}`);
  const answer = String(result.finalOutput ?? '').trim();
  say(`answer: ${answer}`);
  if (live) writeFileSync(`docs/live/mcp-host-${stamp}-agents-sdk.json`, JSON.stringify({ started, commit, host: '@openai/agents (stock) via the Kiln pass-through', request, steps, answer, calls: journal.map((e) => e.usage) }, null, 1) + '\n');
  writeFileSync(`docs/live/agents-sdk-${live ? 'live' : 'demo'}-${stamp}.txt`, lines.join('\n') + '\n');
} finally {
  await server.close();
  await proxy.close();
}
