import { evaluate, type BlockReason, type Mandate } from './mandate';
import { bodyOf, canonical, GENESIS, type Hasher, type Receipt } from './receipt';

export type ChainEvent =
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
export type AuditResult = { chain: { ok: true } | { ok: false; brokenAt: number }; verdicts: Verdict[]; totalPaid: number };

/** Rebuild every verdict from receipts + public chain events only. No keys, no API, no trust in the operator's UI. */
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
  const toggles = events.filter((e) => e.kind === 'paused' || e.kind === 'resumed').sort((a, b) => a.at - b.at);
  /** Owner STOP/RESUME are part of the line: replay them up to the moment of the spend. Same-second ties count the toggle first. */
  const pausedAt = (t: number) => toggles.filter((x) => x.at <= t).reduce((p, x) => x.kind === 'paused', false);
  const byHash = new Map(spends.map((e) => [e.receiptHash, e]));
  let spent = 0;
  const verdicts: Verdict[] = [];
  for (const r of [...receipts].sort((a, b) => a.seq - b.seq)) {
    const m = mandates.find((x) => x.id === r.mandateId);
    const ev = byHash.get(r.hash);
    if (!ev || !m) {
      verdicts.push({ seq: r.seq, receiptHash: r.hash, verdict: 'NO_CHAIN_EVENT', why: m ? 'no on-chain event carries this receipt hash' : 'unknown mandate' });
      continue;
    }
    const same = ev.merchant === r.request.merchant && ev.amount === r.request.amount && ev.fee === r.request.fee;
    const policy = evaluate({ ...m, paused: m.paused || pausedAt(ev.at) }, spent, { ...r.request, at: ev.at });
    if (!same) {
      verdicts.push({ seq: r.seq, receiptHash: r.hash, verdict: 'MISMATCH', txHash: ev.txHash, why: 'chain event differs from the receipt (merchant/amount/fee)' });
    } else if (ev.kind === 'paid' && policy.kind === 'allow') {
      spent += ev.amount + ev.fee;
      verdicts.push({ seq: r.seq, receiptHash: r.hash, verdict: 'PAID_INSIDE', txHash: ev.txHash, why: 'paid, and the mandate allowed it at that time' });
    } else if (ev.kind === 'blocked' && policy.kind === 'block' && policy.reason === ev.reason) {
      verdicts.push({ seq: r.seq, receiptHash: r.hash, verdict: 'STOPPED', reason: ev.reason, txHash: ev.txHash, why: `stopped on-chain: ${ev.reason}` });
    } else {
      if (ev.kind === 'paid') spent += ev.amount + ev.fee;
      verdicts.push({
        seq: r.seq,
        receiptHash: r.hash,
        verdict: 'MISMATCH',
        txHash: ev.txHash,
        why: `chain said ${ev.kind}${ev.kind === 'blocked' ? `(${ev.reason})` : ''} but policy says ${policy.kind === 'allow' ? 'allow' : `block(${policy.reason})`}`,
      });
    }
  }
  return { chain, verdicts, totalPaid: spent };
}
