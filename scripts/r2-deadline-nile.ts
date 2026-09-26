// R2 physical run on TRON Nile (pre-hackathon, disclosed): the line EXPIRES.
// Same vault as v0.1 → owner re-grants m2 with a deadline ~150 s out → agent pays inside it → waits past the deadline →
// the SAME request is stopped on-chain as DEADLINE_PASSED. F1 (intent) runs live on Kiln qwen3-32b.
// The receipt chain continues from the v0.1 receipts, so one file (docs/receipts-nile.jsonl) holds the whole history.
// Prints tx hashes and numbers only. Keys stay in .env. Mirrors tests/deadline-r2.test.ts.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { KilnLlm } from '../src/adapters/kiln';
import { FakeLlm, MemoryCatalog, MemoryReceiptStore } from '../src/adapters/memory';
import { TronChain } from '../src/adapters/tron';
import { purchase } from '../src/application/purchase';
import type { LlmPort } from '../src/application/ports';
import { usdt } from '../src/domain/money';
import type { Receipt } from '../src/domain/receipt';
// @ts-expect-error plain ESM
import { compile } from './compile-contract.mjs';

const WINDOW_S = Number(process.env.R2_WINDOW_S ?? 150);
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const { abi } = compile();
const vault = env.VAULT_ADDRESS;
const chain = new TronChain({ fullHost: env.TRON_FULLHOST, agentKey: env.AGENT_PRIVATE_KEY, ownerKey: env.OWNER_PRIVATE_KEY, vault, abi });
const log: Record<string, unknown> = { vault, windowS: WINDOW_S, startedAt: new Date().toISOString() };

// continue the v0.1 receipt chain
const prior = JSON.parse(readFileSync('docs/nile-smoke-2026-09-24.json', 'utf8')).receipts as Receipt[];
const store = new MemoryReceiptStore();
for (const r of prior) await store.append(r);

// F1 on Kiln, live; if Kiln is down the run still measures the chain, and the log says so
const kiln = new KilnLlm({ apiKey: env.KILN_API_KEY, baseUrl: env.KILN_BASE_URL, model: env.KILN_MODEL });
let llm: LlmPort = kiln;
try {
  await kiln.chat('F1_intent', [{ role: 'user', content: 'Reply with {"ok":true}' }], { maxTokens: 20, thinking: false });
  log.llm = 'kiln qwen3-32b (live)';
} catch (e) {
  llm = new FakeLlm(['{"item":"gpu-hours","quantity":2}', '{"item":"gpu-hours","quantity":2}']);
  log.llm = `fake — Kiln unavailable: ${(e as Error).message.slice(0, 120)}`;
}
kiln.records.length = 0; // the probe call is not part of any purchase

const offers = [
  { merchant: env.MERCHANT_GPU_ADDRESS, item: 'gpu-hours', unitPrice: usdt(2.4), fee: usdt(0.2), label: 'GPU Shop' },
  { merchant: env.MERCHANT_SHADY_ADDRESS, item: 'gpu-hours', unitPrice: usdt(0.9), fee: 0, label: 'Unknown seller' },
];
const deps = { llm, chain, catalog: new MemoryCatalog(offers), store, hash: sha };

const t0 = await chain.now();
const m2 = { id: '0x' + sha('mandate-r2-deadline-' + t0), budget: usdt(9.9), perTxCap: usdt(8), deadline: t0 + WINDOW_S, merchants: [env.MERCHANT_GPU_ADDRESS, env.MERCHANT_KILN_ADDRESS], paused: false };
log.grant = { tx: await chain.grant(m2), mandateId: m2.id, deadline: m2.deadline, chainNowAtGrant: t0 };
for (let i = 0; i < 20 && (await chain.mandate()).id.toLowerCase() !== m2.id; i++) await sleep(3000);

const REQUEST = 'Need 2 GPU hours for the fine-tune before the window closes';
const runs: Record<string, unknown>[] = [];
const inside = await purchase(deps, REQUEST);
runs.push({ label: 'inside the window', seq: inside.receipt.seq, at: inside.request.at, preview: inside.preview, outcome: inside.outcome, flows: inside.receipt.flows });

let now = await chain.now();
while (now <= m2.deadline) {
  await sleep(Math.min(15_000, (m2.deadline - now + 4) * 1000));
  now = await chain.now();
}
log.chainNowAfterWait = now;
const late = await purchase(deps, REQUEST);
runs.push({ label: 'same request after the deadline', seq: late.receipt.seq, at: late.request.at, preview: late.preview, outcome: late.outcome, flows: late.receipt.flows });
log.runs = runs;
log.finishedAt = new Date().toISOString();

const all = await store.all();
writeFileSync('docs/receipts-nile.jsonl', all.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync('docs/nile-r2-deadline-2026-09-26.json', JSON.stringify(log, null, 1));
console.log(JSON.stringify(log, null, 1));
