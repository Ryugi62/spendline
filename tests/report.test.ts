import { describe, expect, it } from 'vitest';
import { formatFlowReport } from '../src/application/report';
import { flowReport, median } from '../src/domain/flowReport';
import type { UsageRecord } from '../src/domain/tokenLedger';

const u = (flow: UsageRecord['flow'], p: number, c: number, ms: number, gen: string, cost = 0.00002): UsageRecord => ({ flow, promptTokens: p, completionTokens: c, costUsd: cost, latencyMs: ms, generationId: gen });
const records = [
  u('F1_intent', 120, 40, 2000, 'g1'),
  u('F1_intent', 130, 50, 1000, 'g2'),
  u('F1_intent', 110, 30, 3000, 'g3'),
  u('F2_explain', 350, 60, 1800, 'g4'),
  u('F3_dispute', 900, 50, 3600, 'g5'),
  u('F1_intent', 78, 9, 0, 'fake-1', 0), // stand-in: never counted
];

describe('AC-26 per-flow Kiln report (M0-11)', () => {
  it('median of odd / even / empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('per flow: calls, tokens, USD, median + total latency, Wh at 180 W × wall time; stand-ins excluded and counted', () => {
    const r = flowReport(records, { purchases: 3 });
    expect(r.standIns).toBe(1);
    const f1 = r.rows.find((x) => x.flow === 'F1_intent')!;
    expect(f1).toMatchObject({ calls: 3, promptTokens: 360, completionTokens: 120, totalTokens: 480, latencyMedianMs: 2000, latencyTotalMs: 6000, generationIds: ['g1', 'g2', 'g3'] });
    expect(f1.wh).toBeCloseTo((180 * 6) / 3600, 10);
    expect(f1.whPerCall).toBeCloseTo(f1.wh / 3, 10);
    expect(f1.costUsd).toBeCloseTo(0.00006, 12);
    expect(r.rows.map((x) => x.flow)).toEqual(['F1_intent', 'F2_explain', 'F3_dispute']);
    expect(r.total).toMatchObject({ calls: 5, totalTokens: 480 + 410 + 950 });
    expect(r.total.wh).toBeCloseTo((180 * (6 + 1.8 + 3.6)) / 3600, 10);
    expect(r.callsPerPurchase).toBe(1);
    expect(r.assumption).toMatch(/180 W/);
  });

  it('a flow with no calls is still a row (0), so the table always shows F1 · F2 · F3', () => {
    const r = flowReport([u('F1_intent', 1, 1, 1000, 'g')], { purchases: 1 });
    expect(r.rows.map((x) => [x.flow, x.calls])).toEqual([['F1_intent', 1], ['F2_explain', 0], ['F3_dispute', 0]]);
  });

  it('markdown: one row per flow + total, the assumption sentence next to the Wh numbers, calls per purchase, generation ids', () => {
    const md = formatFlowReport(flowReport(records, { purchases: 3 }), { title: 'Test run', sources: ['a.jsonl'], wattsSource: 'RNGD TDP' });
    expect(md).toMatch(/^# Test run/);
    expect(md).toMatch(/\| F1 intent \| .* \| 3 \| 360 \| 120 \| 480 \| \$0\.0000600 \| 2\.00 s \| 6\.00 s \| 0\.3000 \| 0\.1000 \|/);
    expect(md).toMatch(/\| \*\*Total\*\* \| \| \*\*5\*\* \|/);
    expect(md).toMatch(/Stand-in usage excluded: 1 record/);
    expect(md).toMatch(/LLM calls per purchase: \*\*1\.00\*\*/);
    expect(md).toMatch(/assumption, not a measurement/i);
    expect(md).toMatch(/RNGD TDP/);
    expect(md).toContain('g5');
  });
});
