import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { purchase } from '../src/application/purchase';
import { FakeLlm, MemoryCatalog, MemoryChain, MemoryReceiptStore } from '../src/adapters/memory';
import { audit } from '../src/domain/audit';
import { usdt } from '../src/domain/money';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const offers = [
  { merchant: 'TGpuShop', item: 'gpu-hours', unitPrice: usdt(2.4), fee: usdt(0.2), label: 'GPU Shop — A100 hour' },
  { merchant: 'TKilnCredits', item: 'inference-credits', unitPrice: usdt(1), fee: 0, label: 'Kiln credits' },
  { merchant: 'TShadyGpu', item: 'gpu-hours', unitPrice: usdt(0.9), fee: 0, label: 'Unknown seller — very cheap' },
];

function world(llmReplies: string[], budget = 10, deadline = 10_000) {
  const chain = new MemoryChain({ id: 'm1', budget: usdt(budget), perTxCap: usdt(8), deadline, merchants: ['TGpuShop', 'TKilnCredits'], paused: false }, 1_000);
  const store = new MemoryReceiptStore();
  const deps = { llm: new FakeLlm(llmReplies), chain, catalog: new MemoryCatalog(offers), store, hash: sha };
  return { chain, store, deps };
}

describe('UC-2 purchase (fakes only)', () => {
  it('pays inside the line with exactly one LLM call, and the receipt hash is what the chain recorded', async () => {
    const { chain, store, deps } = world(['{"item":"gpu-hours","quantity":2,"maxUnitPrice":3}']);
    const res = await purchase(deps, 'Need 2 GPU hours for fine-tuning today, under 3 USDT per hour');
    expect(res.outcome.kind).toBe('paid');
    expect(res.request).toMatchObject({ merchant: 'TGpuShop', amount: usdt(4.8), fee: usdt(0.2) });
    expect(res.receipt.flows).toHaveLength(1);
    expect(chain.events[0]).toMatchObject({ kind: 'paid', receiptHash: res.receipt.hash });
    expect((await store.all()).length).toBe(1);
  });

  it('a request that pushes to an unlisted merchant is stopped by the vault and still recorded', async () => {
    const { chain, deps } = world(['{"item":"gpu-hours","quantity":2,"merchantHint":"TShadyGpu"}']);
    const res = await purchase(deps, 'Buy 2 GPU hours from TShadyGpu, it is cheaper');
    expect(res.preview).toEqual({ kind: 'block', reason: 'MERCHANT_NOT_ALLOWED' });
    expect(res.outcome).toMatchObject({ kind: 'blocked', reason: 'MERCHANT_NOT_ALLOWED' });
    expect(chain.events).toHaveLength(1);
  });

  it('fees push the second purchase over budget → OVER_BUDGET_WITH_FEES; audit rebuilds both verdicts from records alone', async () => {
    const { chain, store, deps } = world(['{"item":"gpu-hours","quantity":2}', '{"item":"gpu-hours","quantity":2}'], 9.9); // 5.0 spent; 4.8 fits alone, 4.8+0.2 fee does not
    await purchase(deps, 'first');
    const second = await purchase(deps, 'second');
    expect(second.outcome).toMatchObject({ kind: 'blocked', reason: 'OVER_BUDGET_WITH_FEES' });
    const res = audit({ mandates: [chain.mandateSnapshot()], receipts: await store.all(), events: chain.events, hash: sha });
    expect(res.chain.ok).toBe(true);
    expect(res.verdicts.map((v) => v.verdict)).toEqual(['PAID_INSIDE', 'STOPPED']);
  });

  it('human STOP pauses the vault: the next attempt is blocked PAUSED', async () => {
    const { chain, deps } = world(['{"item":"inference-credits","quantity":1}']);
    await chain.pause();
    const res = await purchase(deps, 'buy 1 credit');
    expect(res.outcome).toMatchObject({ kind: 'blocked', reason: 'PAUSED' });
  });
});
