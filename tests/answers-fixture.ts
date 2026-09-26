// Shared fixture for F2 / F3 tests: a real receipt chain + chain events produced by UC-2 on the in-memory vault.
import { createHash } from 'node:crypto';
import { FakeLlm, MemoryCatalog, MemoryChain, MemoryReceiptStore } from '../src/adapters/memory';
import { purchase } from '../src/application/purchase';
import { usdt } from '../src/domain/money';

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const GPU = 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56';
export const CREDITS = 'TKbfXc5mBAKumqNbX4jvJmCGyQmcDsCN6y';
export const SHADY = 'TSojjSHeQnBK46RVJCT2Cjd8QeXnoYkGvh';
export const labels = { [GPU]: 'GPU Shop', [CREDITS]: 'Kiln credits', [SHADY]: 'Unknown seller' };

/** #1 paid 5.00 · #2 stopped MERCHANT_NOT_ALLOWED · #3 stopped OVER_BUDGET_WITH_FEES (budget 9.90). */
export async function threeReceipts() {
  const chain = new MemoryChain({ id: '0xm1', budget: usdt(9.9), perTxCap: usdt(8), deadline: 10_000, merchants: [GPU, CREDITS], paused: false }, 1_000);
  await chain.grant({ id: '0xm1', budget: usdt(9.9), perTxCap: usdt(8), deadline: 10_000, merchants: [GPU, CREDITS], paused: false });
  const store = new MemoryReceiptStore();
  const offers = [
    { merchant: GPU, item: 'gpu-hours', unitPrice: usdt(2.4), fee: usdt(0.2), label: 'GPU Shop' },
    { merchant: SHADY, item: 'gpu-hours', unitPrice: usdt(0.9), fee: 0, label: 'Unknown seller' },
  ];
  const llm = new FakeLlm([
    '{"item":"gpu-hours","quantity":2}',
    `{"item":"gpu-hours","quantity":2,"merchantHint":"${SHADY}"}`,
    '{"item":"gpu-hours","quantity":2}',
  ]);
  const deps = { llm, chain, catalog: new MemoryCatalog(offers), store, hash: sha };
  await purchase(deps, 'Need 2 GPU hours for the fine-tune');
  chain.advance(60);
  await purchase(deps, 'Buy 2 GPU hours from the cheap unknown seller');
  chain.advance(60);
  await purchase(deps, '2 more GPU hours');
  return { receipts: await store.all(), events: chain.events };
}
