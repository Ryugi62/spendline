// M0-11: Kiln tokens / cost / latency / Wh per flow → docs/tokens-by-flow.md (keyless: reads public record files only).
// usage: npm run report [-- --receipts docs/receipts-nile-live.jsonl --answers docs/answers-nile-live.jsonl --ab docs/ab-no-think-2026-09-26.json --out docs/tokens-by-flow.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readJsonl } from '../src/adapters/files';
import { parseReceiptsFile } from '../src/application/auditRecords';
import type { AnswerRecord } from '../src/application/ports';
import { formatAb, formatFlowReport } from '../src/application/report';
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
});
if (existsSync(abFile)) {
  const ab = JSON.parse(readFileSync(abFile, 'utf8')) as { date: string; pairs: AbPair[] };
  md += '\n' + formatAb(abSummary(ab.pairs), { file: abFile, date: ab.date });
}
md += `\nRegenerate: \`npm run report\` (reads the files above; no key).\n`;
writeFileSync(out, md);
console.log(`${out}: ${report.total.calls} Kiln calls · ${report.total.totalTokens} tokens · $${report.total.costUsd.toFixed(7)} · ${report.total.wh.toFixed(4)} Wh (est.) · stand-ins excluded ${report.standIns}`);
