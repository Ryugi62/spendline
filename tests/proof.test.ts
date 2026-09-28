import { describe, expect, it } from 'vitest';
import { formatProof, proofByFlow } from '../src/application/proof';
import type { AnswerRecord } from '../src/application/ports';
import type { ChainEvent } from '../src/domain/audit';
import type { Receipt } from '../src/domain/receipt';

// AC-38: organizer's required item 4 — on-chain tx hashes + Kiln API call logs, per flow.
const usage = (flow: 'F1_intent' | 'F2_explain' | 'F3_dispute', id: string, extra = {}) => ({ flow, promptTokens: 100, completionTokens: 20, costUsd: 0.0000152, latencyMs: 1500, generationId: id, ...extra });
const receipt = (seq: number, hash: string, flows: ReturnType<typeof usage>[]): Receipt =>
  ({ seq, mandateId: '0xm', request: { merchant: 'TM', amount: 1_000_000, fee: 0, at: 1790600193 }, intentText: 'Buy 1 credit', flows, prevHash: 'p', hash }) as unknown as Receipt;
const receipts = [
  receipt(1, 'h1', [usage('F1_intent', 'gen-1', { via: 'tool_call', serverMs: 433 })]),
  receipt(2, 'h2', [usage('F1_intent', 'gen-2')]),
  receipt(3, 'h3', [usage('F1_intent', 'fake-3')]),
];
const events: ChainEvent[] = [
  { kind: 'paid', receiptHash: 'h1', merchant: 'TM', amount: 1, fee: 0, at: 1, txHash: 'aaa111' },
  { kind: 'blocked', receiptHash: 'h2', merchant: 'TX', amount: 1, fee: 0, at: 2, reason: 'MERCHANT_NOT_ALLOWED', txHash: 'bbb222' },
  { kind: 'blocked', receiptHash: 'h1', merchant: 'TM', amount: 1, fee: 0, at: 3, reason: 'DUPLICATE_RECEIPT', txHash: 'ccc333' },
];
const answers = [
  { key: 'F2:h2', flow: 'F2_explain', seq: 2, text: 'stopped', grounded: true, txHash: 'bbb222', usage: usage('F2_explain', 'gen-f2') },
  { key: 'F3:q', flow: 'F3_dispute', seq: 2, question: 'Did we pay that seller?', text: 'no', grounded: false, txHash: 'bbb222', usage: usage('F3_dispute', 'gen-f3') },
  { key: 'F3:q-cached', flow: 'F3_dispute', seq: 2, question: 'Did we pay that seller?', text: 'no', grounded: true },
] as unknown as AnswerRecord[];

describe('proofByFlow (AC-38)', () => {
  const p = proofByFlow({ receipts, events, answers });

  it('F1: one row per Kiln call, joined to the first on-chain event for the receipt hash (never the replay)', () => {
    expect(p.f1.map((r) => [r.seq, r.generationId, r.txHash, r.outcome])).toEqual([
      [1, 'gen-1', 'aaa111', 'paid'],
      [2, 'gen-2', 'bbb222', 'stopped MERCHANT_NOT_ALLOWED'],
    ]);
    expect(p.f1[0]).toMatchObject({ via: 'tool_call', serverMs: 433, promptTokens: 100, completionTokens: 20 });
  });

  it('stand-in usage is never a row, and is counted as excluded', () => {
    expect(p.f1.some((r) => r.generationId.startsWith('fake-'))).toBe(false);
    expect(p.excludedStandIns).toBe(1);
  });

  it('F2 / F3: one row per Kiln call (cached answers are not calls), with the receipt tx', () => {
    expect(p.f2.map((r) => [r.seq, r.generationId, r.txHash, r.shown])).toEqual([[2, 'gen-f2', 'bbb222', true]]);
    expect(p.f3.map((r) => [r.seq, r.question, r.generationId, r.shown])).toEqual([[2, 'Did we pay that seller?', 'gen-f3', false]]);
  });

  it('a receipt with no on-chain event is a finding, not a blank cell', () => {
    const q = proofByFlow({ receipts: [receipt(9, 'h9', [usage('F1_intent', 'gen-9')])], events, answers: [] });
    expect(q.findings).toEqual(['receipt #9 (gen-9) has no on-chain event']);
  });

  it('formatProof: a table per flow, tronscan links, KST time, totals line', () => {
    const md = formatProof(p, { network: 'nile' });
    expect(md).toContain('### F1 intent');
    expect(md).toContain('### F2 explain');
    expect(md).toContain('### F3 dispute');
    expect(md).toContain('[aaa111…](https://nile.tronscan.org/#/transaction/aaa111)');
    expect(md).toContain('`gen-1`');
    expect(md).toContain('2026-09-28 21:56:33 KST');
    expect(md).toContain('4 Kiln calls');
    expect(md).not.toContain('fake-3');
  });
});
