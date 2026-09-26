import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeLlm, MemoryCatalog, MemoryChain, MemoryReceiptStore } from '../src/adapters/memory';
import { auditExitCode } from '../src/application/auditRecords';
import { purchase } from '../src/application/purchase';
import { audit } from '../src/domain/audit';
import type { Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const offers = [{ merchant: 'TGpuShop', item: 'gpu-hours', unitPrice: usdt(2.4), fee: usdt(0.2), label: 'GPU Shop' }];
const m1: Mandate = { id: '0xm1', budget: usdt(9.9), perTxCap: usdt(8), deadline: 1_500, merchants: ['TGpuShop'], paused: false };

describe('R2 deadline scenario on fakes (mirrors scripts/r2-deadline-nile.ts)', () => {
  it('re-grant → paid inside the line → same request after the deadline is stopped DEADLINE_PASSED → audit agrees across both grants', async () => {
    const chain = new MemoryChain(m1, 1_000);
    const store = new MemoryReceiptStore();
    const deps = { llm: new FakeLlm(Array(3).fill('{"item":"gpu-hours","quantity":2}')), chain, catalog: new MemoryCatalog(offers), store, hash: sha };
    await chain.grant(m1);
    expect((await purchase(deps, '2 GPU hours')).outcome.kind).toBe('paid');
    await chain.pause();

    chain.advance(1_000); // t = 2000, m1 expired and paused
    const m2: Mandate = { ...m1, id: '0xm2', deadline: 2_150 };
    await chain.grant(m2); // vault.grant resets spent and unpauses
    expect(await chain.spent()).toBe(0);
    expect((await purchase(deps, '2 GPU hours')).outcome.kind).toBe('paid');

    chain.advance(200); // t = 2200 > 2150
    const late = await purchase(deps, '2 GPU hours');
    expect(late.outcome).toMatchObject({ kind: 'blocked', reason: 'DEADLINE_PASSED' });

    const res = audit({ mandates: [], receipts: await store.all(), events: chain.events, hash: sha });
    expect(res.verdicts.map((v) => `${v.verdict}:${v.reason ?? ''}`)).toEqual(['PAID_INSIDE:', 'PAID_INSIDE:', 'STOPPED:DEADLINE_PASSED']);
    expect(auditExitCode(res)).toBe(0);
  });
});
