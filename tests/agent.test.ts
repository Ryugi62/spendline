import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonlReceiptStore } from '../src/adapters/files';
import { FakeLlm, MemoryCatalog, MemoryChain } from '../src/adapters/memory';
import { formatPurchase } from '../src/application/agent';
import { purchase } from '../src/application/purchase';
import { sessionOf } from '../src/application/views';
import { audit } from '../src/domain/audit';
import { usdt } from '../src/domain/money';
import { positionals } from '../src/infrastructure/runtime';
import { GPU, labels, sha, SHADY } from './answers-fixture';

const offers = [
  { merchant: GPU, item: 'gpu-hours', unitPrice: usdt(2.4), fee: usdt(0.2), label: 'GPU Shop' },
  { merchant: SHADY, item: 'gpu-hours', unitPrice: usdt(0.9), fee: 0, label: 'Unknown seller' },
];
const line = { id: '0xm', budget: usdt(9.9), perTxCap: usdt(8), deadline: 10_000, merchants: [GPU], paused: false };

describe('AC-29 one request line → receipt (M0-15)', () => {
  it('JsonlReceiptStore continues the hash chain already in the file, one JSON line per receipt', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'spendline-')), 'receipts.jsonl');
    const chain = new MemoryChain(line, 100);
    await chain.grant(line);
    const run = (reply: string, text: string) => purchase({ llm: new FakeLlm([reply]), chain, catalog: new MemoryCatalog(offers), store: new JsonlReceiptStore(path), hash: sha }, text);
    await run('{"item":"gpu-hours","quantity":2}', 'Need 2 GPU hours');
    const second = await run(`{"item":"gpu-hours","quantity":1,"merchantHint":"${SHADY}"}`, '1 hour from the cheap seller'); // a new process: a new store on the same file
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(second.receipt.seq).toBe(2);
    const receipts = await new JsonlReceiptStore(path).all();
    expect(receipts[1].prevHash).toBe(receipts[0].hash);
    const res = audit({ mandates: [], receipts, events: chain.events, hash: sha });
    expect(res.chain.ok).toBe(true);
    expect(res.verdicts.map((v) => v.verdict)).toEqual(['PAID_INSIDE', 'STOPPED']);
  });

  it('a broken receipts file stops the agent before it asks Kiln or pays', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'spendline-')), 'receipts.jsonl');
    writeFileSync(path, 'nope\n');
    await expect(new JsonlReceiptStore(path).all()).rejects.toThrow(/line 1/);
  });

  it('the report line: verdict first, then amount and seller, tx link, and what the thinking cost', async () => {
    const chain = new MemoryChain(line, 100);
    await chain.grant(line);
    const store = new JsonlReceiptStore(join(mkdtempSync(join(tmpdir(), 'spendline-')), 'r.jsonl'));
    const deps = (reply: string) => ({ llm: new FakeLlm([reply]), chain, catalog: new MemoryCatalog(offers), store, hash: sha });
    const paid = formatPurchase(await purchase(deps('{"item":"gpu-hours","quantity":2}'), 'Need 2 GPU hours'), labels);
    expect(paid.split('\n')[0]).toBe('#1 PAID · 5.00 USDT to GPU Shop (4.80 + fee 0.20) · Paid inside your line');
    expect(paid).toMatch(/tx mem-\d+ · https:\/\/nile\.tronscan\.org\/#\/transaction\/mem-\d+/);
    expect(paid).toMatch(/scripted stand-in — no Kiln call · F1_intent/);
    const stopped = formatPurchase(await purchase(deps(`{"item":"gpu-hours","quantity":1,"merchantHint":"${SHADY}"}`), 'cheap one'), labels);
    expect(stopped.split('\n')[0]).toBe('#2 STOPPED MERCHANT_NOT_ALLOWED · 0.90 USDT to Unknown seller (0.90 + fee 0.00) · Seller is not on your list');
  });

  it('sessionOf builds the public record the UI reads; positionals skip flag values but not boolean flags', () => {
    expect(sessionOf({ receipts: [] }, 'TV', [], 7)).toEqual({ vault: 'TV', network: 'nile', receipts: [], events: [], generatedAt: 7 });
    expect(positionals(['2 GPU hours', '--receipts', 'f.jsonl', '--no-ui', 'x'], ['--no-ui'])).toEqual(['2 GPU hours', 'x']);
  });

  it('the agent CLI has no stand-in: it wires Kiln only (a Kiln failure fails the run)', () => {
    const src = readFileSync('src/infrastructure/agent-cli.ts', 'utf8');
    expect(src).toMatch(/kilnFrom\(env\)/);
    expect(src).not.toMatch(/FakeLlm|adapters\/memory/);
  });
});
