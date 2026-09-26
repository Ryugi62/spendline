import { describe, expect, it } from 'vitest';
import { formatAb } from '../src/application/report';
import { abSummary, intentKey, type AbPair } from '../src/domain/flowReport';
import type { UsageRecord } from '../src/domain/tokenLedger';

const u = (c: number, ms: number): UsageRecord => ({ flow: 'F1_intent', promptTokens: 120, completionTokens: c, costUsd: 0.00001, latencyMs: ms, generationId: `g${c}-${ms}` });
const i = (q: number, hint?: string) => ({ item: 'gpu-hours', quantity: q, ...(hint ? { merchantHint: hint } : {}) });
const pair = (off: [number, number, object | null], on: [number, number, object | null]): AbPair => ({
  request: 'r',
  off: { usage: u(off[0], off[1]), intent: off[2] as never },
  on: { usage: u(on[0], on[1]), intent: on[2] as never },
});

describe('AC-27 /no_think A/B (M0-12)', () => {
  it('intentKey ignores the free-text note, keeps the fields that drive money', () => {
    expect(intentKey({ ...i(2), note: 'a' })).toBe(intentKey({ ...i(2), note: 'b' }));
    expect(intentKey(i(2))).not.toBe(intentKey(i(3)));
    expect(intentKey(i(2, 'TX'))).not.toBe(intentKey(i(2)));
  });

  it('per arm: n, parse rate, median completion tokens, latency and Wh; share of identical intents; n < 10 flagged', () => {
    const pairs = [pair([40, 1000, i(2)], [300, 5000, i(2)]), pair([50, 2000, i(1)], [500, 6000, i(1, 'TX')]), pair([60, 3000, i(2)], [700, 7000, null])];
    const s = abSummary(pairs);
    expect(s.n).toBe(3);
    expect(s.note).toBe('n below 10');
    expect(s.off).toMatchObject({ n: 3, parsed: 3, parseRate: 1, medianCompletion: 50, medianLatencyMs: 2000 });
    expect(s.on).toMatchObject({ n: 3, parsed: 2, medianCompletion: 500, medianLatencyMs: 6000 });
    expect(s.on.parseRate).toBeCloseTo(2 / 3, 10);
    expect(s.off.medianWh).toBeCloseTo((180 * 2) / 3600, 10);
    expect(s.sameJson).toBe(1); // pair 1 same; pair 2 differs (hint); pair 3 the thinking arm did not parse
    expect(s.sameJsonRate).toBeCloseTo(1 / 3, 10);
    expect(s.completionSavedPct).toBeCloseTo(90, 5); // 1 - 50/500
    expect(s.latencySavedPct).toBeCloseTo(66.6667, 3);
    expect(abSummary([...pairs, ...pairs, ...pairs, pairs[0]]).note).toBeUndefined();
  });

  it('markdown section names both arms, the medians, the identical-intent share and n', () => {
    const md = formatAb(abSummary([pair([40, 1000, i(2)], [300, 5000, i(2)])]), { file: 'docs/ab.json', date: '2026-09-26' });
    expect(md).toMatch(/## \/no_think A\/B — n = 1 pairs \(n below 10\)/);
    expect(md).toMatch(/\| `\/no_think` \(production\) \| 1 \| 100% \| 40 \| 1\.00 s \| 0\.0500 \|/);
    expect(md).toMatch(/\| thinking on \| 1 \| 100% \| 300 \| 5\.00 s \| 0\.2500 \|/);
    expect(md).toMatch(/Same JSON \(item · quantity · price cap · seller hint\): 1 \/ 1/);
  });
});
