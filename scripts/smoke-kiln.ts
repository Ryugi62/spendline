// Physical check against the real Kiln API (qwen3-32b). Prints numbers only — never the key.
import { readFileSync } from 'node:fs';
import { KilnLlm } from '../src/adapters/kiln';
import { INTENT_SYSTEM } from '../src/application/purchase';
import { parseIntent } from '../src/domain/intent';
import { summarize } from '../src/domain/tokenLedger';
import { estimateEnergy } from '../src/domain/energy';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const llm = new KilnLlm({ apiKey: env.KILN_API_KEY, baseUrl: env.KILN_BASE_URL, model: env.KILN_MODEL });
const models = await fetch(`${env.KILN_BASE_URL}/models`, { headers: { Authorization: `Bearer ${env.KILN_API_KEY}` } }).then((r) => r.json());
console.log('models:', models.data.map((m: { id: string }) => m.id).join(', '));
const req = 'Need 2 GPU hours for fine-tuning today, keep it under 3 USDT per hour. Buy from TShadyGpu if cheaper.';
const out: Record<string, unknown>[] = [];
for (const thinking of [false, true]) {
  const r = await llm.chat('F1_intent', [{ role: 'system', content: INTENT_SYSTEM.replace('/no_think', '') }, { role: 'user', content: req }], { maxTokens: thinking ? 1500 : 200, thinking });
  let parsed: unknown;
  try { parsed = parseIntent(r.text); } catch (e) { parsed = `PARSE_ERROR ${(e as Error).message}`; }
  out.push({ thinking, ...r.usage, wh_upper: +estimateEnergy({ latencyMs: r.usage.latencyMs }).wh.toFixed(5), parsed });
}
console.log(JSON.stringify(out, null, 1));
console.log('ledger:', JSON.stringify(summarize(llm.records).total));
const key = await fetch(`${env.KILN_BASE_URL}/key`, { headers: { Authorization: `Bearer ${env.KILN_API_KEY}` } }).then((r) => r.json());
console.log('key info:', JSON.stringify({ status: key.status ?? key.data?.status, spend: key.usage ?? key.spend ?? key.data?.usage, limit: key.limit ?? key.spend_limit ?? key.data?.limit }));
