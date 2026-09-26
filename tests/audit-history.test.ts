import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { audit, type ChainEvent } from '../src/domain/audit';
import type { Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';
import { GENESIS, sealReceipt, type Receipt, type ReceiptBody } from '../src/domain/receipt';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const m1: Mandate = { id: '0xm1', budget: usdt(10), perTxCap: usdt(8), deadline: 1_000, merchants: ['TGpuShop'], paused: false };
const m2: Mandate = { id: '0xm2', budget: usdt(10), perTxCap: usdt(8), deadline: 5_000, merchants: ['TGpuShop'], paused: false };

function sealAll(bodies: ReceiptBody[]): Receipt[] {
  let prev = GENESIS;
  return bodies.map((b) => {
    const r = sealReceipt(prev, b, sha);
    prev = r.hash;
    return r;
  });
}
const body = (seq: number, mandateId: string, amount: number, at: number): ReceiptBody => ({
  seq,
  mandateId,
  request: { merchant: 'TGpuShop', amount, fee: usdt(0.2), at },
  intentText: `run ${seq}`,
  flows: [],
});

describe('audit replays the mandate history (AC-10, AC-11)', () => {
  it('AC-10 spent is per mandate, and a new grant clears an earlier STOP (vault.grant sets paused = false)', () => {
    const rs = sealAll([body(1, m1.id, usdt(6), 100), body(2, m2.id, usdt(6), 2_100), body(3, m2.id, usdt(1), 6_000)]);
    const events: ChainEvent[] = [
      { kind: 'granted', mandate: m1, at: 50, txHash: 'g1' },
      { kind: 'paid', receiptHash: rs[0].hash, merchant: 'TGpuShop', amount: usdt(6), fee: usdt(0.2), at: 100, txHash: 't1' },
      { kind: 'paused', at: 500, txHash: 'p1' },
      { kind: 'granted', mandate: m2, at: 2_000, txHash: 'g2' },
      { kind: 'paid', receiptHash: rs[1].hash, merchant: 'TGpuShop', amount: usdt(6), fee: usdt(0.2), at: 2_100, txHash: 't2' },
      { kind: 'blocked', receiptHash: rs[2].hash, merchant: 'TGpuShop', amount: usdt(1), fee: usdt(0.2), at: 6_000, reason: 'DEADLINE_PASSED', txHash: 't3' },
    ];
    const res = audit({ mandates: [], receipts: rs, events, hash: sha });
    expect(res.verdicts.map((v) => `${v.verdict}:${v.reason ?? ''}`)).toEqual(['PAID_INSIDE:', 'PAID_INSIDE:', 'STOPPED:DEADLINE_PASSED']);
    expect(res.totalPaid).toBe(usdt(12.4));
  });

  it('AC-11 the line in force comes from granted events, not from the fallback argument', () => {
    const rs = sealAll([body(1, m1.id, usdt(6), 100)]);
    const widened: Mandate = { ...m1, merchants: ['TSomeoneElse'] }; // what "current state" might say later
    const events: ChainEvent[] = [
      { kind: 'granted', mandate: m1, at: 50, txHash: 'g1' },
      { kind: 'paid', receiptHash: rs[0].hash, merchant: 'TGpuShop', amount: usdt(6), fee: usdt(0.2), at: 100, txHash: 't1' },
    ];
    const res = audit({ mandates: [widened], receipts: rs, events, hash: sha });
    expect(res.verdicts[0].verdict).toBe('PAID_INSIDE');
  });
});
