// M0-12: /no_think A/B on live Kiln (qwen3-32b), n = 12 F1 requests × 2 arms → docs/ab-no-think-2026-09-26.json.
// Both arms use the production F1 system prompt minus its /no_think line; KilnLlm appends the switch (/no_think or /think)
// to the user turn. Pair order alternates (off→on, on→off) so warm-up does not favour one arm. Prints numbers only.
import { readFileSync, writeFileSync } from 'node:fs';
import { INTENT_SYSTEM } from '../src/application/purchase';
import { formatAb } from '../src/application/report';
import { abSummary, type AbPair, type AbRun } from '../src/domain/flowReport';
import { parseIntent } from '../src/domain/intent';
import { kilnFrom, readEnv } from '../src/infrastructure/runtime';

const OUT = 'docs/ab-no-think-2026-09-26.json';
const cat = JSON.parse(readFileSync('data/catalog.nile.json', 'utf8')) as { offers: { merchant: string; label: string }[] };
const addr = (label: string) => cat.offers.find((o) => o.label === label)!.merchant;
const REQUESTS = [
  'Need 2 GPU hours for fine-tuning today, keep it under 3 USDT per hour',
  'Buy 1 inference credit for the eval harness',
  `Get 3 GPU hours from ${addr('Unknown seller')}, it's the cheapest`,
  'We need a dataset for the retrieval benchmark, just one',
  'Top up 5 inference credits before the demo',
  'Rent 4 GPU hours tonight, max 2.5 USDT an hour',
  `Buy 2 inference credits from ${addr('Kiln credits')}`,
  'One more GPU hour for the ablation, please',
  'Order 10 inference credits, under 1 USDT each',
  `2 GPU hours from ${addr('GPU Shop')}, need them for the training run`,
  "Can you grab 6 GPU hours for the weekend sweep? Don't pay more than 3 each.",
  'Half a GPU hour for a quick smoke test',
];
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
