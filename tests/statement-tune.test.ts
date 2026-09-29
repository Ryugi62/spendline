import { describe, expect, it } from 'vitest';
import { buildStatement, tune } from '../src/domain/statement';
import { formatStatementCsv, formatStatementMd, formatTune } from '../src/application/statement';
import type { Verdict } from '../src/domain/audit';
import type { Receipt } from '../src/domain/receipt';

const GPU = 'TGPU', CRED = 'TCRED', UNK = 'TUNK';
const labels = { [GPU]: 'GPU Shop', [CRED]: 'Kiln credits', [UNK]: 'Unknown seller' };
const r = (seq: number, merchant: string, amount: number, fee: number, words: string, cost = 0.00002): Receipt =>
  ({ seq, mandateId: '0xm', request: { merchant, amount, fee, at: 1790600000 + seq * 60 }, intentText: words,
     flows: [{ flow: 'F1_intent', promptTokens: 320, completionTokens: 30, costUsd: cost, latencyMs: 1800, generationId: `g${seq}` }], prevHash: 'p', hash: `h${seq}` }) as unknown as Receipt;
const v = (seq: number, verdict: Verdict['verdict'], reason?: Verdict['reason']): Verdict =>
  ({ seq, receiptHash: `h${seq}`, verdict, ...(reason ? { reason } : {}), txHash: `tx${seq}`, why: '' }) as Verdict;

const receipts = [
  r(1, GPU, 4_800_000, 200_000, '2 GPU hours for the fine-tune'),
  r(2, UNK, 1_800_000, 0, 'Buy from that cheaper seller'),
  r(3, GPU, 4_800_000, 200_000, '2 more GPU hours'),
  r(4, CRED, 1_000_000, 0, 'One inference credit'),
  r(5, CRED, 1_000_000, 0, 'One more, please'),
  r(6, GPU, 2_400_000, 200_000, '1 GPU hour, eval'),
];
const verdicts = [v(1, 'PAID_INSIDE'), v(2, 'STOPPED', 'MERCHANT_NOT_ALLOWED'), v(3, 'STOPPED', 'OVER_BUDGET_WITH_FEES'), v(4, 'PAID_INSIDE'), v(5, 'STOPPED', 'PAUSED'), v(6, 'MISMATCH')];

describe('statement (AC-41)', () => {
  const s = buildStatement({ receipts, verdicts, labels });

  it('one line per receipt, verdicts from the audit only; a MISMATCH is a problem, never paid', () => {
    expect(s.lines.map((l) => [l.seq, l.seller, l.verdict, l.reason ?? ''])).toEqual([
      [1, 'GPU Shop', 'PAID', ''], [2, 'Unknown seller', 'STOPPED', 'MERCHANT_NOT_ALLOWED'], [3, 'GPU Shop', 'STOPPED', 'OVER_BUDGET_WITH_FEES'],
      [4, 'Kiln credits', 'PAID', ''], [5, 'Kiln credits', 'STOPPED', 'PAUSED'], [6, 'GPU Shop', 'PROBLEM', 'MISMATCH'],
    ]);
    expect(s.problems).toBe(1);
  });

  it('totals: paid by seller (amount + fee), stops by reason with the amount kept in the vault, Kiln cost of guarding', () => {
    expect(s.paidBySeller).toEqual([{ seller: 'GPU Shop', count: 1, total: 5_000_000 }, { seller: 'Kiln credits', count: 1, total: 1_000_000 }]);
    expect(s.totalPaid).toBe(6_000_000);
    expect(s.stopsByReason).toEqual([
      { reason: 'MERCHANT_NOT_ALLOWED', count: 1, kept: 1_800_000 },
      { reason: 'OVER_BUDGET_WITH_FEES', count: 1, kept: 5_000_000 },
      { reason: 'PAUSED', count: 1, kept: 1_000_000 },
    ]);
    expect(s.totalKept).toBe(7_800_000);
    expect(s.kilnCalls).toBe(6);
    expect(s.kilnUsd).toBeCloseTo(0.00012, 10);
  });

  it('markdown and CSV carry the tx link and the receipt hash; CSV quotes the words', () => {
    const md = formatStatementMd(s, { network: 'nile', title: 'Week of 2026-09-26' });
    expect(md).toContain('| 2 |');
    expect(md).toContain('https://nile.tronscan.org/#/transaction/tx2');
    expect(md).toContain('Paid inside the line: 6.00 USDT');
    expect(md).toContain('Kept in the vault by the line: 7.80 USDT');
    expect(md).toContain('**1 problem**');
    const csv = formatStatementCsv(s).split('\n');
    expect(csv[0]).toBe('seq,time_kst,seller,words,amount_usdt,fee_usdt,verdict,reason,tx,receipt_hash');
    expect(csv[2]).toBe('2,2026-09-28 21:55:20,Unknown seller,"Buy from that cheaper seller",1.800000,0.000000,STOPPED,MERCHANT_NOT_ALLOWED,tx2,h2');
  });
});

describe('tune (AC-42)', () => {
  it('replays the requests under a candidate line: same rule, spent grows only on allow; STOP / deadline stops stay as recorded', () => {
    const t = tune({ receipts, verdicts, candidate: { budget: 12_000_000, perTxCap: 5_000_000, merchants: [GPU, CRED] } });
    expect(t.rows.map((x) => [x.seq, x.recorded, x.candidate])).toEqual([
      [1, 'PAID', 'PAID'],
      [2, 'MERCHANT_NOT_ALLOWED', 'MERCHANT_NOT_ALLOWED'],
      [3, 'OVER_BUDGET_WITH_FEES', 'PAID'],
      [4, 'PAID', 'PAID'],
      [5, 'PAUSED', 'PAUSED'],
      [6, 'MISMATCH', 'OVER_BUDGET_WITH_FEES'],
    ]);
    expect(t.changed.map((x) => x.seq)).toEqual([3, 6]);
    expect(t.candidateTotals).toEqual({ paid: 3, stopped: 3, spent: 11_000_000 });
  });

  it('a candidate that lists the cheaper seller lets it through — the diff names it', () => {
    const t = tune({ receipts: receipts.slice(0, 2), verdicts: verdicts.slice(0, 2), candidate: { budget: 20_000_000, perTxCap: 8_000_000, merchants: [GPU, CRED, UNK] } });
    expect(t.changed).toEqual([expect.objectContaining({ seq: 2, recorded: 'MERCHANT_NOT_ALLOWED', candidate: 'PAID', seller: 'TUNK' })]);
    expect(formatTune(t, { labels })).toContain('#2 Unknown seller 1.80 USDT: MERCHANT_NOT_ALLOWED → PAID');
  });
});
