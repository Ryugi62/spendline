import { evaluate, type BlockReason, type Mandate } from './mandate';
import { bodyOf, canonical, GENESIS, type Hasher, type Receipt } from './receipt';

export type ChainEvent =
  | { kind: 'granted'; mandate: Mandate; at: number; txHash: string }
  | { kind: 'paid'; receiptHash: string; merchant: string; amount: number; fee: number; at: number; txHash: string }
  | { kind: 'blocked'; receiptHash: string; merchant: string; amount: number; fee: number; at: number; reason: BlockReason; txHash: string }
  | { kind: 'paused' | 'resumed'; at: number; txHash: string };

export type Verdict = {
  seq: number;
  receiptHash: string;
  verdict: 'PAID_INSIDE' | 'STOPPED' | 'MISMATCH' | 'NO_CHAIN_EVENT';
  reason?: BlockReason;
  txHash?: string;
  why: string;
};

export type AuditInput = { mandates: Mandate[]; receipts: Receipt[]; events: ChainEvent[]; hash: Hasher };
/** A vault spend event that no receipt accounts for (unknown hash, or the same hash seen again). */
export type Unreceipted = { kind: 'paid' | 'blocked'; receiptHash: string; merchant: string; amount: number; fee: number; at: number; txHash: string; why: string };
export type AuditResult = { chain: { ok: true } | { ok: false; brokenAt: number }; verdicts: Verdict[]; totalPaid: number; unreceipted: Unreceipted[] };

/**
 * Rebuild every verdict from receipts + public chain events only. No keys, no API, no trust in the operator's UI.
 * The line in force is replayed from `granted` events (the vault can be re-granted); `mandates` is only a fallback.
 */
export function audit({ mandates, receipts, events, hash }: AuditInput): AuditResult {
  let prev = GENESIS;
  let chain: AuditResult['chain'] = { ok: true };
  for (const r of [...receipts].sort((a, b) => a.seq - b.seq)) {
    const expect = hash(prev + canonical(bodyOf(r)));
    if (r.prevHash !== prev || r.hash !== expect) {
      chain = { ok: false, brokenAt: r.seq };
      break;
    }
    prev = r.hash;
  }

  const spends = events.filter((e): e is Extract<ChainEvent, { receiptHash: string }> => e.kind === 'paid' || e.kind === 'blocked');
  const lineOf = new Map(mandates.map((m) => [m.id, m]));
  for (const g of events) if (g.kind === 'granted') lineOf.set(g.mandate.id, g.mandate);
  /**
   * STOP / RESUME / a new grant (which unpauses, like SpendlineVault.grant) replayed in chain order up to each spend.
   * Order = time, and inside the same second the source order (a pay and a STOP can share a block; guessing "toggle first" was wrong).
   */
  const pausedAtSpend = new Map<string, boolean>();
  let paused = false;
  for (const { e } of events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i)) {
    if (e.kind === 'paid' || e.kind === 'blocked') pausedAtSpend.set(e.receiptHash, paused);
    else paused = e.kind === 'paused'; // resumed or granted → false
  }
  // First event per receipt hash is the one a receipt is matched to; any other spend event is unaccounted for (AC-21).
  const known = new Set(receipts.map((r) => r.hash));
  const byHash = new Map<string, (typeof spends)[number]>();
  const unreceipted: Unreceipted[] = [];
  for (const e of spends) {
    const { kind, receiptHash, merchant, amount, fee, at, txHash } = e;
    if (!known.has(receiptHash)) unreceipted.push({ kind, receiptHash, merchant, amount, fee, at, txHash, why: 'no receipt carries this hash' });
    else if (byHash.has(receiptHash)) unreceipted.push({ kind, receiptHash, merchant, amount, fee, at, txHash, why: 'second chain event for the same receipt' });
    else byHash.set(receiptHash, e);
  }
  const spentBy = new Map<string, number>(); // grant resets spent, so it is counted per mandate
  let totalPaid = 0;
  const addPaid = (id: string, v: number) => {
    spentBy.set(id, (spentBy.get(id) ?? 0) + v);
    totalPaid += v;
  };
  const verdicts: Verdict[] = [];
  for (const r of [...receipts].sort((a, b) => a.seq - b.seq)) {
    const m = lineOf.get(r.mandateId);
    const ev = byHash.get(r.hash);
    if (!ev || !m) {
      verdicts.push({ seq: r.seq, receiptHash: r.hash, verdict: 'NO_CHAIN_EVENT', why: m ? 'no on-chain event carries this receipt hash' : 'unknown mandate' });
      continue;
    }
    const same = ev.merchant === r.request.merchant && ev.amount === r.request.amount && ev.fee === r.request.fee;
    const spent = spentBy.get(m.id) ?? 0;
    const policy = evaluate({ ...m, paused: m.paused || (pausedAtSpend.get(ev.receiptHash) ?? false) }, spent, { ...r.request, at: ev.at });
    if (!same) {
      verdicts.push({ seq: r.seq, receiptHash: r.hash, verdict: 'MISMATCH', txHash: ev.txHash, why: 'chain event differs from the receipt (merchant/amount/fee)' });
    } else if (ev.kind === 'paid' && policy.kind === 'allow') {
      addPaid(m.id, ev.amount + ev.fee);
      verdicts.push({ seq: r.seq, receiptHash: r.hash, verdict: 'PAID_INSIDE', txHash: ev.txHash, why: 'paid, and the mandate allowed it at that time' });
    } else if (ev.kind === 'blocked' && policy.kind === 'block' && policy.reason === ev.reason) {
      verdicts.push({ seq: r.seq, receiptHash: r.hash, verdict: 'STOPPED', reason: ev.reason, txHash: ev.txHash, why: `stopped on-chain: ${ev.reason}` });
    } else {
      if (ev.kind === 'paid') addPaid(m.id, ev.amount + ev.fee);
      verdicts.push({
        seq: r.seq,
        receiptHash: r.hash,
        verdict: 'MISMATCH',
        txHash: ev.txHash,
        why: `chain said ${ev.kind}${ev.kind === 'blocked' ? `(${ev.reason})` : ''} but policy says ${policy.kind === 'allow' ? 'allow' : `block(${policy.reason})`}`,
      });
    }
  }
  return { chain, verdicts, totalPaid, unreceipted };
}
