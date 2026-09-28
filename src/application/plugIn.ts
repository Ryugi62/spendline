// AC-37 — where Spendline plugs in: an agent that already pays with `wallet.transfer(to, amount)` swaps in this wallet.
// Same call shape; underneath, every attempt is sealed as a hash-chained receipt and sent through the vault's pay(),
// which pays inside the line or records the stop on-chain. No model call is added — the agent keeps its own planner.
import { evaluate, type Decision, type SpendRequest } from '../domain/mandate';
import { GENESIS, sealReceipt, type Hasher, type Receipt } from '../domain/receipt';
import type { UsageRecord } from '../domain/tokenLedger';
import type { ChainPort, PayOutcome, ReceiptStore } from './ports';

export type GuardedPayDeps = { chain: ChainPort; store: ReceiptStore; hash: Hasher };
export type GuardedPayResult = { request: SpendRequest; preview: Decision; receipt: Receipt; outcome: PayOutcome };

/** Seal a receipt for one spend attempt and send it through the vault. Used by UC-2 purchase and by the plug-in wallet. */
export async function guardedPay(
  d: GuardedPayDeps,
  p: { merchant: string; amount: number; fee: number; why: string; flows?: UsageRecord[] },
): Promise<GuardedPayResult> {
  const [mandate, spent, at] = await Promise.all([d.chain.mandate(), d.chain.spent(), d.chain.now()]);
  const request: SpendRequest = { merchant: p.merchant, amount: p.amount, fee: p.fee, at };
  const preview = evaluate(mandate, spent, request);
  const prior = await d.store.all();
  const prev = prior.length ? prior[prior.length - 1] : undefined;
  const receipt = sealReceipt(prev?.hash ?? GENESIS, { seq: (prev?.seq ?? 0) + 1, mandateId: mandate.id, request, intentText: p.why, flows: p.flows ?? [] }, d.hash);
  await d.store.append(receipt);
  const outcome = await d.chain.pay({ merchant: request.merchant, amount: request.amount, fee: request.fee, receiptHash: receipt.hash });
  return { request, preview, receipt, outcome };
}

/** The wallet an existing agent loop already calls, now guarded. `memo` becomes the receipt's words. */
export function spendlineWallet(d: GuardedPayDeps, fee = 0) {
  return {
    async transfer(to: string, amount: number, memo = '') {
      const r = await guardedPay(d, { merchant: to, amount, fee, why: memo });
      return r.outcome.kind === 'paid'
        ? { ok: true as const, tx: r.outcome.txHash, receipt: r.receipt.hash }
        : { ok: false as const, tx: r.outcome.txHash, receipt: r.receipt.hash, reason: r.outcome.reason };
    },
  };
}
