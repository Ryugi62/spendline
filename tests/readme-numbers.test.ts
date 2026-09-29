import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readJsonl } from '../src/adapters/files';
import { parseReceiptsFile } from '../src/application/auditRecords';
import type { AnswerRecord } from '../src/application/ports';
import { countTests, recordFacts } from '../src/infrastructure/record-facts';
import { LIVE_ANSWERS, LIVE_RECEIPTS } from '../src/infrastructure/runtime';
import { hostCallsOutsideReceipts } from '../src/infrastructure/host-runs';

// M1 check 2026-09-29: a new live receipt left README prose (audit line, Kiln row, UI captures line) on the old record while the
// video / deck / Q&A checks caught theirs. The README's record numbers are pinned to the same facts here.
describe('README says the record the facts say', () => {
  const f = recordFacts();
  const readme = readFileSync('README.md', 'utf8');
  it('the "How to run" audit line = the audit today', () => {
    expect(readme).toContain(`# → ${f.receipts} receipts · ${f.paid} paid inside · ${f.stopped} stopped · 0 mismatch · ${f.replays} replay${f.replays === 1 ? "" : "s"} stopped · paid ${f.paidUsdt} USDT → OK`);
  });
  it('the Kiln row quotes the calls, tokens, USD and Wh of docs/tokens-by-flow.md', () => {
    const row = readme.split('\n').find((l) => l.startsWith('| Kiln Integration & Efficiency'))!;
    expect(row).toContain(`${f.kilnCalls} calls, ${f.tokens} tokens, $${f.usd}, ≈${f.wh} Wh`);
  });
  // V1 2026-09-29: from receipt #13 on, every Kiln call ran on the organizer-issued team32 key. The README's account line quotes the
  // distinct calls, tokens and USD of exactly those records (receipts #13+, answer lines 19+, MCP host calls outside receipts).
  it('the organizer-issued Kiln account line = the distinct Kiln usage recorded on it', () => {
    const all = parseReceiptsFile(readFileSync(LIVE_RECEIPTS, 'utf8')).receipts;
    const answers = readJsonl<AnswerRecord>(LIVE_ANSWERS).filter((a, i) => a.usage && i + 1 >= 19);
    const m = new Map([...all.filter((r) => r.seq >= 13).flatMap((r) => r.flows), ...answers.map((a) => a.usage!), ...hostCallsOutsideReceipts(all)].map((u) => [u.generationId, u]));
    const usage = [...m.values()];
    const tokens = usage.reduce((t, u) => t + u.promptTokens + u.completionTokens, 0);
    const usd = usage.reduce((t, u) => t + u.costUsd, 0);
    expect(readme).toContain(`**organizer-issued Kiln account** (team32, key made 2026-09-29 12:00 KST): ${usage.length} calls, ${tokens.toLocaleString('en-US')} tokens, $${usd.toFixed(7)} in the record`);
  });
  it('the test count in "What is verified" = the tests in tests/', () => {
    expect(readme).toContain(`- \`npm test\` → ${countTests()} tests green`);
  });
  // v1.1 AC-40: the "New in v1.1" row quotes the two-witness numbers of the saved Kiln answers.
  it('the two-witness numbers = npm run attest -- --saved on the record', () => {
    const a = f.attest!;
    expect(readme).toContain(`**${a.match} / ${a.shown} rows (${a.calls} Kiln calls) match Kiln's record**`);
    expect(readme).toContain(`**${a.f1Before} / ${a.f1} \`pay()\` attempts (${a.payingCalls} Kiln calls) are dated ${a.leadMin}–${a.leadMax} s after their Kiln call**`);
    expect(readme).toContain(`(${a.argsBound} / ${a.argsBound})`);
    expect(readFileSync('docs/kiln-attest.txt', 'utf8')).toContain(`${a.match} MATCH · 0 DIFFERS · 0 NOT_FOUND`);
  });
  it('the version in package.json is the one the README evidence table states', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(readme).toContain(`## Acceptance criteria → evidence (status 2026-09-29, v${version})`);
  });
});
