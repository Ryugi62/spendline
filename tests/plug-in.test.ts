import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { agentLoop, type Wallet } from '../examples/plug-in';
import { MemoryChain, MemoryReceiptStore } from '../src/adapters/memory';
import { spendlineWallet } from '../src/application/plugIn';
import { audit } from '../src/domain/audit';
import { usdt } from '../src/domain/money';

// AC-37: an existing agent loop that pays with wallet.transfer() plugs in by swapping the wallet — nothing else changes.
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const plan = [
  { to: 'TGpuShop', amount: usdt(2.4), why: '1 GPU hour for the eval' },
  { to: 'TShadyGpu', amount: usdt(0.9), why: 'cheaper GPU hour from an unknown seller' },
  { to: 'TKilnCredits', amount: usdt(1), why: '1 inference credit' },
];

describe('plug-in (AC-37)', () => {
  it('before: a plain wallet pays everything the planner asks, and leaves no reason', async () => {
    const sent: string[] = [];
    const plain: Wallet = { transfer: async (to) => { sent.push(to); return { ok: true, tx: `tx-${to}` }; } };
    const log = await agentLoop(plan, plain);
    expect(sent).toEqual(['TGpuShop', 'TShadyGpu', 'TKilnCredits']);
    expect(log.every((l) => l.ok)).toBe(true);
  });

  it('after: the same loop with spendlineWallet — inside the line paid, outside stopped on-chain with a reason, every attempt a receipt the keyless audit rebuilds', async () => {
    const chain = new MemoryChain({ id: 'm1', budget: usdt(10), perTxCap: usdt(8), deadline: 10_000, merchants: ['TGpuShop', 'TKilnCredits'], paused: false }, 1_000);
    const store = new MemoryReceiptStore();
    const log = await agentLoop(plan, spendlineWallet({ chain, store, hash: sha }));
    expect(log.map((l) => [l.to, l.ok, l.reason])).toEqual([
      ['TGpuShop', true, undefined],
      ['TShadyGpu', false, 'MERCHANT_NOT_ALLOWED'],
      ['TKilnCredits', true, undefined],
    ]);
    const receipts = await store.all();
    expect(receipts.map((r) => r.intentText)).toEqual(plan.map((p) => p.why));
    expect(receipts.every((r) => r.flows.length === 0)).toBe(true); // no model call added: the agent keeps its own planner
    const res = audit({ mandates: [await chain.mandate()], receipts, events: chain.events, hash: sha });
    expect(res.verdicts.map((v) => v.verdict)).toEqual(['PAID_INSIDE', 'STOPPED', 'PAID_INSIDE']);
    expect(res.unreceipted).toEqual([]);
  });
});
