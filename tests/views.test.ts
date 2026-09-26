import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditView, feedView, grantDraft, receiptView, REASON_TEXT, type Session } from '../src/application/views';
import { sha256Hex } from '../src/adapters/sha256';
import { audit, type ChainEvent } from '../src/domain/audit';
import type { Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';
import { GENESIS, sealReceipt, type Receipt } from '../src/domain/receipt';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const GPU = 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56';
const SHADY = 'TSojjSHeQnBK46RVJCT2Cjd8QeXnoYkGvh';
const m: Mandate = { id: '0xaa', budget: usdt(9.9), perTxCap: usdt(8), deadline: 1_000, merchants: [GPU], paused: false };

function session(): Session {
  const r1 = sealReceipt(GENESIS, { seq: 1, mandateId: m.id, request: { merchant: GPU, amount: usdt(4.8), fee: usdt(0.2), at: 100 }, intentText: '2 GPU hours', flows: [{ flow: 'F1_intent', promptTokens: 80, completionTokens: 20, costUsd: 0.00001, latencyMs: 900, generationId: 'gen-1' }] }, sha);
  const r2 = sealReceipt(r1.hash, { seq: 2, mandateId: m.id, request: { merchant: SHADY, amount: usdt(1.8), fee: 0, at: 200 }, intentText: 'buy from the <b>cheap</b> seller', flows: [] }, sha);
  const events: ChainEvent[] = [
    { kind: 'granted', mandate: m, at: 50, txHash: 'g1' },
    { kind: 'paid', receiptHash: r1.hash, merchant: GPU, amount: usdt(4.8), fee: usdt(0.2), at: 100, txHash: 'tx1' },
    { kind: 'blocked', receiptHash: r2.hash, merchant: SHADY, amount: usdt(1.8), fee: 0, at: 200, reason: 'MERCHANT_NOT_ALLOWED', txHash: 'tx2' },
  ];
  return { vault: 'TVault', network: 'nile', receipts: [r1, r2], events, generatedAt: 300 };
}

describe('browser hasher', () => {
  it('sha256Hex matches node:crypto (the UI rebuilds the same receipt hashes)', () => {
    for (const s of ['', 'abc', '{"a":1}', '한글 · receipts']) expect(sha256Hex(s)).toBe(sha(s));
  });
});

describe('grantDraft (AC-16)', () => {
  const now = 1_000_000;
  it('turns form text into a mandate in micro-USDT', () => {
    const d = grantDraft({ budget: '9.9', perTxCap: '8', merchants: `${GPU}\n  \n${SHADY}`, deadline: now + 3600 }, now);
    expect(d).toEqual({ ok: true, mandate: { budget: usdt(9.9), perTxCap: usdt(8), merchants: [GPU, SHADY], deadline: now + 3600, paused: false } });
  });
  it('explains every wrong field in plain words', () => {
    const d = grantDraft({ budget: '0', perTxCap: '', merchants: 'not-an-address', deadline: now - 1 }, now);
    if (d.ok) throw new Error('should fail');
    expect(Object.keys(d.errors).sort()).toEqual(['budget', 'deadline', 'merchants', 'perTxCap']);
    expect(d.errors.merchants).toMatch(/not-an-address/);
    const capOver = grantDraft({ budget: '5', perTxCap: '6', merchants: GPU, deadline: now + 60 }, now);
    expect(capOver.ok ? '' : capOver.errors.perTxCap).toMatch(/bigger than the budget/);
    const none = grantDraft({ budget: '5', perTxCap: '5', merchants: ' ', deadline: Number.NaN }, now);
    expect(none.ok ? {} : none.errors).toMatchObject({ merchants: expect.any(String), deadline: expect.any(String) });
  });
});

describe('feedView (AC-17)', () => {
  it('spent / budget of the latest line first, rows newest first with plain reasons', () => {
    const v = feedView(session(), sha, 150);
    if (v.kind !== 'feed') throw new Error('expected feed');
    expect({ spent: v.spent, budget: v.budget, state: v.state }).toEqual({ spent: usdt(5), budget: usdt(9.9), state: 'open' });
    expect(v.rows.map((r) => [r.seq, r.status])).toEqual([[2, 'stopped'], [1, 'paid']]);
    expect(v.rows[0].reasonText).toBe(REASON_TEXT.MERCHANT_NOT_ALLOWED);
    expect(v.problems).toBe(0);
    expect(feedView(session(), sha, 5_000).kind === 'feed' && (feedView(session(), sha, 5_000) as { state: string }).state).toBe('expired');
  });
  it('STOP after the grant shows as stopped; no receipts is the empty state', () => {
    const s = session();
    s.events.push({ kind: 'paused', at: 250, txHash: 'p1' });
    const v = feedView(s, sha, 260);
    expect(v.kind === 'feed' && v.state).toBe('stopped');
    expect(v.kind === 'feed' && v.stopTx).toBe('p1');
    expect(feedView({ ...s, receipts: [] }, sha, 260)).toEqual({ kind: 'empty' });
  });
  it('a re-grant clears the line\'s STOP, but the vault\'s last recorded STOP stays available as evidence', () => {
    const s = session();
    s.events.push({ kind: 'paused', at: 250, txHash: 'p1' }, { kind: 'granted', mandate: { ...m, id: '0xbb', deadline: 9_000 }, at: 260, txHash: 'g2' });
    const v = feedView(s, sha, 270);
    expect(v.kind === 'feed' && [v.state, v.stopTx, v.lastStopTx, v.spent]).toEqual(['open', undefined, 'p1', 0]);
  });
});

describe('receiptView (AC-18)', () => {
  it('amount first, one verdict line, the words, a tronscan link, proofs for the folded part', () => {
    const v = receiptView(session(), 1, sha);
    if (v.kind !== 'receipt') throw new Error('expected receipt');
    expect(v.total).toBe(usdt(5));
    expect(v.line).toBe('Paid inside your line');
    expect(v.words).toBe('2 GPU hours');
    expect(v.txUrl).toBe('https://nile.tronscan.org/#/transaction/tx1');
    expect(v.tokens).toBe(100);
    expect(v.hash).toHaveLength(64);
    expect(receiptView(session(), 2, sha)).toMatchObject({ status: 'stopped', line: `Stopped on-chain: ${REASON_TEXT.MERCHANT_NOT_ALLOWED}` });
    expect(receiptView(session(), 9, sha)).toEqual({ kind: 'missing', seq: 9 });
  });
});

describe('auditView (AC-19)', () => {
  it('problem count first, then one row per receipt', () => {
    const s = session();
    const ok = auditView(audit({ mandates: [], receipts: s.receipts, events: s.events, hash: sha }));
    expect(ok.problems).toBe(0);
    expect(ok.rows.map((r) => r.label)).toEqual(['Paid inside', 'Stopped']);
    const tampered = auditView(audit({ mandates: [], receipts: [s.receipts[0], { ...s.receipts[1], intentText: 'x' }], events: s.events, hash: sha }));
    expect(tampered.problems).toBe(1);
    expect(tampered.chainLine).toMatch(/#2/);
  });
});
