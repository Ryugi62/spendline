// M0-12: /no_think A/B on live Kiln (qwen3-32b), n = 12 F1 requests × 2 arms → docs/ab-no-think-2026-09-26.json.
// Both arms use the production F1 system prompt minus its /no_think line; KilnLlm appends the switch (/no_think or /think)
// to the user turn. Pair order alternates (off→on, on→off) so warm-up does not favour one arm. Prints numbers only.
import { writeFileSync } from 'node:fs';
import { INTENT_SYSTEM } from '../src/application/purchase';
import { formatAb } from '../src/application/report';
import { abSummary, type AbPair, type AbRun } from '../src/domain/flowReport';
import { parseIntent } from '../src/domain/intent';
import { kilnFrom, readEnv } from '../src/infrastructure/runtime';
import { F1_REQUESTS } from './f1-requests';

const OUT = 'docs/ab-no-think-2026-09-26.json';
const REQUESTS = F1_REQUESTS;
const system = INTENT_SYSTEM.split('\n').filter((l) => l.trim() !== '/no_think').join('\n');
const llm = kilnFrom(readEnv());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(request: string, thinking: boolean): Promise<AbRun> {
  const r = await llm.chat('F1_intent', [{ role: 'system', content: system }, { role: 'user', content: request }], { maxTokens: thinking ? 2000 : 200, thinking });
  try {
    return { usage: r.usage, intent: parseIntent(r.text) };
  } catch (e) {
    return { usage: r.usage, intent: null, error: (e as Error).message };
  }
}

const pairs: AbPair[] = [];
for (const [i, request] of REQUESTS.entries()) {
  const first = i % 2 === 0 ? false : true;
  const a = await run(request, first);
  await sleep(1000);
  const b = await run(request, !first);
  await sleep(1000);
  const [off, on] = first ? [b, a] : [a, b];
  pairs.push({ request, off, on });
  console.log(`#${i + 1} off ${off.usage.completionTokens} tok ${off.usage.latencyMs} ms ${off.intent ? 'ok' : 'PARSE ' + off.error} · on ${on.usage.completionTokens} tok ${on.usage.latencyMs} ms ${on.intent ? 'ok' : 'PARSE ' + on.error}`);
}
const date = '2026-09-26';
writeFileSync(OUT, JSON.stringify({ date, model: 'qwen3-32b', note: 'system = production F1 prompt without its /no_think line; the switch is appended to the user turn by KilnLlm; order alternates per pair', pairs, summary: abSummary(pairs) }, null, 1) + '\n');
console.log(formatAb(abSummary(pairs), { file: OUT, date }));
