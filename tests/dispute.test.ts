import { describe, expect, it } from 'vitest';
import { FakeLlm, MemoryAnswerLog } from '../src/adapters/memory';
import { dispute } from '../src/application/dispute';
import { labels, sha, threeReceipts } from './answers-fixture';

const deps = (replies: string[]) => ({ llm: new FakeLlm(replies), log: new MemoryAnswerLog(), hash: sha, labels });

describe('AC-24 F3 dispute — Kiln finds the receipt, the audit gives the verdict', () => {
  it('one F3 call over a code-built table of audited receipts; the picked receipt carries the audit verdict and tx', async () => {
    const rec = await threeReceipts();
    const d = deps(['{"seq":2,"verdict":"STOPPED","answer":"The cheap seller was not on your list, so the vault refused it and nothing was paid."}']);
    const a = await dispute(d, rec, 'Did we pay that cheap unknown seller?');
    expect(a).toMatchObject({ flow: 'F3_dispute', seq: 2, verdict: 'STOPPED', reason: 'MERCHANT_NOT_ALLOWED', grounded: true, cached: false });
    expect(a.txHash).toBe(rec.events.find((e) => e.kind === 'blocked' && e.reason === 'MERCHANT_NOT_ALLOWED')!.txHash);
    expect(d.llm.seen).toHaveLength(1);
    const prompt = d.llm.seen[0].map((m) => m.content).join('\n');
    expect(prompt).toMatch(/#1 \|.*GPU Shop.*5\.00 USDT.*PAID_INSIDE/);
    expect(prompt).toMatch(/#2 \|.*Unknown seller.*not on the list.*STOPPED \| MERCHANT_NOT_ALLOWED/);
    expect(prompt).toMatch(/#3 \|.*STOPPED \| OVER_BUDGET_WITH_FEES/);
    expect(d.llm.seen[0].at(-1)!.content).toContain('Did we pay that cheap unknown seller?');
  });

  it('the model cannot change the verdict: a mismatching echo keeps the audit verdict and answers with the template', async () => {
    const rec = await threeReceipts();
    const a = await dispute(deps(['{"seq":2,"verdict":"PAID_INSIDE","answer":"Yes, it was paid."}']), rec, 'Did we pay the cheap seller?');
    expect(a).toMatchObject({ seq: 2, verdict: 'STOPPED', grounded: false });
    expect(a.rejected).toMatch(/PAID_INSIDE.*STOPPED/);
    expect(a.text).toMatch(/Seller is not on your list/);
    expect(a.text).not.toMatch(/Yes, it was paid/);
  });

  it('a receipt number that is not in the record → "no receipt matches"; null seq is a valid "none"', async () => {
    const rec = await threeReceipts();
    const bad = await dispute(deps(['{"seq":7,"verdict":"PAID_INSIDE","answer":"x"}']), rec, 'What about the dataset?');
    expect(bad).toMatchObject({ seq: null, grounded: false });
    expect(bad.rejected).toMatch(/#7/);
    expect(bad.text).toMatch(/No receipt in this record matches/);
    const none = await dispute(deps(['{"seq":null,"verdict":null,"answer":"No purchase of a dataset is in the record."}']), rec, 'Did we buy a dataset?');
    expect(none).toMatchObject({ seq: null, grounded: true });
    expect(none.text).toMatch(/No purchase of a dataset/);
  });

  it('the same question on the same record is cached (0 calls); a new receipt changes the record, so it asks again', async () => {
    const rec = await threeReceipts();
    const d = deps(['{"seq":1,"verdict":"PAID_INSIDE","answer":"Yes — 5.00 USDT to GPU Shop, inside your line."}', '{"seq":1,"verdict":"PAID_INSIDE","answer":"Yes."}']);
    await dispute(d, rec, 'Was the GPU Shop payment inside the line?');
    const again = await dispute(d, rec, '  was the GPU shop payment inside the line?  ');
    expect(again.cached).toBe(true);
    expect(d.llm.seen).toHaveLength(1);
    await dispute(d, { ...rec, receipts: rec.receipts.slice(0, 2) }, 'Was the GPU Shop payment inside the line?');
    expect(d.llm.seen).toHaveLength(2);
  });
  it('real Kiln finding 2026-09-26: an echo "STOPPED OVER_BUDGET_WITH_FEES" (verdict + reason) is accepted only when both match', async () => {
    const rec = await threeReceipts();
    const ok = await dispute(deps(['{"seq":3,"verdict":"STOPPED OVER_BUDGET_WITH_FEES","answer":"The fee pushed it past the budget."}']), rec, 'Why was the third order refused?');
    expect(ok).toMatchObject({ seq: 3, grounded: true, text: 'The fee pushed it past the budget.' });
    const wrong = await dispute(deps(['{"seq":3,"verdict":"STOPPED PAUSED","answer":"You pressed STOP."}']), rec, 'Why was the third order refused?');
    expect(wrong.grounded).toBe(false);
  });

  it('real Kiln finding 2026-09-26: the table carries reason and STOP-in-force columns and the grant / STOP timeline', async () => {
    const rec = await threeReceipts();
    const d = deps(['{"seq":null,"verdict":null,"answer":"none"}']);
    await dispute(d, { ...rec, events: [...rec.events, { kind: 'paused', at: 1_200, txHash: 'stop-1' }] }, 'Was anything paid after I pressed STOP?');
    const prompt = d.llm.seen[0][0].content;
    expect(prompt).toContain('seq | time | request words | seller | total | verdict | reason | STOP in force');
    expect(prompt).toMatch(/#2 \|.* \| STOPPED \| MERCHANT_NOT_ALLOWED \| no/);
    expect(prompt).toMatch(/line events \(oldest first\):\n.*line granted: budget 9\.90 USDT.*\n.*STOP pressed \(tx stop-1\)/);
  });
});
