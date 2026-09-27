// M0-11: Kiln tokens / cost / latency / Wh per flow → docs/tokens-by-flow.md (keyless: reads public record files only).
// usage: npm run report [-- --receipts docs/receipts-nile-live.jsonl --answers docs/answers-nile-live.jsonl --ab docs/ab-no-think-2026-09-26.json --out docs/tokens-by-flow.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readJsonl } from '../src/adapters/files';
import { parseReceiptsFile } from '../src/application/auditRecords';
import type { AnswerRecord } from '../src/application/ports';
import { formatAb, formatFlowReport, formatToolAb, revisionNotes } from '../src/application/report';
import { abSummary, flowReport, type AbPair } from '../src/domain/flowReport';
import { flag, LIVE_ANSWERS, LIVE_RECEIPTS } from '../src/infrastructure/runtime';

const args = process.argv.slice(2);
const receiptsFile = flag(args, '--receipts') ?? LIVE_RECEIPTS;
const answersFile = flag(args, '--answers') ?? LIVE_ANSWERS;
const abFile = flag(args, '--ab') ?? 'docs/ab-no-think-2026-09-26.json';
const out = flag(args, '--out') ?? 'docs/tokens-by-flow.md';

const receipts = parseReceiptsFile(readFileSync(receiptsFile, 'utf8')).receipts;
const answers = readJsonl<AnswerRecord>(answersFile);
const records = [...receipts.flatMap((r) => r.flows), ...answers.flatMap((a) => (a.usage ? [a.usage] : []))];
const report = flowReport(records, { purchases: receipts.length });
let md = formatFlowReport(report, {
  title: 'Kiln tokens by flow — Spendline live run on TRON Nile (2026-09-26, qwen3-32b)',
  sources: [receiptsFile, answersFile],
  wattsSource: 'FuriosaAI RNGD card TDP — "180W TDP", furiosa.ai/rngd, checked 2026-09-26',
  notes: [
    ...revisionNotes(answers.filter((a) => a.usage).map((a) => a.key)),
    'Prompt revisions came from live answers: v1 → times to the second and a code-written STOP relation → numbers only from the facts (see the commit log).',
  ],
});
if (existsSync(abFile)) {
  const ab = JSON.parse(readFileSync(abFile, 'utf8')) as { date: string; pairs: AbPair[] };
  md += '\n' + formatAb(abSummary(ab.pairs), { file: abFile, date: ab.date });
}
for (const run of ['run1', 'run2']) {
  const file = `docs/ab-tool-call-2026-09-28-${run}.json`;
  if (!existsSync(file)) continue;
  const t = JSON.parse(readFileSync(file, 'utf8')) as { date: string; note?: string; pairs: AbPair[] };
  md += '\n' + formatToolAb(abSummary(t.pairs), { file, date: t.date }).replace('## F1 tool call vs text JSON', `## F1 tool call vs text JSON (${run})`);
  if (t.note) md += `- ${t.note}\n`;
}
md += `\nRegenerate: \`npm run report\` (reads the files above; no key).\n`;
writeFileSync(out, md);
console.log(`${out}: ${report.total.calls} Kiln calls · ${report.total.totalTokens} tokens · $${report.total.costUsd.toFixed(7)} · ${report.total.wh.toFixed(4)} Wh (est.) · stand-ins excluded ${report.standIns}`);
