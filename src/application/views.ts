import { audit, type AuditResult, type ChainEvent, type Verdict } from '../domain/audit';
import type { BlockReason, Mandate } from '../domain/mandate';
import { usdt } from '../domain/money';
import type { Hasher, Receipt } from '../domain/receipt';
import { isKilnCall, type UsageRecord } from '../domain/tokenLedger';
import { countVerdicts, problemCount, type VerdictCounts } from './auditRecords';
import type { AnswerRecord } from './ports';

/**
 * View models for the 4 screens (R1). Every status shown is rebuilt by audit() from public records —
 * the UI never takes the operator's word for what happened. Pure: no DOM, no fetch, no clock.
 */
export type Session = { vault: string; network: 'nile'; receipts: Receipt[]; events: ChainEvent[]; generatedAt: number; answers?: AnswerRecord[] };

/** The public record the UI reads: receipts file + the vault's public events (+ the F2 / F3 answers log, which holds no key). */
export const sessionOf = (file: { receipts: Receipt[] }, vault: string, events: ChainEvent[], generatedAt: number, answers?: AnswerRecord[]): Session => ({
  vault,
  network: 'nile',
  receipts: file.receipts,
  events,
  generatedAt,
  ...(answers ? { answers } : {}),
});

// ── Kiln's words (AC-30) ────────────────────────────────────────────────────────
/** Answers-log keys are `F2v<n>:<id>` / `F3v<n>:<id>` (plain `F2:` = v1). The newest prompt version per id wins. */
const keyParts = (key: string) => {
  const m = key.match(/^(F[23])(?:v(\d+))?:(.*)$/);
  return m ? { id: `${m[1]}:${m[3]}`, version: Number(m[2] ?? 1) } : { id: key, version: 1 };
};
export function latestAnswers(all: AnswerRecord[]): AnswerRecord[] {
  const best = new Map<string, { a: AnswerRecord; version: number; at: number }>();
  all.forEach((a, at) => {
    const { id, version } = keyParts(a.key);
    const cur = best.get(id);
    if (!cur || version > cur.version || (version === cur.version && at > cur.at)) best.set(id, { a, version, at });
  });
  return [...best.values()].sort((x, y) => x.at - y.at).map((x) => x.a);
}
const echoes = (a: AnswerRecord, v: Verdict) => a.grounded && a.verdict === v.verdict && (a.reason ?? undefined) === (v.reason ?? undefined);

export const REASON_TEXT: Record<BlockReason, string> = {
  PAUSED: 'You pressed STOP',
  DEADLINE_PASSED: 'Your time window had closed',
  MERCHANT_NOT_ALLOWED: 'Seller is not on your list',
  INVALID_AMOUNT: 'Amount was zero or less',
  OVER_TX_CAP: 'Over your per-payment cap',
  OVER_BUDGET_WITH_FEES: 'Would pass your budget once fees are added',
  DUPLICATE_RECEIPT: 'This receipt was already used — the vault decides each receipt once',
};
export const txUrl = (tx: string) => `https://nile.tronscan.org/#/transaction/${tx}`;
export const isTronAddress = (s: string) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s); // format check; the vault is the real gate

// ── Grant (UC-1) ────────────────────────────────────────────────────────────────
export type GrantForm = { budget: string; perTxCap: string; merchants: string; deadline: number };
export type GrantField = 'budget' | 'perTxCap' | 'merchants' | 'deadline';
export type GrantDraft = { ok: true; mandate: Omit<Mandate, 'id'> } | { ok: false; errors: Partial<Record<GrantField, string>> };

export function grantDraft(f: GrantForm, now: number): GrantDraft {
  const errors: Partial<Record<GrantField, string>> = {};
  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.trim()));
  const budget = num(f.budget);
  const cap = num(f.perTxCap);
  if (!(budget > 0)) errors.budget = 'Enter a budget above 0 USDT';
  if (!(cap > 0)) errors.perTxCap = 'Enter a per-payment cap above 0 USDT';
  else if (budget > 0 && cap > budget) errors.perTxCap = "The per-payment cap can't be bigger than the budget";
  const merchants = f.merchants.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const bad = merchants.find((x) => !isTronAddress(x));
  if (!merchants.length) errors.merchants = 'Add at least one seller address';
  else if (bad) errors.merchants = `“${bad}” doesn't look like a TRON address (T + 33 letters or digits)`;
  if (!(f.deadline > now)) errors.deadline = 'Pick a time in the future';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, mandate: { budget: usdt(budget), perTxCap: usdt(cap), merchants, deadline: f.deadline, paused: false } };
}

// ── Feed (watching) ─────────────────────────────────────────────────────────────
export type RowStatus = 'paid' | 'stopped' | 'problem';
export type Row = { seq: number; at: number; words: string; amount: number; fee: number; merchant: string; status: RowStatus; reasonText: string; txHash?: string };
export type FeedView =
  | { kind: 'empty' }
  | { kind: 'feed'; spent: number; budget: number; left: number; deadline: number; state: 'open' | 'stopped' | 'expired'; stopTx?: string; lastStopTx?: string; rows: Row[]; problems: number };

const statusOf = (v: Verdict): RowStatus => (v.verdict === 'PAID_INSIDE' ? 'paid' : v.verdict === 'STOPPED' ? 'stopped' : 'problem');
const reasonOf = (v: Verdict): string =>
  v.verdict === 'PAID_INSIDE' ? 'Paid inside your line' : v.verdict === 'STOPPED' && v.reason ? REASON_TEXT[v.reason] : `Doesn't add up — ${v.why}`;
const lineOf = (v: Verdict): string => (v.verdict === 'PAID_INSIDE' ? 'Paid inside your line' : v.verdict === 'STOPPED' ? `Stopped on-chain: ${reasonOf(v)}` : `Doesn't add up — ${v.why}`);
const inOrder = (events: ChainEvent[]) => events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);

export function feedView(s: Session, hash: Hasher, now: number): FeedView {
  if (!s.receipts.length) return { kind: 'empty' };
  const res = audit({ mandates: [], receipts: s.receipts, events: s.events, hash });
  const bySeq = new Map(s.receipts.map((r) => [r.seq, r]));
  const rows: Row[] = [...res.verdicts].reverse().map((v) => {
    const r = bySeq.get(v.seq)!;
    return { seq: v.seq, at: r.request.at, words: r.asked ?? r.intentText, amount: r.request.amount, fee: r.request.fee, merchant: r.request.merchant, status: statusOf(v), reasonText: reasonOf(v), txHash: v.txHash };
  });
  // The line in force = the latest grant; spent restarts there, exactly as the vault counts it.
  let line: Mandate | undefined;
  let spent = 0;
  let stopTx: string | undefined;
  let lastStopTx: string | undefined; // vault-wide, survives re-grants: the recorded STOP the UI can point to
  for (const e of inOrder(s.events)) {
    if (e.kind === 'granted') [line, spent, stopTx] = [e.mandate, 0, undefined];
    else if (e.kind === 'paid') spent += e.amount + e.fee;
    else if (e.kind === 'paused') stopTx = lastStopTx = e.txHash;
    else if (e.kind === 'resumed') stopTx = undefined;
  }
  const budget = line?.budget ?? 0;
  const deadline = line?.deadline ?? 0;
  const state = stopTx ? 'stopped' : now > deadline ? 'expired' : 'open';
  return { kind: 'feed', spent, budget, left: Math.max(0, budget - spent), deadline, state, stopTx, lastStopTx, rows, problems: problemCount(res) };
}

// ── Receipt ─────────────────────────────────────────────────────────────────────
export type ReceiptView =
  | { kind: 'missing'; seq: number }
  | {
      kind: 'receipt';
      seq: number;
      amount: number;
      fee: number;
      total: number;
      status: RowStatus;
      line: string;
      words: string;
      /** whose words: the person's request, or (an MCP host that passed no request) the agent's own reason */
      wordsBy: 'person' | 'agent';
      merchant: string;
      at: number;
      txHash?: string;
      txUrl?: string;
      hash: string;
      prevHash: string;
      mandateId: string;
      flows: UsageRecord[];
      /** usage with a real Kiln generation id (AC-22) */
      kilnCalls: number;
      /** usage from the scripted stand-in of the template smoke — shown as such, never as Kiln */
      standInCalls: number;
      /** tokens of Kiln calls only */
      tokens: number;
      json: string;
      /** Kiln F2 words about this receipt — only when grounded and echoing the audit (AC-30) */
      why?: string;
    };

export function receiptView(s: Session, seq: number, hash: Hasher): ReceiptView {
  const r = s.receipts.find((x) => x.seq === seq);
  if (!r) return { kind: 'missing', seq };
  const v = audit({ mandates: [], receipts: s.receipts, events: s.events, hash }).verdicts.find((x) => x.seq === seq)!;
  const status = statusOf(v);
  const line = lineOf(v);
  const f2 = latestAnswers(s.answers ?? []).find((a) => a.flow === 'F2_explain' && a.seq === seq);
  return {
    kind: 'receipt',
    seq,
    amount: r.request.amount,
    fee: r.request.fee,
    total: r.request.amount + r.request.fee,
    status,
    line,
    words: r.asked ?? r.intentText, // v1.1: the person's request when an MCP host passed it; the model's reason stays in the receipt
    wordsBy: r.asked || r.flows.some((u) => u.flow === 'F1_intent') ? 'person' : 'agent',
    merchant: r.request.merchant,
    at: r.request.at,
    txHash: v.txHash,
    txUrl: v.txHash ? txUrl(v.txHash) : undefined,
    hash: r.hash,
    prevHash: r.prevHash,
    mandateId: r.mandateId,
    flows: r.flows,
    kilnCalls: r.flows.filter(isKilnCall).length,
    standInCalls: r.flows.filter((f) => !isKilnCall(f)).length,
    tokens: r.flows.filter(isKilnCall).reduce((n, f) => n + f.promptTokens + f.completionTokens, 0),
    json: JSON.stringify(r, null, 1),
    ...(f2 && echoes(f2, v) ? { why: f2.text } : {}),
  };
}

// ── Questions a teammate asked (F3, AC-30) ──────────────────────────────────────
export type QuestionRow = { question: string; seq: number | null; status?: RowStatus; line?: string; txHash?: string; answer: string };
export function questionsView(s: Session, hash: Hasher): QuestionRow[] {
  const verdicts = new Map(audit({ mandates: [], receipts: s.receipts, events: s.events, hash }).verdicts.map((v) => [v.seq, v]));
  const rows: QuestionRow[] = [];
  for (const a of latestAnswers(s.answers ?? [])) {
    if (a.flow !== 'F3_dispute' || !a.question || !a.grounded) continue;
    if (a.seq === null) {
      rows.push({ question: a.question, seq: null, answer: a.text });
      continue;
    }
    const v = verdicts.get(a.seq);
    if (!v || a.verdict !== v.verdict) continue; // the model picked a receipt that is not there, or did not echo the audit
    rows.push({ question: a.question, seq: a.seq, status: statusOf(v), line: lineOf(v), txHash: v.txHash, answer: a.text });
  }
  return rows;
}

// ── Audit ───────────────────────────────────────────────────────────────────────
export type AuditRow = { seq: number; label: string; status: RowStatus; reason?: BlockReason; reasonText: string; txHash?: string };
export type OrphanRow = { kind: 'paid' | 'blocked'; total: number; txHash: string; reasonText: string };
export type ReplayRow = { seq: number; total: number; txHash: string; reasonText: string };
export type AuditView = { problems: number; ok: boolean; chainLine: string; counts: VerdictCounts; totalPaid: number; rows: AuditRow[]; orphans: OrphanRow[]; replays: ReplayRow[] };

const LABEL: Record<Verdict['verdict'], string> = { PAID_INSIDE: 'Paid inside', STOPPED: 'Stopped', MISMATCH: 'Mismatch', NO_CHAIN_EVENT: 'Not on chain' };
export function auditView(res: AuditResult): AuditView {
  const problems = problemCount(res);
  return {
    problems,
    ok: problems === 0,
    chainLine: res.chain.ok ? 'Receipt chain intact — no receipt was edited, dropped or reordered' : `Receipt chain broken at #${res.chain.brokenAt} — a receipt was changed after it was sealed`,
    counts: countVerdicts(res.verdicts),
    totalPaid: res.totalPaid,
    rows: res.verdicts.map((v) => ({ seq: v.seq, label: LABEL[v.verdict], status: statusOf(v), reason: v.reason, reasonText: reasonOf(v), txHash: v.txHash })),
    orphans: res.unreceipted.map((u) => ({ kind: u.kind, total: u.amount + u.fee, txHash: u.txHash, reasonText: `On-chain spend with no receipt — ${u.why}` })),
    replays: (res.replays ?? []).map((x) => ({ seq: x.seq, total: x.amount + x.fee, txHash: x.txHash, reasonText: `Replay of receipt #${x.seq} — stopped on-chain, nothing paid` })),
  };
}
