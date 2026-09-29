// AC-40 — two witnesses per decision. TRON holds the money (the pay() event carries the receipt hash); the receipt hash commits
// to the Kiln generation id, tokens and cost of the model call behind it; Kiln's own record of that generation is the second witness.
// Pure: the Kiln answers come in as data (fetched live by an adapter, or read back from the saved file).
import type { ChainEvent } from './audit';
import type { Receipt } from './receipt';
import { isKilnCall, type Flow, type UsageRecord } from './tokenLedger';

/** Kiln's record of one generation (GET /v1/generations/{id}), in our units: createdAt = unix seconds. */
export type KilnGeneration = { id: string; model: string; totalCost: number; promptTokens: number; completionTokens: number; createdAt: number; latencyMs?: number };
/** OTHER_ACCOUNT: Kiln shows a generation only to the account that made it — a call outside the asking account's scope that Kiln does not show. */
export type AttestStatus = 'MATCH' | 'DIFFERS' | 'NOT_FOUND' | 'OTHER_ACCOUNT';
export type AttestRow = {
  flow: Flow;
  seq: number | null;
  question?: string;
  generationId: string;
  status: AttestStatus;
  diffs: string[];
  /** F1: when Kiln says the call was made · the block time of the pay() event for this receipt · pay minus Kiln, seconds */
  kilnAt?: number;
  payAt?: number;
  leadSec?: number;
  txHash?: string;
  kilnLatencyMs?: number;
};
export type AttestAnswer = { flow: Flow; seq: number | null; question?: string; usage?: UsageRecord };
export type AttestResult = { rows: AttestRow[]; counts: { match: number; differs: number; notFound: number; otherAccount: number } };
/** Which calls the asking Kiln account made: receipts from `fromSeq`, answers from log line `fromAnswer` (1-based). Absent = all. */
export type AccountScope = { fromSeq: number; fromAnswer: number };

const COST_EPS = 1e-9;

function compare(u: UsageRecord, g: KilnGeneration | null | undefined, model: string): Pick<AttestRow, 'status' | 'diffs' | 'kilnLatencyMs'> {
  if (!g) return { status: 'NOT_FOUND', diffs: [] };
  const diffs: string[] = [];
  if (g.model !== model) diffs.push(`model ${g.model} ≠ ${model}`);
  if (g.promptTokens !== u.promptTokens) diffs.push(`input tokens ${u.promptTokens} ≠ Kiln ${g.promptTokens}`);
  if (g.completionTokens !== u.completionTokens) diffs.push(`output tokens ${u.completionTokens} ≠ Kiln ${g.completionTokens}`);
  if (Math.abs(g.totalCost - u.costUsd) > COST_EPS) diffs.push(`cost ${u.costUsd} ≠ Kiln ${g.totalCost}`);
  return { status: diffs.length ? 'DIFFERS' : 'MATCH', diffs, ...(g.latencyMs !== undefined ? { kilnLatencyMs: g.latencyMs } : {}) };
}

export function attest(o: { receipts: Receipt[]; answers: AttestAnswer[]; events: ChainEvent[]; generations: Record<string, KilnGeneration | null>; model: string; scope?: AccountScope }): AttestResult {
  const outside = (row: AttestRow, inScope: boolean) => (row.status === 'NOT_FOUND' && !inScope ? { ...row, status: 'OTHER_ACCOUNT' as const } : row);
  const firstEvent = new Map<string, Extract<ChainEvent, { receiptHash: string }>>();
  for (const e of o.events) if ((e.kind === 'paid' || e.kind === 'blocked') && !firstEvent.has(e.receiptHash)) firstEvent.set(e.receiptHash, e);
  const rows: AttestRow[] = [];
  for (const r of o.receipts) {
    const ev = firstEvent.get(r.hash);
    for (const u of r.flows) {
      if (!isKilnCall(u)) continue;
      const g = o.generations[u.generationId];
      const row: AttestRow = { flow: u.flow, seq: r.seq, generationId: u.generationId, ...compare(u, g, o.model) };
      if (ev) Object.assign(row, { payAt: ev.at, txHash: ev.txHash });
      if (g) {
        row.kilnAt = g.createdAt;
        if (ev) {
          row.leadSec = Math.round(ev.at - g.createdAt);
          if (ev.at < g.createdAt) {
            row.diffs.push(`model call after the payment (${Math.round(g.createdAt - ev.at)} s)`);
            row.status = 'DIFFERS';
          }
        }
      }
      rows.push(outside(row, !o.scope || r.seq >= o.scope.fromSeq));
    }
  }
  o.answers.forEach((a, i) => {
    if (!a.usage || !isKilnCall(a.usage)) return;
    const row: AttestRow = { flow: a.flow, seq: a.seq, ...(a.question ? { question: a.question } : {}), generationId: a.usage.generationId, ...compare(a.usage, o.generations[a.usage.generationId], o.model) };
    rows.push(outside(row, !o.scope || i + 1 >= o.scope.fromAnswer));
  });
  const n = (s: AttestStatus) => rows.filter((x) => x.status === s).length;
  return { rows, counts: { match: n('MATCH'), differs: n('DIFFERS'), notFound: n('NOT_FOUND'), otherAccount: n('OTHER_ACCOUNT') } };
}
