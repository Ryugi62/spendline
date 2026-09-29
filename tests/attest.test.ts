import { describe, expect, it } from 'vitest';
import { attest, type KilnGeneration } from '../src/domain/attest';
import type { ChainEvent } from '../src/domain/audit';
import type { Receipt } from '../src/domain/receipt';
import { parseKilnGeneration } from '../src/adapters/kiln';

// AC-40: two witnesses per decision — TRON has the money, Kiln has the model call the receipt hash commits to.
const usage = (flow: 'F1_intent' | 'F2_explain' | 'F3_dispute' | 'F4_mcp_host', id: string, extra = {}) =>
  ({ flow, promptTokens: 320, completionTokens: 35, costUsd: 0.00002264, latencyMs: 1896, generationId: id, ...extra });
const receipt = (seq: number, hash: string, flows: ReturnType<typeof usage>[]): Receipt =>
  ({ seq, mandateId: '0xm', request: { merchant: 'TM', amount: 1_000_000, fee: 0, at: 1790600000 }, intentText: 'Buy 1 credit', flows, prevHash: 'p', hash }) as unknown as Receipt;
const gen = (id: string, over: Partial<KilnGeneration> = {}): KilnGeneration =>
  ({ id, model: 'qwen3-32b', totalCost: 0.00002264, promptTokens: 320, completionTokens: 35, createdAt: 1790600000, latencyMs: 601, ...over });
const paid = (hash: string, at: number, tx: string): ChainEvent => ({ kind: 'paid', receiptHash: hash, merchant: 'TM', amount: 1, fee: 0, at, txHash: tx });

describe('attest (AC-40)', () => {
  it('MATCH: same model, tokens and cost; F1 carries Kiln time, pay() block time and the lead', () => {
    const r = attest({
      receipts: [receipt(1, 'h1', [usage('F1_intent', 'g1')])],
      answers: [],
      events: [paid('h1', 1790600012, 'tx1')],
      generations: { g1: gen('g1', { createdAt: 1790600003 }) },
      model: 'qwen3-32b',
    });
    expect(r.rows).toEqual([
      expect.objectContaining({ flow: 'F1_intent', seq: 1, generationId: 'g1', status: 'MATCH', diffs: [], kilnAt: 1790600003, payAt: 1790600012, leadSec: 9, txHash: 'tx1', kilnLatencyMs: 601 }),
    ]);
    expect(r.counts).toEqual({ match: 1, differs: 0, notFound: 0, otherAccount: 0 });
  });

  it('DIFFERS names every differing field; cost within 1e-9 is the same cost', () => {
    const r = attest({
      receipts: [receipt(1, 'h1', [usage('F1_intent', 'g1', { costUsd: 0.000021720000000000002 })])],
      answers: [],
      events: [paid('h1', 1790600012, 'tx1')],
      generations: { g1: gen('g1', { model: 'deepseek-v4.1-flash', completionTokens: 36, totalCost: 0.00002172, createdAt: 1790600001 }) },
      model: 'qwen3-32b',
    });
    expect(r.rows[0].status).toBe('DIFFERS');
    expect(r.rows[0].diffs).toEqual(['model deepseek-v4.1-flash ≠ qwen3-32b', 'output tokens 35 ≠ Kiln 36']);
  });

  it('a model call Kiln dates after the payment is DIFFERS', () => {
    const r = attest({
      receipts: [receipt(1, 'h1', [usage('F1_intent', 'g1')])],
      answers: [],
      events: [paid('h1', 1790600012, 'tx1')],
      generations: { g1: gen('g1', { createdAt: 1790600020 }) },
      model: 'qwen3-32b',
    });
    expect(r.rows[0]).toMatchObject({ status: 'DIFFERS', diffs: ['model call after the payment (8 s)'], leadSec: -8 });
  });

  it('NOT_FOUND when Kiln does not show the id; stand-ins are never rows; F2 / F3 answers are rows, cached answers are not', () => {
    const r = attest({
      receipts: [receipt(1, 'h1', [usage('F1_intent', 'g1')]), receipt(2, 'h2', [usage('F1_intent', 'fake-2')])],
      answers: [
        { flow: 'F2_explain', seq: 1, usage: usage('F2_explain', 'g-f2') },
        { flow: 'F3_dispute', seq: 1, question: 'Did we pay?', usage: usage('F3_dispute', 'g-f3') },
        { flow: 'F3_dispute', seq: 1, question: 'Did we pay?' },
      ],
      events: [paid('h1', 1790600012, 'tx1')],
      generations: { g1: null, 'g-f2': gen('g-f2'), 'g-f3': gen('g-f3') },
      model: 'qwen3-32b',
    });
    expect(r.rows.map((x) => [x.flow, x.generationId, x.status])).toEqual([
      ['F1_intent', 'g1', 'NOT_FOUND'],
      ['F2_explain', 'g-f2', 'MATCH'],
      ['F3_dispute', 'g-f3', 'MATCH'],
    ]);
    expect(r.rows[2].question).toBe('Did we pay?');
    expect(r.counts).toEqual({ match: 2, differs: 0, notFound: 1, otherAccount: 0 });
  });

  it('scope: a call Kiln does not show, made before the asking account (receipt < fromSeq, answer line < fromAnswer), is OTHER_ACCOUNT; inside the scope it stays NOT_FOUND', () => {
    const r = attest({
      receipts: [receipt(12, 'h12', [usage('F1_intent', 'old')]), receipt(13, 'h13', [usage('F1_intent', 'new')]), receipt(14, 'h14', [usage('F1_intent', 'lost')])],
      answers: [{ flow: 'F2_explain', seq: 2, usage: usage('F2_explain', 'old-f2') }, { flow: 'F2_explain', seq: 13, usage: usage('F2_explain', 'new-f2') }],
      events: [paid('h13', 1790600012, 'tx13')],
      generations: { old: null, new: gen('new', { createdAt: 1790600003 }), lost: null, 'old-f2': null, 'new-f2': gen('new-f2') },
      model: 'qwen3-32b',
      scope: { fromSeq: 13, fromAnswer: 2 },
    });
    expect(r.rows.map((x) => [x.generationId, x.status])).toEqual([['old', 'OTHER_ACCOUNT'], ['new', 'MATCH'], ['lost', 'NOT_FOUND'], ['old-f2', 'OTHER_ACCOUNT'], ['new-f2', 'MATCH']]);
    expect(r.counts).toEqual({ match: 2, differs: 0, notFound: 1, otherAccount: 2 });
  });

  it('a generation id missing from the generations map is NOT_FOUND (never assumed)', () => {
    const r = attest({ receipts: [receipt(1, 'h1', [usage('F1_intent', 'g1')])], answers: [], events: [], generations: {}, model: 'qwen3-32b' });
    expect(r.rows[0].status).toBe('NOT_FOUND');
  });
});

describe('attest v1.1 review: binding', () => {
  const offers = [{ merchant: 'TM', item: 'gpu-hours', unitPrice: 1_000_000, fee: 0, label: 'GPU Shop' }];
  it('one generation id backing two receipts is DIFFERS on both', () => {
    const r = attest({
      receipts: [receipt(1, 'h1', [usage('F1_intent', 'g1')]), receipt(2, 'h2', [usage('F1_intent', 'g1')])],
      answers: [], events: [paid('h1', 1790600012, 'tx1'), paid('h2', 1790600013, 'tx2')],
      generations: { g1: gen('g1', { createdAt: 1790600003 }) }, model: 'qwen3-32b',
    });
    expect(r.rows.map((x) => [x.seq, x.status, x.diffs])).toEqual([
      [1, 'DIFFERS', ['generation id also on receipt #2']], [2, 'DIFFERS', ['generation id also on receipt #1']],
    ]);
  });
  it('live 2026-09-29 run 4: one Kiln reply with three tool calls backs three receipts — allowed when each carries its own arguments', () => {
    const a = (to: string) => usage('F4_mcp_host', 'g1', { args: JSON.stringify({ to }) });
    const r = attest({
      receipts: [receipt(1, 'h1', [a('GPU Shop')]), receipt(2, 'h2', [a('Kiln credits')])],
      answers: [], events: [paid('h1', 1790600005, 'tx1'), paid('h2', 1790600009, 'tx2')],
      generations: { g1: gen('g1', { createdAt: 1790600000 }) }, model: 'qwen3-32b',
    });
    expect(r.rows.map((x) => x.status)).toEqual(['MATCH', 'MATCH']);
  });

  it('a model call more than 120 s before its payment is DIFFERS (an old call cannot back a new payment)', () => {
    const r = attest({ receipts: [receipt(1, 'h1', [usage('F1_intent', 'g1')])], answers: [], events: [paid('h1', 1790600300, 'tx1')], generations: { g1: gen('g1', { createdAt: 1790600000 }) }, model: 'qwen3-32b' });
    expect(r.rows[0]).toMatchObject({ status: 'DIFFERS', diffs: ['model call 300 s before the payment (limit 120 s)'] });
  });
  it('the model\'s own arguments in the receipt re-derive the payment (seller, item × quantity + fee from the catalog): bound, or DIFFERS', () => {
    const args = (a: object) => usage('F4_mcp_host', 'g1', { args: JSON.stringify(a) });
    const ok = attest({ receipts: [receipt(1, 'h1', [args({ to: 'GPU Shop', item: 'gpu-hours', quantity: 1 })])], answers: [], events: [paid('h1', 1790600005, 'tx1')], generations: { g1: gen('g1') }, model: 'qwen3-32b', offers });
    expect(ok.rows[0]).toMatchObject({ status: 'MATCH', argsBound: true });
    const bad = attest({ receipts: [receipt(1, 'h1', [args({ to: 'GPU Shop', item: 'gpu-hours', quantity: 3 })])], answers: [], events: [paid('h1', 1790600005, 'tx1')], generations: { g1: gen('g1') }, model: 'qwen3-32b', offers });
    expect(bad.rows[0]).toMatchObject({ status: 'DIFFERS', argsBound: false, diffs: ["payment differs from the model's arguments (3000000 + 0 ≠ 1000000 + 0)"] });
  });
});

describe('parseKilnGeneration (Kiln GET /v1/generations/{id}, shape measured 2026-09-29)', () => {
  it('maps the response fields and turns created_at into unix seconds', () => {
    const g = parseKilnGeneration({
      id: '14c26f4e-d054-4a97-8a1a-aad8b2d9c959', model: 'qwen3-32b', total_cost: 0.00002264, tokens_prompt: 320, tokens_completion: 35,
      cached_tokens: 319, latency_ms: 601, status_code: 200, created_at: '2026-09-29T03:03:22.799495Z',
    });
    expect(g).toEqual({ id: '14c26f4e-d054-4a97-8a1a-aad8b2d9c959', model: 'qwen3-32b', totalCost: 0.00002264, promptTokens: 320, completionTokens: 35, createdAt: 1790651002.799, latencyMs: 601, cachedTokens: 319 });
  });
});
