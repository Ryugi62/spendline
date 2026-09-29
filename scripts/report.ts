// M0-11: Kiln tokens / cost / latency / Wh per flow → docs/tokens-by-flow.md (keyless: reads public record files only).
// usage: npm run report [-- --receipts docs/receipts-nile-live.jsonl --answers docs/answers-nile-live.jsonl --ab docs/ab-no-think-2026-09-26.json --out docs/tokens-by-flow.md]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readJsonl } from '../src/adapters/files';
import { parseReceiptsFile } from '../src/application/auditRecords';
import type { AnswerRecord } from '../src/application/ports';
import { formatAb, formatFlowReport, formatHostRuns, formatServerEnergy, formatToolAb, hostRunsSummary, revisionNotes, type HostRunLog } from '../src/application/report';
import { abSummary, flowReport, serverTimeEnergy, type AbPair } from '../src/domain/flowReport';
import type { UsageRecord } from '../src/domain/tokenLedger';
import { canonical } from '../src/domain/receipt';
import { flag, LIVE_ANSWERS, LIVE_RECEIPTS } from '../src/infrastructure/runtime';
import { hostCallsOutsideReceipts, withHostFlows } from '../src/infrastructure/host-runs';

const args = process.argv.slice(2);
const receiptsFile = flag(args, '--receipts') ?? LIVE_RECEIPTS;
const answersFile = flag(args, '--answers') ?? LIVE_ANSWERS;
const abFile = flag(args, '--ab') ?? 'docs/ab-no-think-2026-09-26.json';
const out = flag(args, '--out') ?? 'docs/tokens-by-flow.md';

const recorded = parseReceiptsFile(readFileSync(receiptsFile, 'utf8')).receipts;
const receipts = withHostFlows(recorded); // MCP host planner calls reported as F4 (the file keeps its labels and hashes)
const answers = readJsonl<AnswerRecord>(answersFile);
const records = [...receipts.flatMap((r) => r.flows), ...answers.flatMap((a) => (a.usage ? [a.usage] : [])), ...hostCallsOutsideReceipts(recorded)];
const report = flowReport(records, { purchases: receipts.filter((r) => r.flows.some((u) => u.flow === 'F1_intent')).length });
let md = formatFlowReport(report, {
  title: 'Kiln tokens by flow — Spendline live record on TRON Nile (2026-09-26 → 2026-09-29, qwen3-32b)',
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
const energyFile = 'docs/energy-server-time-2026-09-28.json';
if (existsSync(energyFile)) {
  const en = JSON.parse(readFileSync(energyFile, 'utf8')) as { date: string; calls: { usage: UsageRecord; parsed: boolean }[] };
  const via = en.calls.map((c) => c.usage.via);
  const paths = `F1 paths: tool_calls ${via.filter((v) => v === 'tool_call').length} · call leaked into text ${via.filter((v) => v === 'tool_call_in_text').length} · plain JSON ${via.filter((v) => v === 'text').length} — parsed ${en.calls.filter((c) => c.parsed).length} / ${en.calls.length}`;
  md += '\n' + formatServerEnergy(serverTimeEnergy(en.calls.map((c) => c.usage)), { file: energyFile, date: en.date, paths });
}
const hostLogs = existsSync('docs/live') ? readdirSync('docs/live').filter((n) => /^mcp-host-.*\.json$/.test(n)).sort() : [];
if (hostLogs.length) {
  const f1 = receipts.flatMap((r) => r.flows).filter((u) => u.flow === 'F1_intent' && u.via !== undefined); // F1 with the tool offered (v0.7+)
  const own = f1.filter((u) => !hostLogs.some((n) => readFileSync(`docs/live/${n}`, 'utf8').includes(u.generationId))).map((u) => u.promptTokens).sort((a, b) => a - b);
  const median = own.length % 2 ? own[(own.length - 1) / 2] : (own[own.length / 2 - 1] + own[own.length / 2]) / 2;
  // the published pass-through journals say what each stock-host call asked for: a pay, a read of the line, or nothing (the answer)
  const journal = readdirSync('docs/live').filter((n) => /^kiln-journal-.*\.jsonl$/.test(n)).flatMap((n) => readFileSync(`docs/live/${n}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { generationId: string; toolCalls: { name: string; arguments: string }[] }));
  const readCalls = new Set(journal.filter((e) => e.toolCalls.length && e.toolCalls.every((t) => t.name === 'spendline_line')).map((e) => e.generationId));
  const logs = hostLogs.map((n) => {
    const log = JSON.parse(readFileSync(`docs/live/${n}`, 'utf8')) as HostRunLog & { host?: string };
    // a stock-host step that got no witness id in its reply (a repeat) takes it from the journal call with the same arguments
    for (const st of log.steps) if (!st.generationId && st.tool === 'spendline_pay') {
      const e = journal.find((x) => log.calls.some((c) => c.generationId === x.generationId) && x.toolCalls.some((t) => t.name === 'spendline_pay' && canonical(JSON.parse(t.arguments)) === canonical((st as { args?: unknown }).args ?? {})));
      if (e) st.generationId = e.generationId;
    }
    return log;
  });
  const sdk = (l: { host?: string }) => (l.host ?? '').includes('agents');
  md += formatHostRuns(hostRunsSummary(logs, { readCalls }), { f1MedianPrompt: median });
  const line = (name: string, h: ReturnType<typeof hostRunsSummary>) => `- ${name}: ${h.runs} runs · ${h.calls} Kiln calls · ${h.newReceipts} new receipts (${h.newReceipts ? (h.calls / h.newReceipts).toFixed(2) : '—'} calls per receipt) · ${h.tokens.toLocaleString('en-US')} tokens\n`;
  md += line("Spendline's own host (`npm run mcp:host`)", hostRunsSummary(logs.filter((l) => !sdk(l)), { readCalls }));
  md += line('the stock OpenAI Agents SDK through the Kiln pass-through (`npm run host:agents-sdk -- --live`)', hostRunsSummary(logs.filter(sdk), { readCalls }));
}
md += `\nRegenerate: \`npm run report\` (reads the files above; no key).\n`;
writeFileSync(out, md);
console.log(`${out}: ${report.total.calls} Kiln calls · ${report.total.totalTokens} tokens · $${report.total.costUsd.toFixed(7)} · ${report.total.wh.toFixed(4)} Wh (est.) · stand-ins excluded ${report.standIns}`);
