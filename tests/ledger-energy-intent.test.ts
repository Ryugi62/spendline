import { describe, expect, it } from 'vitest';
import { summarize, type UsageRecord } from '../src/domain/tokenLedger';
import { estimateEnergy } from '../src/domain/energy';
import { parseIntent, IntentError } from '../src/domain/intent';

describe('token ledger (AC-7)', () => {
  it('sums per flow and the total equals the sum of flows', () => {
    const rs: UsageRecord[] = [
      { flow: 'F1_intent', promptTokens: 300, completionTokens: 40, costUsd: 0.00003, latencyMs: 900, generationId: 'g1' },
      { flow: 'F1_intent', promptTokens: 310, completionTokens: 42, costUsd: 0.00003, latencyMs: 950, generationId: 'g2' },
      { flow: 'F2_explain', promptTokens: 500, completionTokens: 120, costUsd: 0.00008, latencyMs: 2100, generationId: 'g3' },
    ];
    const s = summarize(rs);
    expect(s.byFlow.F1_intent).toMatchObject({ calls: 2, promptTokens: 610, completionTokens: 82, latencyMs: 1850 });
    expect(s.byFlow.F2_explain.calls).toBe(1);
    expect(s.total.promptTokens).toBe(1110);
    expect(s.total.completionTokens).toBe(202);
    expect(s.total.calls).toBe(3);
  });
});

describe('energy estimate (AC-8)', () => {
  it('Wh = watts × seconds / 3600 and carries its assumption', () => {
    const e = estimateEnergy({ latencyMs: 3_600_000 / 180, npuWatts: 180 });
    expect(e.wh).toBeCloseTo(1, 9);
    expect(e.assumption).toMatch(/180 W/);
  });
});

describe('parseIntent (AC-9) — Kiln has no response_format', () => {
  it('extracts the JSON object from prose and validates fields', () => {
    const txt = 'Sure! Here it is:\n```json\n{"item":"gpu-hours","quantity":2,"maxUnitPrice":2.5,"note":"fine-tune"}\n```';
    expect(parseIntent(txt)).toEqual({ item: 'gpu-hours', quantity: 2, maxUnitPrice: 2.5, note: 'fine-tune' });
  });
  it('throws a typed error when no valid object is present', () => {
    expect(() => parseIntent('I cannot help')).toThrow(IntentError);
    expect(() => parseIntent('{"item":"x","quantity":-1}')).toThrow(IntentError);
  });
});
