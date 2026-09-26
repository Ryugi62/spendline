import { describe, expect, it } from 'vitest';
import { FakeLlm, MemoryAnswerLog } from '../src/adapters/memory';
import { explain, formatAnswer } from '../src/application/explain';
import { labels, sha, threeReceipts } from './answers-fixture';

const deps = (replies: string[]) => ({ llm: new FakeLlm(replies), log: new MemoryAnswerLog(), hash: sha, labels });

describe('AC-23 F2 explain — Kiln phrases, the audit decides', () => {
  it('one F2 call with code-built facts; a reply that echoes the audit verdict is shown as the answer', async () => {
    const rec = await threeReceipts();
    const d = deps(['Sure: {"verdict":"STOPPED","reason":"OVER_BUDGET_WITH_FEES","explanation":"You had 4.90 USDT left and this cost 5.00 with the fee, so the vault refused it."}']);
    const a = await explain(d, rec, 3);
    expect(a).toMatchObject({ flow: 'F2_explain', seq: 3, verdict: 'STOPPED', reason: 'OVER_BUDGET_WITH_FEES', grounded: true, cached: false });
    expect(a.text).toMatch(/4\.90 USDT left/);
    expect(a.usage?.flow).toBe('F2_explain');
    expect(d.llm.seen).toHaveLength(1);
    const prompt = d.llm.seen[0].map((m) => m.content).join('\n');
    for (const fact of ['#3', '“2 more GPU hours”', 'GPU Shop', '4.80 USDT + fee 0.20 USDT = 5.00 USDT', 'budget 9.90 USDT', 'spent before this attempt: 5.00 USDT', 'verdict: STOPPED', 'reason: OVER_BUDGET_WITH_FEES'])
      expect(prompt).toContain(fact);
  });

  it('a reply whose verdict differs from the audit is not shown: the code template answers, marked rejected', async () => {
    const rec = await threeReceipts();
    const a = await explain(deps(['{"verdict":"PAID_INSIDE","explanation":"It was paid."}']), rec, 2);
    expect(a.grounded).toBe(false);
    expect(a.rejected).toMatch(/PAID_INSIDE.*STOPPED/);
    expect(a.verdict).toBe('STOPPED');
    expect(a.text).toMatch(/Stopped on-chain: Seller is not on your list/);
    expect(a.text).not.toMatch(/It was paid/);
  });

  it('a wrong reason, prose without JSON, or an empty explanation is rejected the same way', async () => {
    const rec = await threeReceipts();
    for (const reply of ['{"verdict":"STOPPED","reason":"PAUSED","explanation":"You pressed STOP."}', 'It was stopped.', '{"verdict":"STOPPED","reason":"MERCHANT_NOT_ALLOWED","explanation":""}']) {
      const a = await explain(deps([reply]), rec, 2);
      expect(a.grounded).toBe(false);
      expect(a.text).toMatch(/Seller is not on your list/);
    }
  });

  it('on demand and cached: the same receipt again makes 0 calls and returns the logged answer', async () => {
    const rec = await threeReceipts();
    const d = deps(['{"verdict":"PAID_INSIDE","reason":null,"explanation":"Two GPU hours from a listed seller, inside the budget."}']);
    const first = await explain(d, rec, 1);
    const again = await explain(d, rec, 1);
    expect(d.llm.seen).toHaveLength(1);
    expect(again).toMatchObject({ cached: true, text: first.text, grounded: true, seq: 1 });
    expect(again.usage).toBeUndefined();
    expect(await d.log.all()).toHaveLength(1);
    expect((await d.log.all())[0].key).toMatch(/^F2v\d+:/);
  });

  it('an unknown receipt number makes no call', async () => {
    const rec = await threeReceipts();
    const d = deps([]);
    const a = await explain(d, rec, 9);
    expect(a).toMatchObject({ seq: null, grounded: false });
    expect(a.text).toMatch(/No receipt #9/);
    expect(d.llm.seen).toHaveLength(0);
  });
  it('formatAnswer: the audit verdict and tx lead, then the words, then what the thinking cost (or 0 calls when cached)', async () => {
    const rec = await threeReceipts();
    const d = deps(['{"verdict":"STOPPED","reason":"MERCHANT_NOT_ALLOWED","explanation":"That seller is not on your list."}']);
    const out = formatAnswer(await explain(d, rec, 2));
    expect(out.split('\n')[0]).toMatch(/^F2 explain · receipt #2 · audit verdict STOPPED MERCHANT_NOT_ALLOWED · tx mem-\d+$/);
    expect(out).toContain('That seller is not on your list.');
    expect(out).toMatch(/scripted stand-in — no Kiln call · F2_explain · \d+\+\d+ tokens/); // AC-22: a FakeLlm reply is never shown as Kiln
    const live = formatAnswer({ flow: 'F2_explain', seq: 2, text: 'x', grounded: true, cached: false, usage: { flow: 'F2_explain', promptTokens: 210, completionTokens: 38, costUsd: 0.0000275, latencyMs: 1480, generationId: 'gen-abc' } });
    expect(live).toMatch(/Kiln qwen3-32b · F2_explain · 210\+38 tokens · 1\.48 s · \$0\.0000275 · gen gen-abc · ≈0\.0740 Wh/);
    expect(formatAnswer(await explain(d, rec, 2))).toMatch(/answered from the answers log — 0 Kiln calls/);
    const rejected = formatAnswer(await explain(deps(['{"verdict":"PAID_INSIDE","explanation":"paid"}']), rec, 2));
    expect(rejected).toMatch(/model reply not shown — model said PAID_INSIDE, audit says STOPPED/);
  });
  it('a number in the explanation that is not in the facts (e.g. a made-up amount) is not shown', async () => {
    const rec = await threeReceipts();
    const a = await explain(deps(['{"verdict":"STOPPED","reason":"OVER_BUDGET_WITH_FEES","explanation":"You had 3.10 USDT left, so it was refused."}']), rec, 3);
    expect(a.grounded).toBe(false);
    expect(a.rejected).toMatch(/number not in the facts: 3\.10/);
  });
});
