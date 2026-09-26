import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderAudit, renderReceipt, type Fmt } from '../src/adapters/web/render';
import { auditExitCode, formatAuditReport, problemCount } from '../src/application/auditRecords';
import { auditView, receiptView, type Session } from '../src/application/views';
import { audit, type ChainEvent } from '../src/domain/audit';
import type { Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';
import { GENESIS, sealReceipt, type Receipt } from '../src/domain/receipt';
import { isKilnCall, type UsageRecord } from '../src/domain/tokenLedger';
import { FakeLlm } from '../src/adapters/memory';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const fmt: Fmt = { time: (t) => `t${t}` };
const GPU = 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56';
const m: Mandate = { id: '0xaa', budget: usdt(9.9), perTxCap: usdt(8), deadline: 1_000, merchants: [GPU], paused: false };
const live: UsageRecord = { flow: 'F1_intent', promptTokens: 104, completionTokens: 41, costUsd: 0.0000198, latencyMs: 3332, generationId: '4e6aeeb5-4060-4c1b-9d7e-000000000000' };
const standIn: UsageRecord = { flow: 'F1_intent', promptTokens: 78, completionTokens: 9, costUsd: 0, latencyMs: 0, generationId: 'fake-1' };

function twoPaid(flows1: UsageRecord[] = [live]): { receipts: Receipt[]; events: ChainEvent[] } {
  const r1 = sealReceipt(GENESIS, { seq: 1, mandateId: m.id, request: { merchant: GPU, amount: usdt(2.4), fee: usdt(0.2), at: 100 }, intentText: '1 GPU hour', flows: flows1 }, sha);
  const r2 = sealReceipt(r1.hash, { seq: 2, mandateId: m.id, request: { merchant: GPU, amount: usdt(2.4), fee: usdt(0.2), at: 200 }, intentText: '1 more GPU hour', flows: [live] }, sha);
  const events: ChainEvent[] = [
    { kind: 'granted', mandate: m, at: 50, txHash: 'g1' },
    { kind: 'paid', receiptHash: r1.hash, merchant: GPU, amount: usdt(2.4), fee: usdt(0.2), at: 100, txHash: 'tx1' },
    { kind: 'paid', receiptHash: r2.hash, merchant: GPU, amount: usdt(2.4), fee: usdt(0.2), at: 200, txHash: 'tx2' },
  ];
  return { receipts: [r1, r2], events };
}

describe('AC-21 chain spends without a receipt', () => {
  it('dropping the LAST receipt keeps the hash chain intact, but the orphan Paid event is a problem (exit 1)', () => {
    const { receipts, events } = twoPaid();
    const res = audit({ mandates: [], receipts: receipts.slice(0, 1), events, hash: sha });
    expect(res.chain).toEqual({ ok: true });
    expect(res.unreceipted.map((u) => [u.kind, u.txHash, u.amount + u.fee])).toEqual([['paid', 'tx2', usdt(2.6)]]);
    expect(problemCount(res)).toBe(1);
    expect(auditExitCode(res)).toBe(1);
    const report = formatAuditReport(res, { vault: 'TVault', source: 'saved' });
    expect(report).toMatch(/tx2.*no receipt/);
    expect(report).toMatch(/1 chain spend without a receipt/);
    expect(report).toMatch(/PROBLEMS$/);
  });
  it('a second event carrying the same receipt hash (replay) is listed too', () => {
    const { receipts, events } = twoPaid();
    const replay: ChainEvent = { ...(events[2] as Extract<ChainEvent, { kind: 'paid' }>), at: 300, txHash: 'tx2-again' };
    const res = audit({ mandates: [], receipts, events: [...events, replay], hash: sha });
    expect(res.unreceipted.map((u) => u.txHash)).toEqual(['tx2-again']);
    expect(res.verdicts.map((v) => [v.seq, v.txHash])).toEqual([[1, 'tx1'], [2, 'tx2']]);
  });
  it('a full record has no orphans; the Audit screen shows orphans as rows and counts them', () => {
    const { receipts, events } = twoPaid();
    expect(audit({ mandates: [], receipts, events, hash: sha }).unreceipted).toEqual([]);
    const v = auditView(audit({ mandates: [], receipts: receipts.slice(0, 1), events, hash: sha }));
    expect(v.problems).toBe(1);
    const html = renderAudit(v, fmt, { source: 'saved' });
    expect(html).toMatch(/On-chain spend with no receipt/);
    expect(html).not.toMatch(/All \d+ receipts check out/);
  });
});

describe('AC-22 scripted stand-in is never shown as a Kiln call', () => {
  it('isKilnCall: only usage with a real generation id counts; FakeLlm ids are stand-ins', async () => {
    expect(isKilnCall(live)).toBe(true);
    expect(isKilnCall(standIn)).toBe(false);
    expect(isKilnCall({ ...live, generationId: '' })).toBe(false);
    const { usage } = await new FakeLlm(['{}']).chat('F1_intent', [{ role: 'user', content: 'x' }]);
    expect(isKilnCall(usage)).toBe(false);
  });
  it('receipt screen: stand-in → "scripted stand-in — no Kiln call"; live → "1 Kiln call · 145 tokens"', () => {
    const { receipts, events } = twoPaid([standIn]);
    const s: Session = { vault: 'TVault', network: 'nile', receipts, events, generatedAt: 300 };
    const v1 = receiptView(s, 1, sha);
    const v2 = receiptView(s, 2, sha);
    if (v1.kind !== 'receipt' || v2.kind !== 'receipt') throw new Error('expected receipts');
    expect([v1.kilnCalls, v1.standInCalls, v1.tokens]).toEqual([0, 1, 0]);
    expect([v2.kilnCalls, v2.standInCalls, v2.tokens]).toEqual([1, 0, 145]);
    const h1 = renderReceipt(v1, fmt);
    expect(h1).toMatch(/scripted stand-in — no Kiln call/);
    expect(h1).not.toMatch(/\d Kiln call/);
    expect(renderReceipt(v2, fmt)).toMatch(/1 Kiln call · 145 tokens/);
  });
});
