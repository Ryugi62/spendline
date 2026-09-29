import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordFacts } from '../src/infrastructure/record-facts';

// M1 check 2026-09-29: a new live receipt left README prose (audit line, Kiln row, UI captures line) on the old record while the
// video / deck / Q&A checks caught theirs. The README's record numbers are pinned to the same facts here.
describe('README says the record the facts say', () => {
  const f = recordFacts();
  const readme = readFileSync('README.md', 'utf8');
  it('the "How to run" audit line = the audit today', () => {
    expect(readme).toContain(`# → ${f.receipts} receipts · ${f.paid} paid inside · ${f.stopped} stopped · 0 mismatch · ${f.replays} replay stopped · paid ${f.paidUsdt} USDT → OK`);
  });
  it('the Kiln row quotes the calls, tokens, USD and Wh of docs/tokens-by-flow.md', () => {
    const row = readme.split('\n').find((l) => l.startsWith('| Kiln Integration & Efficiency'))!;
    expect(row).toContain(`${f.kilnCalls} calls, ${f.tokens} tokens, $${f.usd}, ≈${f.wh} Wh`);
  });
});
