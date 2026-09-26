import { estimateEnergy } from './energy';
import type { Intent } from './intent';
import { canonical } from './receipt';
import { isKilnCall, type Flow, type UsageRecord } from './tokenLedger';

/** Token / cost / latency / Wh per flow (AC-26) and the /no_think A/B summary (AC-27). Pure: numbers in, numbers out. */
export const FLOWS: Flow[] = ['F1_intent', 'F2_explain', 'F3_dispute'];

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type FlowRow = {
  flow: Flow | 'total';
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMedianMs: number;
  latencyTotalMs: number;
  wh: number;
  whPerCall: number;
  generationIds: string[];
};
export type FlowReport = { rows: FlowRow[]; total: FlowRow; standIns: number; purchases: number; callsPerPurchase: number; npuWatts: number; assumption: string };

function row(flow: FlowRow['flow'], rs: UsageRecord[], npuWatts: number): FlowRow {
  const sum = (f: (r: UsageRecord) => number) => rs.reduce((n, r) => n + f(r), 0);
  const latencyTotalMs = sum((r) => r.latencyMs);
  const wh = estimateEnergy({ latencyMs: latencyTotalMs, npuWatts }).wh;
  return {
    flow,
    calls: rs.length,
    promptTokens: sum((r) => r.promptTokens),
    completionTokens: sum((r) => r.completionTokens),
    totalTokens: sum((r) => r.promptTokens + r.completionTokens),
    costUsd: sum((r) => r.costUsd),
    latencyMedianMs: median(rs.map((r) => r.latencyMs)),
    latencyTotalMs,
    wh,
    whPerCall: rs.length ? wh / rs.length : 0,
    generationIds: rs.map((r) => r.generationId),
  };
}

/** Only usage with a real Kiln generation id is counted (AC-22); `purchases` = receipts (one F1 each by design). */
export function flowReport(records: UsageRecord[], o: { purchases: number; npuWatts?: number }): FlowReport {
  const npuWatts = o.npuWatts ?? 180;
  const kiln = records.filter(isKilnCall);
  const rows = FLOWS.map((f) => row(f, kiln.filter((r) => r.flow === f), npuWatts));
  const f1 = rows[0].calls;
  return {
    rows,
    total: row('total', kiln, npuWatts),
    standIns: records.length - kiln.length,
    purchases: o.purchases,
    callsPerPurchase: o.purchases ? f1 / o.purchases : 0,
    npuWatts,
    assumption: estimateEnergy({ latencyMs: 0, npuWatts }).assumption,
  };
}

// ── /no_think A/B ──────────────────────────────────────────────────────────────
export type AbRun = { usage: UsageRecord; intent: Intent | null; error?: string };
export type AbPair = { request: string; off: AbRun; on: AbRun };
export type AbArm = { n: number; parsed: number; parseRate: number; medianCompletion: number; medianPrompt: number; medianLatencyMs: number; medianWh: number; costUsd: number };
export type AbSummary = { n: number; off: AbArm; on: AbArm; sameJson: number; sameJsonRate: number; completionSavedPct: number; latencySavedPct: number; note?: string };

/** The fields that drive the money decision; the free-text note is not compared. */
export const intentKey = (i: Intent) => canonical({ item: i.item, quantity: i.quantity, maxUnitPrice: i.maxUnitPrice, merchantHint: i.merchantHint });

function arm(runs: AbRun[], npuWatts: number): AbArm {
  const parsed = runs.filter((r) => r.intent).length;
  const medianLatencyMs = median(runs.map((r) => r.usage.latencyMs));
  return {
    n: runs.length,
    parsed,
    parseRate: runs.length ? parsed / runs.length : 0,
    medianCompletion: median(runs.map((r) => r.usage.completionTokens)),
    medianPrompt: median(runs.map((r) => r.usage.promptTokens)),
    medianLatencyMs,
    medianWh: estimateEnergy({ latencyMs: medianLatencyMs, npuWatts }).wh,
    costUsd: runs.reduce((n, r) => n + r.usage.costUsd, 0),
  };
}

export function abSummary(pairs: AbPair[], npuWatts = 180): AbSummary {
  const off = arm(pairs.map((p) => p.off), npuWatts);
  const on = arm(pairs.map((p) => p.on), npuWatts);
  const sameJson = pairs.filter((p) => p.off.intent && p.on.intent && intentKey(p.off.intent) === intentKey(p.on.intent)).length;
  const saved = (a: number, b: number) => (b ? (1 - a / b) * 100 : 0);
  return {
    n: pairs.length,
    off,
    on,
    sameJson,
    sameJsonRate: pairs.length ? sameJson / pairs.length : 0,
    completionSavedPct: saved(off.medianCompletion, on.medianCompletion),
    latencySavedPct: saved(off.medianLatencyMs, on.medianLatencyMs),
    note: pairs.length < 10 ? 'n below 10' : undefined,
  };
}
