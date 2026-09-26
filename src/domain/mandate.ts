/**
 * The line the user drew. `evaluate` is the single policy definition; SpendlineVault.sol checks in the SAME order (CHECK_ORDER)
 * and emits the SAME reason codes (see REASON_CODE), so the off-chain preview and the on-chain stop always agree.
 */
export type Mandate = {
  id: string;
  budget: number; // micro-USDT
  perTxCap: number; // micro-USDT, amount + fee
  deadline: number; // unix seconds, inclusive
  merchants: string[]; // allowlist (TRON base58 addresses)
  paused: boolean;
};

export type SpendRequest = { merchant: string; amount: number; fee: number; at: number };

/** On-chain reason codes, 1-based, APPEND-ONLY: events already on Nile decode with these numbers. */
export const BLOCK_REASONS = [
  'PAUSED',
  'DEADLINE_PASSED',
  'MERCHANT_NOT_ALLOWED',
  'INVALID_AMOUNT',
  'OVER_TX_CAP',
  'OVER_BUDGET_WITH_FEES',
  'DUPLICATE_RECEIPT',
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
/** The order `evaluate` and `SpendlineVault.check` test the rules in (a used receipt hash first: one receipt, one decision). */
export const CHECK_ORDER: readonly BlockReason[] = [
  'DUPLICATE_RECEIPT',
  'PAUSED',
  'DEADLINE_PASSED',
  'MERCHANT_NOT_ALLOWED',
  'INVALID_AMOUNT',
  'OVER_TX_CAP',
  'OVER_BUDGET_WITH_FEES',
];
/** 1-based codes used in the contract event `SpendBlocked(..., uint8 reason)`. */
export const REASON_CODE: Record<BlockReason, number> = Object.fromEntries(BLOCK_REASONS.map((r, i) => [r, i + 1])) as Record<BlockReason, number>;
export const reasonFromCode = (code: number): BlockReason => {
  const r = BLOCK_REASONS[code - 1];
  if (!r) throw new Error(`unknown reason code ${code}`);
  return r;
};

export type Decision = { kind: 'allow' } | { kind: 'block'; reason: BlockReason };

/** `receiptUsed`: the receipt hash was already passed to the vault's pay() (AC-25). */
export function evaluate(m: Mandate, spent: number, r: SpendRequest, receiptUsed = false): Decision {
  const block = (reason: BlockReason): Decision => ({ kind: 'block', reason });
  if (receiptUsed) return block('DUPLICATE_RECEIPT');
  if (m.paused) return block('PAUSED');
  if (r.at > m.deadline) return block('DEADLINE_PASSED');
  if (!m.merchants.includes(r.merchant)) return block('MERCHANT_NOT_ALLOWED');
  if (!(r.amount > 0) || r.fee < 0) return block('INVALID_AMOUNT');
  if (r.amount + r.fee > m.perTxCap) return block('OVER_TX_CAP');
  if (spent + r.amount + r.fee > m.budget) return block('OVER_BUDGET_WITH_FEES');
  return { kind: 'allow' };
}
