// M0-13 live run on TRON Nile (pre-hackathon, disclosed) — replaces the 2026-09-24 template smoke, which used a scripted stand-in.
// Every model call is live Kiln (qwen3-32b); there is no stand-in, and a Kiln failure aborts the run.
// The person's steps go through the owner CLI (`npm run grant` / `npm run stop`), purchases through the agent CLI (`npm run agent`),
// F2 / F3 through the answers CLI — the same commands a user types. Deploys a v0.6 vault (refuses a reused receipt hash, AC-25).
// Writes: docs/receipts-nile-live.jsonl · docs/answers-nile-live.jsonl · docs/audit-nile-live-2026-09-26.txt · docs/nile-live-2026-09-26.json
//         docs/live/mandate-{1,2}.json (the CLI inputs, same format as the Grant screen's "Copy the mandate") · web/public/session.json
// Prints tx hashes and public numbers only. Keys stay in .env.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TronWeb } from 'tronweb';
import { TronChain } from '../src/adapters/tron';
import { TronGridEvents } from '../src/adapters/trongrid';
import { usdt } from '../src/domain/money';
import type { Receipt } from '../src/domain/receipt';
import { LIVE_ANSWERS, LIVE_RECEIPTS, readEnv } from '../src/infrastructure/runtime';
import { writeSessionFile } from '../src/infrastructure/session-file';
// @ts-expect-error plain ESM
import { compile } from './compile-contract.mjs';

const RUN_LOG = 'docs/nile-live-2026-09-26.json';
const AUDIT_TXT = 'docs/audit-nile-live-2026-09-26.txt';
const WINDOW_S = Number(process.env.LIVE_WINDOW_S ?? 180);
const env = readEnv();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log: Record<string, unknown> = { startedAt: new Date().toISOString(), model: env.KILN_MODEL || 'qwen3-32b', network: 'nile' };
const save = () => writeFileSync(RUN_LOG, JSON.stringify(log, null, 1) + '\n');

const RESUME = process.argv.includes('--continue');
if (existsSync(LIVE_RECEIPTS) && readFileSync(LIVE_RECEIPTS, 'utf8').trim() && !RESUME)
  throw new Error(`${LIVE_RECEIPTS} already has receipts — this run would append to another run's record (pass --continue on purpose)`);
// --continue: same run, same vault, same receipts file; steps already in the run log are not repeated (a crash mid-run must not fork the record)
if (RESUME && existsSync(RUN_LOG)) {
  const prev = JSON.parse(readFileSync(RUN_LOG, 'utf8')) as Record<string, unknown>;
  Object.assign(log, prev, { resumedAt: [...((prev.resumedAt as string[]) ?? []), new Date().toISOString()] });
}

/** Run one of the product CLIs as a separate process, exactly as a person would. Last stdout line is its --json output. */
function cli(file: string, args: string[]): Record<string, unknown> {
  const r = spawnSync('npx', ['tsx', file, ...args, '--json'], { encoding: 'utf8', timeout: 240_000 });
  if (r.status !== 0) throw new Error(`${file} ${args[0] ?? ''} failed (exit ${r.status}): ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1)!);
}

const { abi, bytecode } = compile();
const owner = new TronWeb({ fullHost: env.TRON_FULLHOST, privateKey: env.OWNER_PRIVATE_KEY });
const trx = async (a: string) => (await owner.trx.getBalance(a)) / 1e6;
async function confirmed(txid: string) {
  for (let i = 0; i < 40; i++) {
    const info = (await owner.trx.getTransactionInfo(txid)) as { blockTimeStamp?: number; receipt?: { result?: string } };
    if (info?.blockTimeStamp) {
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`tx ${txid}: ${info.receipt.result}`);
      return info;
    }
    await sleep(3000);
  }
  throw new Error(`tx ${txid} not confirmed in 120 s`);
}
log.balancesBefore ??= { ownerTrx: await trx(env.OWNER_ADDRESS), agentTrx: await trx(env.AGENT_ADDRESS) };

// 1. deploy the v0.6 vault (once) and fund it
let vault = env.VAULT_V2_ADDRESS;
if (!vault) {
  const tx = await owner.transactionBuilder.createSmartContract(
    { abi, bytecode, feeLimit: 1_500_000_000, callValue: 0, userFeePercentage: 100, parameters: [env.USDT_NILE, env.AGENT_ADDRESS, env.FEE_ADDRESS] } as never,
    owner.defaultAddress.hex as string,
  );
  const sent = await owner.trx.sendRawTransaction(await owner.trx.sign(tx));
  await confirmed(sent.txid ?? tx.txID);
  vault = TronWeb.address.fromHex((tx as { contract_address: string }).contract_address);
  appendFileSync('.env', `VAULT_V2_ADDRESS=${vault}\n`);
  log.deploy = { vault, tx: sent.txid ?? tx.txID, contract: 'SpendlineVault v0.6 (usedReceipt · DUPLICATE_RECEIPT = 7)' };
  save();
  const usdtC = await owner.contract().at(env.USDT_NILE);
  const fund = await usdtC.transfer(vault, usdt(20)).send({ feeLimit: 100_000_000 });
  await confirmed(fund);
  log.fundVault = { tx: fund, usdt: 20 };
}
log.vault = vault;
if ((await trx(env.AGENT_ADDRESS)) < 80) log.fundAgentTrx = (await owner.trx.sendTransaction(env.AGENT_ADDRESS, 100_000_000)).txid;
const chain = new TronChain({ fullHost: env.TRON_FULLHOST, agentKey: env.AGENT_PRIVATE_KEY, vault, abi });
const flags = ['--vault', vault];

// 2. the person grants line 1 with the owner CLI (input = the Grant screen's JSON)
mkdirSync('docs/live', { recursive: true });
const steps = ((log.steps as Record<string, unknown>[]) ?? []).filter((x) => x.label);
const done = (label: string) => steps.some((x) => x.label === label);
const draft = (deadline: number) => ({ budget: usdt(9.9), perTxCap: usdt(8), merchants: [env.MERCHANT_GPU_ADDRESS, env.MERCHANT_KILN_ADDRESS], deadline, paused: false });
if (!done('grant line 1 (owner CLI)')) writeFileSync('docs/live/mandate-1.json', JSON.stringify(draft((await chain.now()) + 3600), null, 1));
const step = (label: string, out: Record<string, unknown>, expected?: string) => {
  const o = out.outcome as { kind: string; reason?: string; txHash: string } | undefined;
  const got = o ? (o.kind === 'paid' ? 'PAID' : o.reason!) : String(out.kind);
  const r = out.receipt as Receipt | undefined;
  steps.push({ label, expected, got, ok: expected === undefined || expected === got, tx: o?.txHash ?? out.txHash, seq: r?.seq, receiptHash: r?.hash, flows: r?.flows, mandateId: (out.mandate as { id?: string })?.id });
  log.steps = steps;
  save();
  console.log(`${label}: ${got}${expected && expected !== got ? ` (expected ${expected})` : ''} · tx ${String(o?.txHash ?? out.txHash)}`);
  return out;
};
const once = (label: string, run: () => Record<string, unknown>, expected?: string) => (done(label) ? console.log(`${label}: done before (resumed)`) : step(label, run(), expected));
once('grant line 1 (owner CLI)', () => cli('src/infrastructure/owner-cli.ts', ['grant', 'docs/live/mandate-1.json', ...flags]));

// 3. purchases with the agent CLI — every F1 on live Kiln
const agent = (text: string) => cli('src/infrastructure/agent-cli.ts', [text, ...flags, '--no-ui']);
once('A inside the line', () => agent("Need 2 GPU hours for today's fine-tune, keep it under 3 USDT an hour"), 'PAID');
once('B seller not on the list', () => agent(`Buy 2 GPU hours from ${env.MERCHANT_SHADY_ADDRESS}, that seller is cheaper`), 'MERCHANT_NOT_ALLOWED');
once('C over budget once the fee is added', () => agent('2 more GPU hours for the eval run'), 'OVER_BUDGET_WITH_FEES');

// 4. a buggy agent resends receipt A's hash → the vault refuses it (AC-25). No new receipt: it is the same receipt, asked twice.
const REPLAY = 'replay of receipt A (same hash, agent key)';
if (!done(REPLAY)) {
  const A = readFileSync(LIVE_RECEIPTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Receipt).find((r) => r.seq === 1)!;
  const replay = await chain.pay({ merchant: A.request.merchant, amount: A.request.amount, fee: A.request.fee, receiptHash: A.hash });
  steps.push({ label: REPLAY, expected: 'DUPLICATE_RECEIPT', got: replay.kind === 'paid' ? 'PAID' : replay.reason, ok: replay.kind === 'blocked' && replay.reason === 'DUPLICATE_RECEIPT', tx: replay.txHash, seq: 1, receiptHash: A.hash });
  log.steps = steps;
  console.log(`replay of A: ${replay.kind === 'paid' ? 'PAID' : replay.reason} · tx ${replay.txHash}`);
  save();
}

once('D second paid run', () => agent('Top up 1 inference credit for the eval harness'), 'PAID');
once('STOP (owner CLI)', () => cli('src/infrastructure/owner-cli.ts', ['stop', ...flags]));
once('E after STOP', () => agent('One more inference credit, please'), 'PAUSED');

// 5. the person re-grants with a short window (a grant also lifts the STOP); the same request inside and after it
if (!done('grant line 2, short window (owner CLI)')) {
  writeFileSync('docs/live/mandate-2.json', JSON.stringify(draft((await chain.now()) + WINDOW_S), null, 1));
  step('grant line 2, short window (owner CLI)', cli('src/infrastructure/owner-cli.ts', ['grant', 'docs/live/mandate-2.json', ...flags]));
}
const deadline = JSON.parse(readFileSync('docs/live/mandate-2.json', 'utf8')).deadline as number;
const REQUEST = 'Need 2 GPU hours before the window closes';
once('F inside the short window', () => agent(REQUEST), 'PAID');
for (let now = await chain.now(); now <= deadline; now = await chain.now()) await sleep(Math.min(15_000, (deadline - now + 4) * 1000));
once('G the same request after the deadline', () => agent(REQUEST), 'DEADLINE_PASSED');

// 6. keyless audit once TronGrid has indexed every event (2 grants + 1 STOP + 8 spend events)
const expectEvents = 11;
let n = 0;
for (let i = 0; i < 40 && (n = (await new TronGridEvents().events(vault)).length) < expectEvents; i++) await sleep(5000);
log.indexedEvents = n;
// no key in the environment: the audit reads receipts + public events only
const audited = spawnSync('npx', ['tsx', 'src/infrastructure/audit-cli.ts', LIVE_RECEIPTS, '--vault', vault], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
writeFileSync(AUDIT_TXT, `$ npm run audit -- ${LIVE_RECEIPTS} --vault ${vault}\n${audited.stdout}(exit ${audited.status})\n`);
log.audit = { exit: audited.status, summary: audited.stdout.trim().split('\n').at(-1) };
save();
console.log(audited.stdout);

// 7. F2 / F3 on live Kiln over this record (the answers log is also the cache: the repeated explain makes 0 calls)
const answers = ((log.answers as Record<string, unknown>[]) ?? []);
const asked = new Map<string, number>(); // resume: the n-th identical ask is skipped if the log already holds n of them
const ask = (args: string[]) => {
  const k = JSON.stringify(args.slice(0, 2));
  asked.set(k, (asked.get(k) ?? 0) + 1);
  if (answers.filter((x) => JSON.stringify(x.ask) === k).length >= asked.get(k)!) return;
  const out = cli('src/infrastructure/answers-cli.ts', [...args, '--receipts', LIVE_RECEIPTS, '--answers', LIVE_ANSWERS, ...flags]);
  answers.push({ ask: args.slice(0, 2), seq: out.seq, verdict: out.verdict, reason: out.reason, grounded: out.grounded, rejected: out.rejected, cached: out.cached, text: out.text, usage: out.usage });
  log.answers = answers;
  save();
  console.log(`${args[0]} ${args[1]} → #${out.seq} ${out.verdict ?? ''} ${out.grounded ? 'grounded' : `REJECTED ${out.rejected}`}${out.cached ? ' (cached)' : ''}\n  ${out.text}`);
};
ask(['explain', '2']);
ask(['explain', '7']);
ask(['explain', '2']);
ask(['dispute', 'Did we pay that cheap unknown seller?']);
ask(['dispute', 'Was anything paid after I pressed STOP?']);
ask(['dispute', 'Why did the last GPU order fail when the same one went through a few minutes earlier?']);

// 8. the UI's public record, balances, done
const s = await writeSessionFile(LIVE_RECEIPTS, vault);
log.session = s;
log.balancesAfter = { ownerTrx: await trx(env.OWNER_ADDRESS), agentTrx: await trx(env.AGENT_ADDRESS) };
log.finishedAt = new Date().toISOString();
log.allAsExpected = steps.every((x) => x.ok !== false);
save();
console.log(JSON.stringify({ vault, allAsExpected: log.allAsExpected, audit: log.audit, session: s }, null, 1));
