import { median } from './flowReport';

/** What a vault decision cost on-chain (TRON `gettransactioninfobyid`: fee in sun, energy used). Pure. */
export type TxCost = { txHash: string; kind: 'paid' | 'stopped'; feeSun: number; energy: number };
type TxInfo = { id: string; fee?: number; receipt?: { energy_usage_total?: number } };

export const txCostOf = (info: TxInfo, kind: TxCost['kind']): TxCost => ({ txHash: info.id, kind, feeSun: info.fee ?? 0, energy: info.receipt?.energy_usage_total ?? 0 });

const SUN_PER_TRX = 1_000_000;
export function chainCostSummary(costs: TxCost[]) {
  const of = (kind: TxCost['kind']) => {
    const xs = costs.filter((c) => c.kind === kind);
    return { n: xs.length, medianTrx: median(xs.map((c) => c.feeSun)) / SUN_PER_TRX, medianEnergy: median(xs.map((c) => c.energy)) };
  };
  return { paid: of('paid'), stopped: of('stopped') };
}
