// AC-34: F1 as a Kiln tool call vs JSON in the text reply, live qwen3-32b, the same 12 requests × 2 arms → docs/ab-tool-call-<date>.json.
// Both arms /no_think (production). Pair order alternates so warm-up does not favour one arm. Prints numbers only (no key).
import { writeFileSync } from 'node:fs';
import { f1Arguments, INTENT_SYSTEM, PROPOSE_PURCHASE, TOOL_SYSTEM } from '../src/application/purchase';
import { formatToolAb } from '../src/application/report';
import { abSummary, toolCallDecision, type AbPair, type AbRun } from '../src/domain/flowReport';
import { parseIntent } from '../src/domain/intent';
import { kilnFrom, readEnv } from '../src/infrastructure/runtime';
import { F1_REQUESTS } from './f1-requests';

const date = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // KST
const RUN = process.argv[2] ?? 'run2';
const OUT = `docs/ab-tool-call-${date}-${RUN}.json`;
const llm = kilnFrom(readEnv());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(request: string, tool: boolean): Promise<AbRun & { via: string }> {
  const r = await llm.chat('F1_intent', [{ role: 'system', content: tool ? TOOL_SYSTEM : INTENT_SYSTEM }, { role: 'user', content: request }], tool ? { maxTokens: 200, thinking: false, tools: [PROPOSE_PURCHASE] } : { maxTokens: 200, thinking: false });
  const { args, via } = tool ? f1Arguments(r) : { args: r.text, via: 'text' as const };
  try {
    return { usage: { ...r.usage, via }, intent: parseIntent(args), via };
  } catch (e) {
    return { usage: { ...r.usage, via }, intent: null, error: (e as Error).message, via };
  }
}

const pairs: AbPair[] = [];
for (const [i, request] of F1_REQUESTS.entries()) {
  const toolFirst = i % 2 === 0;
  const a = await run(request, toolFirst);
  await sleep(1000);
  const b = await run(request, !toolFirst);
  await sleep(1000);
  const [tool, text] = toolFirst ? [a, b] : [b, a];
  pairs.push({ request, off: tool, on: text });
  console.log(`#${i + 1} tool(${tool.via}) ${tool.usage.promptTokens}+${tool.usage.completionTokens} tok ${tool.usage.latencyMs} ms ${tool.intent ? 'ok' : 'PARSE ' + tool.error} · text ${text.usage.promptTokens}+${text.usage.completionTokens} tok ${text.usage.latencyMs} ms ${text.intent ? 'ok' : 'PARSE ' + text.error}`);
}
const summary = abSummary(pairs);
writeFileSync(OUT, JSON.stringify({ date, model: 'qwen3-32b', arms: { off: 'tool call propose_purchase (TOOL_SYSTEM)', on: 'JSON in the text reply (INTENT_SYSTEM)' }, rule: 'SPEC AC-34', decision: toolCallDecision(summary), pairs, summary }, null, 1) + '\n');
console.log(formatToolAb(summary, { file: OUT, date }));
