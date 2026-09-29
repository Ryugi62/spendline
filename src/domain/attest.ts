// AC-40 — two witnesses per decision. TRON holds the money (the pay() event carries the receipt hash); the receipt hash commits
// to the Kiln generation id, tokens and cost of the model call behind it; Kiln's own record of that generation is the second witness.
// Pure: the Kiln answers come in as data (fetched live by an adapter, or read back from the saved file).
import type { ChainEvent } from './audit';
import type { Receipt } from './receipt';
import { isKilnCall, type Flow, type UsageRecord } from './tokenLedger';

/** Kiln's record of one generation (GET /v1/generations/{id}), in our units: createdAt = unix seconds. */
export type KilnGeneration = { id: string; model: string; totalCost: number; promptTokens: number; completionTokens: number; createdAt: number; latencyMs?: number; cachedTokens?: number };
/** OTHER_ACCOUNT: Kiln shows a generation only to the account that made it — a call outside the asking account's scope that Kiln does not show. */
/** NO_KILN_CALL: a receipt in scope whose payment no Kiln call decided (a planner not on Kiln) — the track rule says every decision goes through Kiln. */
export type AttestStatus = 'MATCH' | 'DIFFERS' | 'NOT_FOUND' | 'OTHER_ACCOUNT' | 'NO_KILN_CALL';
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
  /** Kiln's record: prompt tokens served from cache · prompt tokens */
  cachedTokens?: number;
  promptTokens?: number;
  /** v1.1: the receipt carries the model's tool-call arguments and they re-derive the payment (true), or they do not (false) */
  argsBound?: boolean;
};
export type AttestAnswer = { flow: Flow; seq: number | null; question?: string; usage?: UsageRecord };
export type AttestResult = { rows: AttestRow[]; counts: { match: number; differs: number; notFound: number; otherAccount: number; noKilnCall: number } };
/** Which calls the asking Kiln account made: receipts from `fromSeq`, answers from log line `fromAnswer` (1-based). Absent = all. */
export type AccountScope = { fromSeq: number; fromAnswer: number };

const COST_EPS = 1e-9;
/** An F1 / host call must come at most this long before the pay() that carries its receipt hash. */
export const MAX_LEAD_SEC = 120;
export type CatalogOffer = { merchant: string; item: string; unitPrice: number; fee: number; label: string };

/** The payment the model's own arguments ask for, priced from the catalog as the code does:
 *  MCP (`{to, item?, quantity?}`) names the seller; F1 (`{item, quantity, …}`) leaves the seller to code's pick rule, so the check takes the
 *  seller that was paid and verifies it sells that item and that amount = unit price × quantity, fee = its fee. */
export function paymentFromArgs(args: string, offers: CatalogOffer[], paidMerchant?: string): { merchant: string; amount: number; fee: number } | undefined {
  let a: Record<string, unknown>;
  try { a = JSON.parse(args) as Record<string, unknown>; } catch { return undefined; }
  const q = a.quantity === undefined ? 1 : Number(a.quantity);
  let offer: CatalogOffer | undefined;
  if (typeof a.to === 'string') {
    const to = a.to.trim();
    const sells = offers.filter((o) => o.merchant === to || o.label.toLowerCase() === to.toLowerCase());
    const item = typeof a.item === 'string' && a.item ? a.item : sells.length === 1 ? sells[0].item : undefined;
    offer = sells.find((o) => o.item === item);
  } else if (typeof a.item === 'string') {
    // F1: code picks the seller; a seller address the model named must be the one paid
    if (typeof a.merchantHint === 'string' && /^T[1-9A-HJ-NP-Za-km-z]{33}$|^T[A-Z]+$/.test(a.merchantHint) && a.merchantHint !== paidMerchant) return undefined;
    offer = offers.find((o) => o.item === a.item && o.merchant === paidMerchant);
  }
  return offer ? { merchant: offer.merchant, amount: Math.round(offer.unitPrice * q), fee: offer.fee } : undefined;
}

function compare(u: UsageRecord, g: KilnGeneration | null | undefined, model: string): Pick<AttestRow, 'status' | 'diffs' | 'kilnLatencyMs' | 'cachedTokens' | 'promptTokens'> {
  if (!g) return { status: 'NOT_FOUND', diffs: [] };
  const diffs: string[] = [];
  if (g.model !== model) diffs.push(`model ${g.model} ≠ ${model}`);
  if (g.promptTokens !== u.promptTokens) diffs.push(`input tokens ${u.promptTokens} ≠ Kiln ${g.promptTokens}`);
  if (g.completionTokens !== u.completionTokens) diffs.push(`output tokens ${u.completionTokens} ≠ Kiln ${g.completionTokens}`);
  if (Math.abs(g.totalCost - u.costUsd) > COST_EPS) diffs.push(`cost ${u.costUsd} ≠ Kiln ${g.totalCost}`);
  return { status: diffs.length ? 'DIFFERS' : 'MATCH', diffs, ...(g.latencyMs !== undefined ? { kilnLatencyMs: g.latencyMs } : {}), ...(g.cachedTokens !== undefined ? { cachedTokens: g.cachedTokens, promptTokens: g.promptTokens } : {}) };
}

export function attest(o: { receipts: Receipt[]; answers: AttestAnswer[]; events: ChainEvent[]; generations: Record<string, KilnGeneration | null>; model: string; scope?: AccountScope; offers?: CatalogOffer[] }): AttestResult {
  const outside = (row: AttestRow, inScope: boolean) => (row.status === 'NOT_FOUND' && !inScope ? { ...row, status: 'OTHER_ACCOUNT' as const } : row);
  const firstEvent = new Map<string, Extract<ChainEvent, { receiptHash: string }>>();
  for (const e of o.events) if ((e.kind === 'paid' || e.kind === 'blocked') && !firstEvent.has(e.receiptHash)) firstEvent.set(e.receiptHash, e);
  const rows: AttestRow[] = [];
  const usedOn = new Map<string, number[]>();
  // one generation per receipt — or, for a reply with several tool calls (live 2026-09-29), one per (generation, the call's own arguments)
  const key = (u: UsageRecord) => `${u.generationId}|${u.args ?? ''}`;
  for (const r of o.receipts) for (const u of r.flows) if (isKilnCall(u)) usedOn.set(key(u), [...(usedOn.get(key(u)) ?? []), r.seq]);
  const askedOf = new Map<string, Map<number, string | undefined>>();
  for (const r of o.receipts) for (const u of r.flows) if (isKilnCall(u)) askedOf.set(u.generationId, (askedOf.get(u.generationId) ?? new Map()).set(r.seq, r.asked));
  for (const r of o.receipts) {
    const ev = firstEvent.get(r.hash);
    if (r.flows.length === 0 && (!o.scope || r.seq >= o.scope.fromSeq)) { // (a scripted stand-in is labelled elsewhere, never a row)
      rows.push({ flow: 'F1_intent', seq: r.seq, generationId: '', status: 'NO_KILN_CALL', diffs: ['no Kiln call decided this payment'], ...(ev ? { payAt: ev.at, txHash: ev.txHash } : {}) });
      continue;
    }
    for (const u of r.flows) {
      if (!isKilnCall(u)) continue;
      const g = o.generations[u.generationId];
      const row: AttestRow = { flow: u.flow, seq: r.seq, generationId: u.generationId, ...compare(u, g, o.model) };
      const differs = (why: string) => { row.diffs.push(why); if (row.status === 'MATCH') row.status = 'DIFFERS'; };
      if (ev) Object.assign(row, { payAt: ev.at, txHash: ev.txHash });
      const otherAsks = [...(askedOf.get(u.generationId) ?? new Map()).entries()].filter(([q, a]) => q !== r.seq && a !== r.asked).map(([q]) => q);
      const others = usedOn.get(key(u))!.filter((q) => q !== r.seq);
      if (others.length) { row.diffs.push(`generation id also on receipt #${others.join(', #')}`); if (row.status !== 'NOT_FOUND') row.status = 'DIFFERS'; }
      if (otherAsks.length) { row.diffs.push(`generation shared with a different request (#${otherAsks.join(', #')})`); if (row.status !== 'NOT_FOUND') row.status = 'DIFFERS'; }
      if (g) {
        row.kilnAt = g.createdAt;
        if (ev) {
          row.leadSec = Math.round(ev.at - g.createdAt);
          if (ev.at < g.createdAt) differs(`model call after the payment (${Math.round(g.createdAt - ev.at)} s)`);
          else if (ev.at - g.createdAt > MAX_LEAD_SEC) differs(`model call ${Math.round(ev.at - g.createdAt)} s before the payment (limit ${MAX_LEAD_SEC} s)`);
        }
      }
      if (u.args !== undefined && o.offers) {
        const want = paymentFromArgs(u.args, o.offers, r.request.merchant);
        row.argsBound = !!want && want.merchant === r.request.merchant && want.amount === r.request.amount && want.fee === r.request.fee;
        if (!row.argsBound) differs(want ? `payment differs from the model's arguments (${want.amount} + ${want.fee} ≠ ${r.request.amount} + ${r.request.fee})` : "the model's arguments name no catalog offer");
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
  return { rows, counts: { match: n('MATCH'), differs: n('DIFFERS'), notFound: n('NOT_FOUND'), otherAccount: n('OTHER_ACCOUNT'), noKilnCall: n('NO_KILN_CALL') } };
}
