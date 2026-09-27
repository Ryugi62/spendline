// M1 review (FuriosaAI view): the Wh estimate uses client wall time, which includes the network. Kiln returns
// `x-envoy-upstream-service-time`; this run sends the 12 F1 requests once each in production mode (tool call, /no_think)
// and records both times per call → docs/energy-server-time-<date>.json. Prints numbers only (no key).
import { writeFileSync } from 'node:fs';
import { f1Arguments, PROPOSE_PURCHASE, TOOL_SYSTEM } from '../src/application/purchase';
import { serverTimeEnergy } from '../src/domain/flowReport';
import { parseIntent } from '../src/domain/intent';
import type { UsageRecord } from '../src/domain/tokenLedger';
import { kilnFrom, readEnv } from '../src/infrastructure/runtime';
import { F1_REQUESTS } from './f1-requests';

const date = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // KST
const OUT = `docs/energy-server-time-${date}.json`;
const llm = kilnFrom(readEnv());
const calls: { request: string; usage: UsageRecord; parsed: boolean }[] = [];
for (const request of F1_REQUESTS) {
  const r = await llm.chat('F1_intent', [{ role: 'system', content: TOOL_SYSTEM }, { role: 'user', content: request }], { maxTokens: 200, thinking: false, tools: [PROPOSE_PURCHASE] });
  const { args, via } = f1Arguments(r);
  let parsed = true;
  try { parseIntent(args); } catch { parsed = false; }
  calls.push({ request, usage: { ...r.usage, via }, parsed });
  console.log(`wall ${r.usage.latencyMs} ms · server ${r.usage.serverMs ?? '-'} ms · ${via} · ${parsed ? 'ok' : 'PARSE'}`);
  await new Promise((res) => setTimeout(res, 1000));
}
const e = serverTimeEnergy(calls.map((c) => c.usage));
writeFileSync(OUT, JSON.stringify({ date, model: 'qwen3-32b', mode: 'F1 tool call, /no_think', header: 'x-envoy-upstream-service-time', calls, summary: e }, null, 1) + '\n');
console.log(JSON.stringify(e));
