// AC-41 statement — the lead's weekly expense statement, every line taken from the audit (never from the app's own claims).
// AC-42 tune — what a candidate line would have done to the same requests, with the vault's own rule (evaluate()).
import type { Verdict } from './audit';
import { evaluate, type BlockReason, type Mandate } from './mandate';
import type { Receipt } from './receipt';
import { isKilnCall } from './tokenLedger';

export type StatementLine = {
  seq: number;
  at: number;
  seller: string;
  merchant: string;
  words: string;
  amount: number;
  fee: number;
  verdict: 'PAID' | 'STOPPED' | 'PROBLEM';
  /** STOPPED: the on-chain reason · PROBLEM: the audit's verdict (MISMATCH / NO_CHAIN_EVENT) */
  reason?: string;
  txHash?: string;
  receiptHash: string;
};
export type Statement = {
  lines: StatementLine[];
  paidBySeller: { seller: string; count: number; total: number }[];
  stopsByReason: { reason: string; count: number; kept: number }[];
  totalPaid: number;
  totalKept: number;
  problems: number;
  kilnCalls: number;
  kilnUsd: number;
};

export function buildStatement(o: { receipts: Receipt[]; verdicts: Verdict[]; labels: Record<string, string> }): Statement {
  const verdictOf = new Map(o.verdicts.map((v) => [v.seq, v]));
  const lines: StatementLine[] = [...o.receipts].sort((a, b) => a.seq - b.seq).map((r) => {
    const v = verdictOf.get(r.seq);
    const base = { seq: r.seq, at: r.request.at, seller: o.labels[r.request.merchant] ?? r.request.merchant, merchant: r.request.merchant, words: r.intentText, amount: r.request.amount, fee: r.request.fee, receiptHash: r.hash, ...(v?.txHash ? { txHash: v.txHash } : {}) };
    if (v?.verdict === 'PAID_INSIDE') return { ...base, verdict: 'PAID' as const };
    if (v?.verdict === 'STOPPED') return { ...base, verdict: 'STOPPED' as const, reason: v.reason };
    return { ...base, verdict: 'PROBLEM' as const, reason: v?.verdict ?? 'NO_AUDIT_VERDICT' };
  });
  const group = <K extends string>(xs: StatementLine[], key: (l: StatementLine) => K) => {
    const m = new Map<K, StatementLine[]>();
    for (const l of xs) m.set(key(l), [...(m.get(key(l)) ?? []), l]);
    return [...m.entries()];
  };
  const sum = (xs: StatementLine[]) => xs.reduce((n, l) => n + l.amount + l.fee, 0);
  const paid = lines.filter((l) => l.verdict === 'PAID');
  const stopped = lines.filter((l) => l.verdict === 'STOPPED');
  const calls = o.receipts.flatMap((r) => r.flows).filter(isKilnCall);
  return {
    lines,
    paidBySeller: group(paid, (l) => l.seller).map(([seller, xs]) => ({ seller, count: xs.length, total: sum(xs) })),
    stopsByReason: group(stopped, (l) => l.reason ?? '').map(([reason, xs]) => ({ reason, count: xs.length, kept: sum(xs) })).sort((a, b) => a.reason.localeCompare(b.reason)),
    totalPaid: sum(paid),
    totalKept: sum(stopped),
    problems: lines.filter((l) => l.verdict === 'PROBLEM').length,
    kilnCalls: calls.length,
    kilnUsd: calls.reduce((n, u) => n + u.costUsd, 0),
  };
}

/** The part of a line you tune: how much in total, how much per payment, to whom. Time and STOP are not tuned here. */
export type CandidateLine = Pick<Mandate, 'budget' | 'perTxCap' | 'merchants'>;
export type TuneRow = { seq: number; seller: string; amount: number; fee: number; recorded: string; candidate: string };
export type TuneResult = { rows: TuneRow[]; changed: TuneRow[]; candidateTotals: { paid: number; stopped: number; spent: number } };
const CARRIED: readonly BlockReason[] = ['PAUSED', 'DEADLINE_PASSED'];

export function tune(o: { receipts: Receipt[]; verdicts: Verdict[]; candidate: CandidateLine }): TuneResult {
  const verdictOf = new Map(o.verdicts.map((v) => [v.seq, v]));
  const line: Mandate = { id: 'candidate', ...o.candidate, deadline: Number.MAX_SAFE_INTEGER, paused: false };
  let spent = 0;
  const rows: TuneRow[] = [...o.receipts].sort((a, b) => a.seq - b.seq).map((r) => {
    const v = verdictOf.get(r.seq);
    const recorded = v?.verdict === 'PAID_INSIDE' ? 'PAID' : v?.verdict === 'STOPPED' ? (v.reason ?? 'STOPPED') : (v?.verdict ?? 'NO_AUDIT_VERDICT');
    let candidate: string;
    if (v?.verdict === 'STOPPED' && v.reason && CARRIED.includes(v.reason)) candidate = v.reason;
    else {
      const d = evaluate(line, spent, r.request);
      if (d.kind === 'allow') {
        spent += r.request.amount + r.request.fee;
        candidate = 'PAID';
      } else candidate = d.reason;
    }
    return { seq: r.seq, seller: r.request.merchant, amount: r.request.amount, fee: r.request.fee, recorded, candidate };
  });
  const paid = rows.filter((x) => x.candidate === 'PAID').length;
  return { rows, changed: rows.filter((x) => x.recorded !== x.candidate), candidateTotals: { paid, stopped: rows.length - paid, spent } };
}
