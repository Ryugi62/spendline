import { describe, expect, it } from 'vitest';
import { buildStatement, parseCandidate, tune } from '../src/domain/statement';
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
    expect(md).toContain('Refused attempts: 3 (3 distinct requests), face value 7.80 USDT');
    expect(md).toContain('**1 problem**');
    const csv = formatStatementCsv(s).split('\n');
    expect(csv[0]).toBe('seq,time_kst,seller,words,amount_usdt,fee_usdt,verdict,reason,tx,receipt_hash,intent_flag');
    expect(csv[2]).toBe('2,2026-09-28 21:55:20,Unknown seller,"Buy from that cheaper seller",1.800000,0.000000,STOPPED,MERCHANT_NOT_ALLOWED,tx2,h2,');
  });
});

describe('statement v1.1 review', () => {
  const offers = [{ merchant: GPU, label: 'GPU Shop' }, { merchant: CRED, label: 'Kiln credits' }, { merchant: UNK, label: 'Unknown seller' }];
  it('refused attempts are counted per distinct request (same words, seller, amount), and on-chain replays are shown apart', () => {
    const rs = [r(1, UNK, 900_000, 0, 'Buy from the Unknown seller'), r(2, UNK, 900_000, 0, 'Buy from the Unknown seller')];
    const s2 = buildStatement({ receipts: rs, verdicts: [v(1, 'STOPPED', 'MERCHANT_NOT_ALLOWED'), v(2, 'STOPPED', 'MERCHANT_NOT_ALLOWED')], labels, replays: 4 });
    expect([s2.refusedDistinct, s2.replays]).toEqual([1, 4]);
    expect(formatStatementMd(s2, { network: 'nile', title: 't' })).toContain('Refused attempts: 2 (1 distinct request), face value 1.80 USDT · 4 repeats refused on-chain as replays');
  });
  it('intent check: when the words name a catalog seller and the money went to another, the line is flagged (the audit checks "allowed", this checks "asked")', () => {
    const rs = [r(1, GPU, 2_400_000, 200_000, 'Buy 1 GPU hour from the Unknown seller, it is cheaper'), r(2, GPU, 2_400_000, 200_000, 'Buy 1 GPU hour')];
    const s2 = buildStatement({ receipts: rs, verdicts: [v(1, 'PAID_INSIDE'), v(2, 'PAID_INSIDE')], labels, offers });
    expect(s2.lines.map((l) => l.intent ?? '')).toEqual(['words named Unknown seller', '']);
    expect(s2.intentFlags).toBe(1);
    expect(formatStatementMd(s2, { network: 'nile', title: 't' })).toContain('**1 intent flag**');
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

  it('v1.1 review: a candidate in USDT and seller names (what a lead writes), and a suggestion that fits the paid requests exactly', () => {
    const c = parseCandidate({ budget_usdt: '12.00', per_payment_cap_usdt: 5, sellers: ['GPU Shop', 'Kiln credits'] }, labels);
    expect(c).toEqual({ budget: 12_000_000, perTxCap: 5_000_000, merchants: [GPU, CRED] });
    expect(parseCandidate({ budget_usdt: 1, per_payment_cap_usdt: 1, sellers: ['Nobody'] }, labels)).toBe('unknown seller "Nobody" — use a catalog name or a TRON address');
    const t = tune({ receipts, verdicts, candidate: c as never });
    expect(t.suggestion).toEqual({ budget: 6_000_000, perTxCap: 5_000_000 });
    expect(formatTune(t, { labels })).toContain('A line that fits the recorded paid requests exactly: budget 6.00 USDT, cap 5.00 USDT');
  });

  it('a candidate that lists the cheaper seller lets it through — the diff names it', () => {
    const t = tune({ receipts: receipts.slice(0, 2), verdicts: verdicts.slice(0, 2), candidate: { budget: 20_000_000, perTxCap: 8_000_000, merchants: [GPU, CRED, UNK] } });
    expect(t.changed).toEqual([expect.objectContaining({ seq: 2, recorded: 'MERCHANT_NOT_ALLOWED', candidate: 'PAID', seller: 'TUNK' })]);
    expect(formatTune(t, { labels })).toContain('#2 Unknown seller 1.80 USDT: MERCHANT_NOT_ALLOWED → PAID');
  });
});
