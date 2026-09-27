import { describe, expect, it } from 'vitest';
import { chainCostSummary, txCostOf } from '../src/domain/chainCost';

// M1 review (VC view): what one guarded decision costs, from public tx info (keyless) — measured, not assumed.
describe('chain cost per decision', () => {
  it('reads fee and energy from TRON tx info (shape measured on Nile 2026-09-28)', () => {
    const info = { id: 'e67c', fee: 8513800, receipt: { energy_fee: 8102800, energy_usage_total: 81028, net_fee: 411000, result: 'SUCCESS' } };
    expect(txCostOf(info, 'paid')).toEqual({ txHash: 'e67c', kind: 'paid', feeSun: 8513800, energy: 81028 });
    expect(txCostOf({ id: 'x' }, 'stopped')).toEqual({ txHash: 'x', kind: 'stopped', feeSun: 0, energy: 0 });
  });
  it('median TRX and energy per kind; a stop costs less than a payment and is still recorded', () => {
    const s = chainCostSummary([
      { txHash: 'a', kind: 'paid', feeSun: 8_500_000, energy: 81_000 },
      { txHash: 'b', kind: 'paid', feeSun: 7_000_000, energy: 66_000 },
      { txHash: 'c', kind: 'stopped', feeSun: 2_800_000, energy: 24_000 },
    ]);
    expect(s.paid).toEqual({ n: 2, medianTrx: 7.75, medianEnergy: 73_500 });
    expect(s.stopped).toEqual({ n: 1, medianTrx: 2.8, medianEnergy: 24_000 });
  });
});
