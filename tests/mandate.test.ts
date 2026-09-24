import { describe, expect, it } from 'vitest';
import { evaluate, type Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';

const base: Mandate = {
  id: 'm1',
  budget: usdt(10),
  perTxCap: usdt(6),
  deadline: 2_000,
  merchants: ['TGpuShop', 'TKilnCredits'],
  paused: false,
};

describe('evaluate (AC-1..AC-4) — same check order as SpendlineVault.sol', () => {
  it('AC-1 blocks when the fee pushes the total over the remaining budget', () => {
    const d = evaluate({ ...base, perTxCap: usdt(20) }, usdt(0), { merchant: 'TGpuShop', amount: usdt(9.8), fee: usdt(0.4), at: 1_000 });
    expect(d).toEqual({ kind: 'block', reason: 'OVER_BUDGET_WITH_FEES' });
  });
  it('AC-1b counts what was already spent', () => {
    const d = evaluate(base, usdt(7), { merchant: 'TGpuShop', amount: usdt(3), fee: usdt(0.1), at: 1_000 });
    expect(d).toEqual({ kind: 'block', reason: 'OVER_BUDGET_WITH_FEES' });
  });
  it('AC-2 blocks a merchant that is not on the list, however cheap', () => {
    const d = evaluate(base, 0, { merchant: 'TCheapButUnknown', amount: usdt(0.5), fee: 0, at: 1_000 });
    expect(d).toEqual({ kind: 'block', reason: 'MERCHANT_NOT_ALLOWED' });
  });
  it('AC-3 blocks after the deadline, and PAUSED wins over everything', () => {
    expect(evaluate(base, 0, { merchant: 'TGpuShop', amount: usdt(1), fee: 0, at: 2_001 })).toEqual({ kind: 'block', reason: 'DEADLINE_PASSED' });
    expect(evaluate({ ...base, paused: true }, 0, { merchant: 'TNope', amount: 0, fee: 0, at: 9_999 })).toEqual({ kind: 'block', reason: 'PAUSED' });
  });
  it('AC-4 invalid amount, per-payment cap, and the allowed path', () => {
    expect(evaluate(base, 0, { merchant: 'TGpuShop', amount: 0, fee: 0, at: 1 })).toEqual({ kind: 'block', reason: 'INVALID_AMOUNT' });
    expect(evaluate(base, 0, { merchant: 'TGpuShop', amount: usdt(5.9), fee: usdt(0.2), at: 1 })).toEqual({ kind: 'block', reason: 'OVER_TX_CAP' });
    expect(evaluate(base, usdt(2), { merchant: 'TKilnCredits', amount: usdt(5), fee: usdt(0.5), at: 2_000 })).toEqual({ kind: 'allow' });
  });
});
