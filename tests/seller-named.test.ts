import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sellerNamedIn } from '../src/domain/intent';
import { purchase } from '../src/application/purchase';
import { FakeLlm, MemoryCatalog, MemoryChain, MemoryReceiptStore } from '../src/adapters/memory';
import { usdt } from '../src/domain/money';

// AC-39 (M1 check 2026-09-29, live receipt #12): the request named "the Unknown seller" by its catalog name, F1 left
// merchantHint empty (the prompt asks for an address), and code picked the cheapest *listed* seller instead.
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const offers = [
  { merchant: 'TGpuShop', item: 'gpu-hours', unitPrice: usdt(2.4), fee: usdt(0.2), label: 'GPU Shop' },
  { merchant: 'TKilnCredits', item: 'inference-credits', unitPrice: usdt(1), fee: 0, label: 'Kiln credits' },
  { merchant: 'TShadyGpu', item: 'gpu-hours', unitPrice: usdt(0.9), fee: 0, label: 'Unknown seller — very cheap' },
];

describe('AC-39 a seller named by its catalog name', () => {
  it('finds the one seller whose name (label before " — ") is in the request, any case', () => {
    expect(sellerNamedIn('Buy 1 GPU hour from the Unknown seller, it is cheaper', offers)).toBe('TShadyGpu');
    expect(sellerNamedIn('one hour from the gpu shop', offers)).toBe('TGpuShop');
  });
  it('names nothing when no name is in the request, or when two different sellers are named', () => {
    expect(sellerNamedIn('Need 2 GPU hours for the eval run', offers)).toBeUndefined();
    expect(sellerNamedIn('Top up 2 Kiln inference credits', offers)).toBeUndefined();
    expect(sellerNamedIn('GPU Shop or the Unknown seller, whichever', offers)).toBeUndefined();
  });
  it('matches whole words only', () => {
    expect(sellerNamedIn('from the GPU Shopping mall', offers)).toBeUndefined();
  });
  it('purchase: the named seller is used when F1 gave no address → the vault stops the unlisted seller', async () => {
    const chain = new MemoryChain({ id: 'm1', budget: usdt(10), perTxCap: usdt(8), deadline: 10_000, merchants: ['TGpuShop', 'TKilnCredits'], paused: false }, 1_000);
    const deps = { llm: new FakeLlm(['{"item":"gpu-hours","quantity":1}']), chain, catalog: new MemoryCatalog(offers), store: new MemoryReceiptStore(), hash: sha };
    const res = await purchase(deps, 'Buy 1 GPU hour from the Unknown seller, it is cheaper');
    expect(res.request.merchant).toBe('TShadyGpu');
    expect(res.outcome).toMatchObject({ kind: 'blocked', reason: 'MERCHANT_NOT_ALLOWED' });
  });
  it('purchase: an address from F1 still wins over a name', async () => {
    const chain = new MemoryChain({ id: 'm1', budget: usdt(10), perTxCap: usdt(8), deadline: 10_000, merchants: ['TGpuShop', 'TKilnCredits'], paused: false }, 1_000);
    const deps = { llm: new FakeLlm(['{"item":"gpu-hours","quantity":1,"merchantHint":"TGpuShop"}']), chain, catalog: new MemoryCatalog(offers), store: new MemoryReceiptStore(), hash: sha };
    const res = await purchase(deps, 'from TGpuShop, not the Unknown seller');
    expect(res.request.merchant).toBe('TGpuShop');
  });
});
