import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sealReceipt, GENESIS, type Receipt, type ReceiptBody } from '../src/domain/receipt';
import { audit, type ChainEvent } from '../src/domain/audit';
import type { Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const mandate: Mandate = { id: 'm1', budget: usdt(10), perTxCap: usdt(6), deadline: 5_000, merchants: ['TGpuShop'], paused: false };

function body(seq: number, merchant: string, amount: number, fee: number, at: number): ReceiptBody {
  return { seq, mandateId: 'm1', request: { merchant, amount, fee, at }, intentText: `req ${seq}`, flows: [] };
}
function chain(): Receipt[] {
  const out: Receipt[] = [];
  let prev = GENESIS;
  for (const b of [body(1, 'TGpuShop', usdt(5), usdt(0.2), 100), body(2, 'TEvil', usdt(1), 0, 200), body(3, 'TGpuShop', usdt(5), usdt(0.2), 300)]) {
    const r = sealReceipt(prev, b, sha);
    out.push(r);
    prev = r.hash;
  }
  return out;
}

describe('receipt chain + audit (AC-5, AC-6)', () => {
  it('AC-5 detects a changed byte at the right seq', () => {
    const rs = chain();
    const tampered = rs.map((r) => (r.seq === 2 ? { ...r, intentText: 'req 2!' } : r));
    const res = audit({ mandates: [mandate], receipts: tampered, events: [], hash: sha });
    expect(res.chain).toEqual({ ok: false, brokenAt: 2 });
  });
  it('AC-6 all agree → PAID / STOPPED per receipt; spent accumulates from paid events only', () => {
    const rs = chain();
    const events: ChainEvent[] = [
      { kind: 'paid', receiptHash: rs[0].hash, merchant: 'TGpuShop', amount: usdt(5), fee: usdt(0.2), at: 100, txHash: 'tx1' },
      { kind: 'blocked', receiptHash: rs[1].hash, merchant: 'TEvil', amount: usdt(1), fee: 0, at: 200, reason: 'MERCHANT_NOT_ALLOWED', txHash: 'tx2' },
      { kind: 'blocked', receiptHash: rs[2].hash, merchant: 'TGpuShop', amount: usdt(5), fee: usdt(0.2), at: 300, reason: 'OVER_BUDGET_WITH_FEES', txHash: 'tx3' },
    ];
    const res = audit({ mandates: [mandate], receipts: rs, events, hash: sha });
    expect(res.chain).toEqual({ ok: true });
    expect(res.verdicts.map((v) => v.verdict)).toEqual(['PAID_INSIDE', 'STOPPED', 'STOPPED']);
    expect(res.verdicts[1].reason).toBe('MERCHANT_NOT_ALLOWED');
    expect(res.totalPaid).toBe(usdt(5.2));
  });
  it('AC-6b a chain outcome that disagrees with the policy is a MISMATCH', () => {
    const rs = chain();
    const events: ChainEvent[] = [
      { kind: 'paid', receiptHash: rs[1].hash, merchant: 'TEvil', amount: usdt(1), fee: 0, at: 200, txHash: 'txX' },
    ];
    const res = audit({ mandates: [mandate], receipts: rs, events, hash: sha });
    const v = res.verdicts.find((x) => x.seq === 2)!;
    expect(v.verdict).toBe('MISMATCH');
    expect(res.verdicts.find((x) => x.seq === 1)!.verdict).toBe('NO_CHAIN_EVENT');
  });
});

describe('audit replays owner STOP/RESUME (found on Nile 2026-09-24: 4th run was MISMATCH without it)', () => {
  it('a pay attempted after a pause event is STOPPED(PAUSED), and resume clears it', () => {
    const rs = chain();
    const events: ChainEvent[] = [
      { kind: 'paid', receiptHash: rs[0].hash, merchant: 'TGpuShop', amount: usdt(5), fee: usdt(0.2), at: 100, txHash: 'tx1' },
      { kind: 'paused', at: 150, txHash: 'txP' },
      { kind: 'blocked', receiptHash: rs[1].hash, merchant: 'TEvil', amount: usdt(1), fee: 0, at: 200, reason: 'PAUSED', txHash: 'tx2' },
      { kind: 'resumed', at: 250, txHash: 'txR' },
      { kind: 'blocked', receiptHash: rs[2].hash, merchant: 'TGpuShop', amount: usdt(5), fee: usdt(0.2), at: 300, reason: 'OVER_BUDGET_WITH_FEES', txHash: 'tx3' },
    ];
    const res = audit({ mandates: [mandate], receipts: rs, events, hash: sha });
    expect(res.verdicts.map((v) => `${v.verdict}:${v.reason ?? ''}`)).toEqual(['PAID_INSIDE:', 'STOPPED:PAUSED', 'STOPPED:OVER_BUDGET_WITH_FEES']);
  });
});
