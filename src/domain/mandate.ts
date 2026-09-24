/**
 * The line the user drew. `evaluate` is the single policy definition; SpendlineVault.sol checks in the SAME order
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

export const BLOCK_REASONS = [
  'PAUSED',
  'DEADLINE_PASSED',
  'MERCHANT_NOT_ALLOWED',
  'INVALID_AMOUNT',
  'OVER_TX_CAP',
  'OVER_BUDGET_WITH_FEES',
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
/** 1-based codes used in the contract event `SpendBlocked(..., uint8 reason)`. */
export const REASON_CODE: Record<BlockReason, number> = Object.fromEntries(BLOCK_REASONS.map((r, i) => [r, i + 1])) as Record<BlockReason, number>;
export const reasonFromCode = (code: number): BlockReason => {
  const r = BLOCK_REASONS[code - 1];
  if (!r) throw new Error(`unknown reason code ${code}`);
  return r;
};

export type Decision = { kind: 'allow' } | { kind: 'block'; reason: BlockReason };

export function evaluate(m: Mandate, spent: number, r: SpendRequest): Decision {
  const block = (reason: BlockReason): Decision => ({ kind: 'block', reason });
  if (m.paused) return block('PAUSED');
  if (r.at > m.deadline) return block('DEADLINE_PASSED');
  if (!m.merchants.includes(r.merchant)) return block('MERCHANT_NOT_ALLOWED');
  if (!(r.amount > 0) || r.fee < 0) return block('INVALID_AMOUNT');
  if (r.amount + r.fee > m.perTxCap) return block('OVER_TX_CAP');
  if (spent + r.amount + r.fee > m.budget) return block('OVER_BUDGET_WITH_FEES');
  return { kind: 'allow' };
}
