import { describe, expect, it } from 'vitest';
import { formatHostRuns, hostRunsSummary } from '../src/application/report';

// AC-44: the MCP host's Kiln calls are counted too — a generic host spends more calls and tokens per payment than F1.
const u = (id: string, p: number, c: number, cost: number) => ({ flow: 'F1_intent' as const, promptTokens: p, completionTokens: c, costUsd: cost, latencyMs: 1000, generationId: id });
const runs = [
  { calls: [u('a', 647, 170, 0.0001), u('b', 855, 73, 0.00006), u('c', 932, 42, 0.00005)], steps: [{ tool: 'spendline_pay', isError: false, generationId: 'a' }, { tool: 'spendline_pay', isError: true, generationId: 'b' }] },
  { calls: [u('d', 654, 183, 0.00008), u('e', 874, 51, 0.00006), u('f', 1098, 56, 0.00007), u('g', 1328, 68, 0.00008)], steps: [{ tool: 'spendline_pay', isError: false, generationId: 'd' }, { tool: 'spendline_pay', isError: false, generationId: 'e' }, { tool: 'spendline_pay', isError: false, generationId: 'f' }] },
];

describe('hostRunsSummary (AC-44)', () => {
  it('runs, Kiln calls, payments that reached the vault, calls per payment, median prompt tokens', () => {
    expect(hostRunsSummary(runs)).toEqual({ runs: 2, calls: 7, payments: 4, noPayment: 3, callsPerPayment: 1.75, medianPromptTokens: 874, tokens: 7031, costUsd: 0.00050, completed: 2, dropped: 0, refused: 1, newReceipts: 0, paid: 0, repeatCalls: 0 });
  });
  it('formats one line for docs/tokens-by-flow.md', () => {
    const withText = runs.map((r) => ({ ...r, steps: r.steps.map((x, i) => ({ ...x, text: x.isError ? 'unknown seller' : JSON.stringify(i === 1 && x.generationId === 'e' ? { ok: false, reason: 'DUPLICATE_RECEIPT', replay_of: 1 } : { ok: true, receipt_seq: i + 1 }) })) }));
    const line = formatHostRuns(hostRunsSummary(withText), { f1MedianPrompt: 320 });
    expect(line).toContain('7 Kiln calls');
    expect(line).toContain('3 new receipts (**2.33 calls per receipt**), 3 paid (2.33 per paid purchase), 3.50 per request; 4 pay attempts reached the vault, 1 of them repeats refused on-chain; 1 Kiln calls were spent only on a repeat.');
  });
});

describe('hostRunsSummary counts a run whose last reply was a pay call the host could not parse (live runs 1–2)', () => {
  it('dropped, not completed', () => {
    const h = hostRunsSummary([{ calls: [u('x', 1, 1, 0)], steps: [], answer: 'spendline_pay({"to":"Kiln credits"})' }, { calls: [u('y', 1, 1, 0)], steps: [], answer: 'Paid.' }]);
    expect([h.completed, h.dropped]).toEqual([1, 1]);
  });
});
