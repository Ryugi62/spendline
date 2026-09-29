import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readJsonl } from '../src/adapters/files';
import { parseReceiptsFile } from '../src/application/auditRecords';
import type { AnswerRecord } from '../src/application/ports';
import { recordFacts } from '../src/infrastructure/record-facts';
import { LIVE_ANSWERS, LIVE_RECEIPTS } from '../src/infrastructure/runtime';

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
  // V1 2026-09-29: from receipt #13 on, every Kiln call ran on the organizer-issued team32 key. The README's account sentence
  // quotes the calls, tokens and USD of exactly those records (F1 inside receipts #13+, F2 / F3 answers about them).
  it('the organizer-issued Kiln account sentence = the Kiln usage recorded from receipt #13 on', () => {
    const FIRST = 13;
    const receipts = parseReceiptsFile(readFileSync(LIVE_RECEIPTS, 'utf8')).receipts.filter((r) => r.seq >= FIRST);
    const answers = readJsonl<AnswerRecord>(LIVE_ANSWERS).filter((a) => a.usage && (a.seq ?? 0) >= FIRST);
    const usage = [...receipts.flatMap((r) => r.flows), ...answers.map((a) => a.usage!)];
    const tokens = usage.reduce((t, u) => t + u.promptTokens + u.completionTokens, 0);
    const usd = usage.reduce((t, u) => t + u.costUsd, 0);
    const row = readme.split('\n').find((l) => l.startsWith('| Kiln Integration & Efficiency'))!;
    expect(row).toContain('**Organizer-issued Kiln account** (team32');
    expect(row).toContain(`${usage.length} calls, ${tokens.toLocaleString('en-US')} tokens, $${usd.toFixed(7)} in the record`);
  });
  it('the version in package.json is the one the README evidence table states', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(readme).toContain(`## Acceptance criteria → evidence (status 2026-09-29, v${version})`);
  });
});
