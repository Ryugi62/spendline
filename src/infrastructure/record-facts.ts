// Facts of the public record for the deck, the pitch and the video (AC-31 / AC-32). Keyless and offline:
// web/public/session.json (receipts + the vault's public events, fetched by `npm run ui:data`) + the answers log + the A/B file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readJsonl } from '../adapters/files';
import type { AnswerRecord } from '../application/ports';
import { pitchFacts, type PitchFacts } from '../application/pitch';
import type { Session } from '../application/views';
import { audit } from '../domain/audit';
import { abSummary, flowReport, type AbPair } from '../domain/flowReport';
import { LIVE_ANSWERS, sha256 } from './runtime';
import { savedAttest } from './attest-record';
import { summarizeAttest } from '../application/attest';
import { hostCallsOutsideReceipts, withHostFlows } from './host-runs';
import { hostRunsSummary, type HostRunLog } from '../application/report';
import { buildStatement } from '../domain/statement';
import { fmtUsdt } from '../domain/money';

/** Numbers our copy may state that are not in the record — each with where it comes from. */
export const STATED = [
  '180 W — FuriosaAI RNGD card TDP ("180W TDP", furiosa.ai/rngd, checked 2026-09-26)',
  'a 3-person AI startup (the user scene in the README)',
  'design limit: 2 LLM calls per purchase (SPEC §1)',
  'the audit exits 1 on any problem, 0 when all check out',
  'Apache-2.0 license',
  'video limit 3:00 · pitch limit 5:00 · the 48 h event window',
  'receipt hash to event: 1 : 1',
];

/** Test cases in tests/*.ts (same count vitest reports: one `it(` per case, no `.each`). */
export function countTests(dir = 'tests'): number {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .reduce((n, f) => n + (readFileSync(`${dir}/${f}`, 'utf8').match(/^\s*it\(/gm) ?? []).length, 0);
}

export function recordFacts(o: { session?: string; answers?: string; ab?: string } = {}): PitchFacts {
  const s = JSON.parse(readFileSync(o.session ?? 'web/public/session.json', 'utf8')) as Session;
  const answers = readJsonl<AnswerRecord>(o.answers ?? LIVE_ANSWERS);
  const ab = JSON.parse(readFileSync(o.ab ?? 'docs/ab-no-think-2026-09-26.json', 'utf8')) as { pairs: AbPair[] };
  const res = audit({ mandates: [], receipts: s.receipts, events: s.events, hash: sha256 });
  const labelled = withHostFlows(s.receipts); // MCP host planner calls as F4 (copies — the audit above uses the receipts as recorded)
  const usage = [...labelled.flatMap((r) => r.flows), ...answers.flatMap((a) => (a.usage ? [a.usage] : [])), ...hostCallsOutsideReceipts(s.receipts)];
  const report = flowReport(usage, { purchases: labelled.filter((r) => r.flows.some((u) => u.flow === 'F1_intent')).length });
  const grants = s.events.filter((e) => e.kind === 'granted');
  const costFile = 'docs/chain-cost-2026-09-28.json';
  const chain = existsSync(costFile) ? (JSON.parse(readFileSync(costFile, 'utf8')) as { summary: { paid: { medianTrx: number }; stopped: { medianTrx: number } } }).summary : undefined;
  const base = pitchFacts(res, report, abSummary(ab.pairs), {
    vault: s.vault,
    tests: countTests(),
    stated: STATED,
    extraTx: s.events.map((e) => e.txHash),
    stopTx: s.events.find((e) => e.kind === 'paused')?.txHash,
    grantTx: grants[0]?.txHash,
    ...(chain ? { chain: { paidTrx: chain.paid.medianTrx, stopTrx: chain.stopped.medianTrx } } : {}),
  });
  // v1.1 — two witnesses (saved Kiln answers, keyless), MCP host runs, the statement's kept total
  const at = savedAttest({ receipts: s.receipts, answers, events: s.events });
  const sa = at ? summarizeAttest(at) : undefined;
  const leads = at?.rows.flatMap((r) => (r.leadSec !== undefined ? [r.leadSec] : [])) ?? [];
  const logs = existsSync('docs/live') ? readdirSync('docs/live').filter((n) => /^mcp-host-.*\.json$/.test(n)).sort().map((n) => JSON.parse(readFileSync(`docs/live/${n}`, 'utf8')) as HostRunLog) : [];
  const h = logs.length ? hostRunsSummary(logs) : undefined;
  const st = buildStatement({ receipts: s.receipts, verdicts: res.verdicts, labels: {}, replays: res.replays.length });
  return {
    ...base,
    ...(at ? { attest: { match: at.counts.match, shown: at.counts.match + at.counts.differs, otherAccount: at.counts.otherAccount, f1Before: leads.filter((x) => x >= 0).length, f1: leads.length, leadMin: Math.min(...leads), leadMax: Math.max(...leads),
      ...(sa?.medianKilnLatencyMs !== undefined ? { kilnMedianMs: sa.medianKilnLatencyMs, whPerCallKiln: sa.whPerCallKiln!.toFixed(4) } : {}), ...(sa?.prompt ? { cachedPct: Math.round((100 * sa.cached!) / sa.prompt) } : {}) } } : {}),
    ...(h ? { mcp: { tools: 3, runs: h.runs, calls: h.calls, attempts: h.payments, receipts: h.newReceipts, paid: h.paid, perReceipt: (h.calls / h.newReceipts).toFixed(2) } } : {}),
    kept: { usdt: fmtUsdt(st.totalKept), stops: st.stopsByReason.reduce((n, x) => n + x.count, 0), distinct: st.refusedDistinct, replays: st.replays },
  };
}
