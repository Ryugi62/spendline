// Physical verification on TRON Nile (template smoke, pre-hackathon): deploy vault → grant → fund → paid ×1 → stopped ×2 → STOP → stopped PAUSED → audit.
// Prints tx hashes (public) and numbers. Keys stay in .env.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { TronWeb } from 'tronweb';
import { TronChain } from '../src/adapters/tron';
import { MemoryCatalog, MemoryReceiptStore, FakeLlm } from '../src/adapters/memory';
import { purchase } from '../src/application/purchase';
import { audit } from '../src/domain/audit';
import { usdt } from '../src/domain/money';
// @ts-expect-error plain ESM
import { compile } from './compile-contract.mjs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const owner = new TronWeb({ fullHost: env.TRON_FULLHOST, privateKey: env.OWNER_PRIVATE_KEY });
const { abi, bytecode } = compile();
const log: Record<string, unknown> = {};

// agent needs TRX for energy
const agentTrx = (await owner.trx.getBalance(env.AGENT_ADDRESS)) / 1e6;
if (agentTrx < 100) log.fundAgentTrx = (await owner.trx.sendTransaction(env.AGENT_ADDRESS, 200_000_000)).txid;

let vault = env.VAULT_ADDRESS;
if (!vault) {
  const c = await owner.contract().new({ abi, bytecode, feeLimit: 1_500_000_000, callValue: 0, parameters: [env.USDT_NILE, env.AGENT_ADDRESS, env.FEE_ADDRESS] });
  vault = TronWeb.address.fromHex(c.address as string);
  appendFileSync('.env', `VAULT_ADDRESS=${vault}\n`);
  log.deployed = vault;
}
const v = await owner.contract(abi, vault);
const nowTs = Number(await v.nowTs().call());
log.nowTs = nowTs;
log.nowTsLooksLikeSeconds = nowTs > 1.7e9 && nowTs < 2.2e9;
const mandateId = '0x' + sha('mandate-template-smoke-' + nowTs);
log.grant = await v.grant(mandateId, usdt(9.9), usdt(8), nowTs + 3600, [env.MERCHANT_GPU_ADDRESS, env.MERCHANT_KILN_ADDRESS]).send({ feeLimit: 200_000_000 });
const usdtC = await owner.contract().at(env.USDT_NILE);
log.fundVault = await usdtC.transfer(vault, usdt(20)).send({ feeLimit: 100_000_000 });
await new Promise((r) => setTimeout(r, 6000));

const chain = new TronChain({ fullHost: env.TRON_FULLHOST, agentKey: env.AGENT_PRIVATE_KEY, ownerKey: env.OWNER_PRIVATE_KEY, vault, abi });
const offers = [
  { merchant: env.MERCHANT_GPU_ADDRESS, item: 'gpu-hours', unitPrice: usdt(2.4), fee: usdt(0.2), label: 'GPU Shop' },
  { merchant: env.MERCHANT_SHADY_ADDRESS, item: 'gpu-hours', unitPrice: usdt(0.9), fee: 0, label: 'Unknown seller' },
];
const store = new MemoryReceiptStore();
const llm = new FakeLlm([
  '{"item":"gpu-hours","quantity":2}',
  `{"item":"gpu-hours","quantity":2,"merchantHint":"${env.MERCHANT_SHADY_ADDRESS}"}`,
  '{"item":"gpu-hours","quantity":2}',
  '{"item":"gpu-hours","quantity":1}',
]);
const deps = { llm, chain, catalog: new MemoryCatalog(offers), store, hash: sha };
const runs = [];
for (const text of ['2 GPU hours', '2 GPU hours from the cheap unknown seller', '2 more GPU hours']) {
  const r = await purchase(deps, text);
  runs.push({ text, preview: r.preview, outcome: r.outcome, receipt: r.receipt.hash.slice(0, 16) });
}
log.pause = await chain.pause();
await new Promise((r) => setTimeout(r, 4000));
const r4 = await purchase(deps, '1 GPU hour after STOP');
runs.push({ text: '1 GPU hour after STOP', preview: r4.preview, outcome: r4.outcome, receipt: r4.receipt.hash.slice(0, 16) });
log.runs = runs;

await new Promise((r) => setTimeout(r, 8000));
const events = await chain.events();
const m = await chain.mandate();
const res = audit({ mandates: [{ ...m, paused: false }], receipts: await store.all(), events, hash: sha });
log.audit = { chain: res.chain, verdicts: res.verdicts.map((x) => `${x.seq}:${x.verdict}${x.reason ? '(' + x.reason + ')' : ''}`), totalPaid: res.totalPaid };
writeFileSync('docs/nile-smoke-2026-09-24.json', JSON.stringify({ vault, ...log, receipts: await store.all() }, null, 1));
console.log(JSON.stringify(log, null, 1));
