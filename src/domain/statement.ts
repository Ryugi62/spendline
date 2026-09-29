// AC-41 statement — the lead's weekly expense statement, every line taken from the audit (never from the app's own claims).
// AC-42 tune — what a candidate line would have done to the same requests, with the vault's own rule (evaluate()).
import type { Verdict } from './audit';
import { evaluate, type BlockReason, type Mandate } from './mandate';
import type { Receipt } from './receipt';
import { isKilnCall } from './tokenLedger';
import { sellerNamedIn } from './intent';
import { usdt } from './money';

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
  /** v1.1: the words named a catalog seller and the money went to another */
  intent?: string;
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
  /** v1.1: refused attempts counted once per (words, seller, amount) · repeats refused on-chain as replays · intent flags */
  refusedDistinct: number;
  replays: number;
  intentFlags: number;
};

export function buildStatement(o: { receipts: Receipt[]; verdicts: Verdict[]; labels: Record<string, string>; offers?: { merchant: string; label: string }[]; replays?: number }): Statement {
  const verdictOf = new Map(o.verdicts.map((v) => [v.seq, v]));
  const lines: StatementLine[] = [...o.receipts].sort((a, b) => a.seq - b.seq).map((r) => {
    const v = verdictOf.get(r.seq);
    const words = r.asked ?? r.intentText;
    const named = o.offers ? sellerNamedIn(words, o.offers) : undefined;
    const intent = named && named !== r.request.merchant ? { intent: `words named ${o.labels[named] ?? named}` } : {};
    const base = { seq: r.seq, at: r.request.at, seller: o.labels[r.request.merchant] ?? r.request.merchant, merchant: r.request.merchant, words, amount: r.request.amount, fee: r.request.fee, receiptHash: r.hash, ...(v?.txHash ? { txHash: v.txHash } : {}), ...intent };
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
  const seen = new Set<string>();
  const calls = o.receipts.flatMap((r) => r.flows).filter(isKilnCall).filter((u) => !seen.has(u.generationId) && !!seen.add(u.generationId));
  return {
    lines,
    paidBySeller: group(paid, (l) => l.seller).map(([seller, xs]) => ({ seller, count: xs.length, total: sum(xs) })),
    stopsByReason: group(stopped, (l) => l.reason ?? '').map(([reason, xs]) => ({ reason, count: xs.length, kept: sum(xs) })).sort((a, b) => a.reason.localeCompare(b.reason)),
    totalPaid: sum(paid),
    totalKept: sum(stopped),
    problems: lines.filter((l) => l.verdict === 'PROBLEM').length,
    kilnCalls: calls.length,
    kilnUsd: calls.reduce((n, u) => n + u.costUsd, 0),
    refusedDistinct: new Set(stopped.map((l) => `${l.words.trim().toLowerCase()}|${l.merchant}|${l.amount + l.fee}`)).size,
    replays: o.replays ?? 0,
    intentFlags: lines.filter((l) => l.intent).length,
  };
}

/** The part of a line you tune: how much in total, how much per payment, to whom. Time and STOP are not tuned here. */
export type CandidateLine = Pick<Mandate, 'budget' | 'perTxCap' | 'merchants'>;
export type TuneRow = { seq: number; seller: string; amount: number; fee: number; recorded: string; candidate: string };
export type TuneResult = { rows: TuneRow[]; changed: TuneRow[]; candidateTotals: { paid: number; stopped: number; spent: number }; /** the smallest line that pays exactly the recorded paid requests */ suggestion: { budget: number; perTxCap: number } };
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
  const recPaid = rows.filter((x) => x.recorded === 'PAID').map((x) => x.amount + x.fee);
  return { rows, changed: rows.filter((x) => x.recorded !== x.candidate), candidateTotals: { paid, stopped: rows.length - paid, spent }, suggestion: { budget: recPaid.reduce((n, x) => n + x, 0), perTxCap: recPaid.length ? Math.max(...recPaid) : 0 } };
}

/** What a lead writes (`budget_usdt`, `per_payment_cap_usdt`, `sellers` by name or address), or the Grant screen's micro-USDT JSON. */
export function parseCandidate(j: Record<string, unknown>, labels: Record<string, string>): CandidateLine | string {
  if (typeof j.budget === 'number' && typeof j.perTxCap === 'number' && Array.isArray(j.merchants)) return { budget: j.budget, perTxCap: j.perTxCap, merchants: j.merchants as string[] };
  const byName = new Map(Object.entries(labels).map(([a, n]) => [n.toLowerCase(), a]));
  const merchants: string[] = [];
  for (const x of (j.sellers as unknown[]) ?? []) {
    const t = String(x).trim();
    const a = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(t) ? t : byName.get(t.toLowerCase());
    if (!a) return `unknown seller "${t}" — use a catalog name or a TRON address`;
    merchants.push(a);
  }
  const b = Number(j.budget_usdt), c = Number(j.per_payment_cap_usdt);
  if (!(b > 0) || !(c > 0)) return 'budget_usdt and per_payment_cap_usdt must be numbers more than 0';
  return { budget: usdt(b), perTxCap: usdt(c), merchants };
}
