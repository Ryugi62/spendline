import { describe, expect, it } from 'vitest';
import { MemoryChain } from '../src/adapters/memory';
import { auditExitCode, formatAuditReport, problemCount } from '../src/application/auditRecords';
import { auditView } from '../src/application/views';
import { renderAudit } from '../src/adapters/web/render';
import { audit, type ChainEvent } from '../src/domain/audit';
import { BLOCK_REASONS, CHECK_ORDER, evaluate, REASON_CODE, reasonFromCode, type Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';
import { GENESIS, sealReceipt } from '../src/domain/receipt';
import { sha } from './answers-fixture';

const GPU = 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56';
const m: Mandate = { id: '0xm', budget: usdt(9.9), perTxCap: usdt(8), deadline: 10_000, merchants: [GPU], paused: false };
const req = { merchant: GPU, amount: usdt(2.4), fee: usdt(0.2), at: 100 };

describe('AC-25 one receipt, one decision (M0-19)', () => {
  it('on-chain codes 1–6 are unchanged (old vault events still decode); DUPLICATE_RECEIPT is code 7', () => {
    expect(BLOCK_REASONS.slice(0, 6)).toEqual(['PAUSED', 'DEADLINE_PASSED', 'MERCHANT_NOT_ALLOWED', 'INVALID_AMOUNT', 'OVER_TX_CAP', 'OVER_BUDGET_WITH_FEES']);
    expect(REASON_CODE.DUPLICATE_RECEIPT).toBe(7);
    expect(reasonFromCode(7)).toBe('DUPLICATE_RECEIPT');
    expect(reasonFromCode(1)).toBe('PAUSED');
  });

  it('evaluate checks a used receipt first, then the old order — CHECK_ORDER is that order', () => {
    const everythingWrong = { merchant: 'TNope', amount: 0, fee: 0, at: 99_999 };
    expect(evaluate({ ...m, paused: true }, usdt(99), everythingWrong, true)).toEqual({ kind: 'block', reason: 'DUPLICATE_RECEIPT' });
    expect(evaluate({ ...m, paused: true }, usdt(99), everythingWrong, false)).toEqual({ kind: 'block', reason: 'PAUSED' });
    expect(evaluate(m, 0, req)).toEqual({ kind: 'allow' }); // default: not used
    expect(CHECK_ORDER).toEqual(['DUPLICATE_RECEIPT', 'PAUSED', 'DEADLINE_PASSED', 'MERCHANT_NOT_ALLOWED', 'INVALID_AMOUNT', 'OVER_TX_CAP', 'OVER_BUDGET_WITH_FEES']);
  });

  it('MemoryChain mirrors the vault: a reused receipt hash is stopped DUPLICATE_RECEIPT — after a pay and after a stop', async () => {
    const chain = new MemoryChain(m, 100);
    expect((await chain.pay({ ...req, receiptHash: 'r1' })).kind).toBe('paid');
    expect(await chain.pay({ ...req, receiptHash: 'r1' })).toMatchObject({ kind: 'blocked', reason: 'DUPLICATE_RECEIPT' });
    expect(await chain.pay({ ...req, merchant: 'TNope', receiptHash: 'r2' })).toMatchObject({ kind: 'blocked', reason: 'MERCHANT_NOT_ALLOWED' });
    expect(await chain.pay({ ...req, receiptHash: 'r2' })).toMatchObject({ kind: 'blocked', reason: 'DUPLICATE_RECEIPT' });
    expect(await chain.spent()).toBe(usdt(2.6));
  });

  it('audit: a replay the vault stopped is listed, is not a problem, and does not disturb the receipt it copied — even after a STOP', () => {
    const r1 = sealReceipt(GENESIS, { seq: 1, mandateId: m.id, request: req, intentText: '1 GPU hour', flows: [] }, sha);
    const events: ChainEvent[] = [
      { kind: 'granted', mandate: m, at: 50, txHash: 'g1' },
      { kind: 'paid', receiptHash: r1.hash, merchant: GPU, amount: req.amount, fee: req.fee, at: 100, txHash: 'tx1' },
      { kind: 'paused', at: 150, txHash: 'stop1' },
      { kind: 'blocked', receiptHash: r1.hash, merchant: GPU, amount: req.amount, fee: req.fee, at: 200, reason: 'DUPLICATE_RECEIPT', txHash: 'tx1-again' },
    ];
    const res = audit({ mandates: [], receipts: [r1], events, hash: sha });
    expect(res.verdicts.map((v) => [v.seq, v.verdict, v.txHash])).toEqual([[1, 'PAID_INSIDE', 'tx1']]);
    expect(res.replays.map((x) => [x.seq, x.txHash])).toEqual([[1, 'tx1-again']]);
    expect(res.unreceipted).toEqual([]);
    expect(problemCount(res)).toBe(0);
    expect(auditExitCode(res)).toBe(0);
    const report = formatAuditReport(res, { vault: 'TV', source: 'saved' });
    expect(report).toMatch(/~ replay of #1 stopped on-chain DUPLICATE_RECEIPT · tx tx1-again/);
    expect(report).toMatch(/1 replay stopped/);
    expect(report).toMatch(/OK$/);
    const html = renderAudit(auditView(res), { time: (t) => `t${t}` }, { source: 'saved' });
    expect(html).toMatch(/Replay of receipt #1 — stopped on-chain/);
  });

  it('audit: a DUPLICATE_RECEIPT stop for a hash no receipt carries is still a chain event without a receipt', () => {
    const res = audit({
      mandates: [],
      receipts: [],
      events: [{ kind: 'blocked', receiptHash: 'ff', merchant: GPU, amount: 1, fee: 0, at: 1, reason: 'DUPLICATE_RECEIPT', txHash: 'x' }],
      hash: sha,
    });
    expect(res.unreceipted.map((u) => u.txHash)).toEqual(['x']);
    expect(problemCount(res)).toBe(1);
  });
});
