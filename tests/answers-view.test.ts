import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderAudit, renderReceipt, type Fmt } from '../src/adapters/web/render';
import type { AnswerRecord } from '../src/application/ports';
import { auditView, latestAnswers, questionsView, receiptView, type Session } from '../src/application/views';
import { audit, type ChainEvent } from '../src/domain/audit';
import type { Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';
import { GENESIS, sealReceipt } from '../src/domain/receipt';

// AC-30: the model's F2 / F3 words are shown only where they echo the audit, newest prompt version only.
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const fmt: Fmt = { time: (t) => `t${t}` };
const GPU = 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56';
const SHADY = 'TSojjSHeQnBK46RVJCT2Cjd8QeXnoYkGvh';
const m: Mandate = { id: '0xaa', budget: usdt(9.9), perTxCap: usdt(8), deadline: 1_000, merchants: [GPU], paused: false };
const r1 = sealReceipt(GENESIS, { seq: 1, mandateId: m.id, request: { merchant: GPU, amount: usdt(4.8), fee: usdt(0.2), at: 100 }, intentText: '2 GPU hours', flows: [] }, sha);
const r2 = sealReceipt(r1.hash, { seq: 2, mandateId: m.id, request: { merchant: SHADY, amount: usdt(1.8), fee: 0, at: 200 }, intentText: 'buy from the cheap seller', flows: [] }, sha);
const events: ChainEvent[] = [
  { kind: 'granted', mandate: m, at: 50, txHash: 'g1' },
  { kind: 'paid', receiptHash: r1.hash, merchant: GPU, amount: usdt(4.8), fee: usdt(0.2), at: 100, txHash: 'tx1' },
  { kind: 'blocked', receiptHash: r2.hash, merchant: SHADY, amount: usdt(1.8), fee: 0, at: 200, reason: 'MERCHANT_NOT_ALLOWED', txHash: 'tx2' },
];
const f2 = (key: string, seq: number, text: string, o: Partial<AnswerRecord> = {}): AnswerRecord => ({ key, flow: 'F2_explain', seq, verdict: 'STOPPED', reason: 'MERCHANT_NOT_ALLOWED', text, grounded: true, txHash: 'tx2', ...o });
const f3 = (key: string, seq: number | null, question: string, text: string, o: Partial<AnswerRecord> = {}): AnswerRecord => ({ key, flow: 'F3_dispute', seq, question, verdict: 'STOPPED', text, grounded: true, ...o });
const answers: AnswerRecord[] = [
  f2('F2:r2', 2, 'old words'),
  f2('F2v3:r2', 2, 'The seller is not on your list, so the vault stopped it.'),
  f2('F2v2:r2', 2, 'middle words'),
  f3('F3:q1', 2, 'Did we pay that cheap seller?', 'old answer'),
  f3('F3v4:q1', 2, 'Did we pay that cheap seller?', 'No — it was stopped on-chain because the seller is not listed.'),
  f3('F3v4:q2', 1, 'Did the GPU order go through?', 'It was stopped.', { verdict: 'STOPPED' }), // audit says PAID_INSIDE → left out
  f3('F3v4:q3', 9, 'What about #9?', 'Paid.', { verdict: 'PAID_INSIDE' }), // no receipt #9 → left out
  f3('F3v4:q4', null, 'Did we buy snacks?', 'No receipt matches that question.', { verdict: undefined }),
];
const s: Session = { vault: 'TVault', network: 'nile', receipts: [r1, r2], events, generatedAt: 300, answers };

describe('latestAnswers (AC-30)', () => {
  it('keeps the newest prompt version per question (F2v3 beats F2v2 beats F2)', () => {
    const l = latestAnswers(answers);
    expect(l.filter((a) => a.flow === 'F2_explain').map((a) => a.text)).toEqual(['The seller is not on your list, so the vault stopped it.']);
    expect(l.filter((a) => a.question === 'Did we pay that cheap seller?').map((a) => a.text)).toEqual(['No — it was stopped on-chain because the seller is not listed.']);
  });
});

describe('receiptView why (AC-30)', () => {
  it("shows Kiln's F2 words under a receipt when they echo the audit", () => {
    const v = receiptView(s, 2, sha);
    if (v.kind !== 'receipt') throw new Error('missing');
    expect(v.why).toBe('The seller is not on your list, so the vault stopped it.');
  });
  it('shows nothing when the answer is not grounded or disagrees with the audit', () => {
    for (const bad of [f2('F2v9:r2', 2, 'x', { grounded: false }), f2('F2v9:r2', 2, 'x', { reason: 'PAUSED' }), f2('F2v9:r2', 2, 'x', { verdict: 'PAID_INSIDE', reason: undefined })]) {
      const v = receiptView({ ...s, answers: [bad] }, 2, sha);
      if (v.kind !== 'receipt') throw new Error('missing');
      expect(v.why).toBeUndefined();
    }
  });
  it('a session without answers still renders (older session.json)', () => {
    const v = receiptView({ ...s, answers: undefined }, 1, sha);
    if (v.kind !== 'receipt') throw new Error('missing');
    expect(v.why).toBeUndefined();
  });
});

describe('questionsView (AC-30)', () => {
  it('one row per question, verdict and tx from the audit, rows that do not echo it are left out', () => {
    const q = questionsView(s, sha);
    expect(q.map((x) => x.question)).toEqual(['Did we pay that cheap seller?', 'Did we buy snacks?']);
    expect(q[0]).toMatchObject({ seq: 2, status: 'stopped', line: 'Stopped on-chain: Seller is not on your list', txHash: 'tx2' });
    expect(q[1]).toMatchObject({ seq: null, answer: 'No receipt matches that question.' });
  });
});

describe('screens show the words as Kiln’s, next to the audit (AC-30)', () => {
  it('Receipt: the model sentence under the verdict, labelled, escaped', () => {
    const html = renderReceipt(receiptView({ ...s, answers: [f2('F2v3:r2', 2, 'Stopped <b>here</b>.')] }, 2, sha), fmt);
    expect(html).toContain('Kiln · Qwen3-32B');
    expect(html).toContain('Stopped &lt;b&gt;here&lt;/b&gt;.');
    expect(html.indexOf('class="verdict')).toBeLessThan(html.indexOf('Kiln · Qwen3-32B'));
  });
  it('Audit: the questions a teammate asked, with the audit verdict first', () => {
    const res = audit({ mandates: [], receipts: s.receipts, events, hash: sha });
    const html = renderAudit(auditView(res), fmt, { source: 'recorded', questions: questionsView(s, sha) });
    expect(html).toContain('Did we pay that cheap seller?');
    expect(html.indexOf('Stopped on-chain: Seller is not on your list')).toBeLessThan(html.indexOf('No — it was stopped on-chain'));
    expect(html.match(/class="cta[ "]/g)?.length).toBe(1);
  });
});
