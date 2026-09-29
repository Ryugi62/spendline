// AC-40 — report for the two-witness check (pure formatting; the comparison is src/domain/attest.ts).
import type { AttestResult, AttestRow } from '../domain/attest';

const kst = (unix: number) => new Date((unix + 9 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST';
const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export type AttestSummary = { calls: number; match: number; differs: number; notFound: number; otherAccount: number; f1: number; f1Before: number; medianLeadSec?: number; medianKilnLatencyMs?: number };
export function summarizeAttest(r: AttestResult): AttestSummary {
  const f1 = r.rows.filter((x) => x.flow === 'F1_intent' && x.kilnAt !== undefined);
  const leads = f1.flatMap((x) => (x.leadSec !== undefined ? [x.leadSec] : []));
  const lat = r.rows.flatMap((x) => (x.kilnLatencyMs !== undefined ? [x.kilnLatencyMs] : []));
  return {
    calls: r.rows.length, ...r.counts, f1: f1.length, f1Before: leads.filter((s) => s >= 0).length,
    ...(leads.length ? { medianLeadSec: median(leads) } : {}), ...(lat.length ? { medianKilnLatencyMs: median(lat) } : {}),
  };
}

export const attestExitCode = (r: AttestResult): 0 | 1 => (r.counts.differs === 0 && r.counts.notFound === 0 && r.counts.match > 0 ? 0 : 1);

const line = (x: AttestRow) => {
  const who = x.flow === 'F1_intent' ? (x.seq === null ? 'MCP host' : `F1 #${x.seq}`) : `${x.flow === 'F2_explain' ? 'F2' : 'F3'} on #${x.seq ?? '-'}`;
  const when = x.kilnAt !== undefined ? ` · Kiln ${kst(Math.floor(x.kilnAt))}` + (x.payAt !== undefined ? ` → pay() ${kst(x.payAt)} (+${x.leadSec} s)` : '') : '';
  return `${x.status.padEnd(9)} ${who.padEnd(9)} ${x.generationId}${when}${x.diffs.length ? ` — ${x.diffs.join('; ')}` : ''}`;
};

export function formatAttest(r: AttestResult, o: { source: string; scopeNote?: string }): string {
  const s = summarizeAttest(r);
  const head = [
    `Two witnesses — Kiln's own record (${o.source}) vs the receipts whose hashes are on TRON`,
    `${s.calls} Kiln calls in the record · ${s.match} MATCH · ${s.differs} DIFFERS · ${s.notFound} NOT_FOUND` + (s.otherAccount ? ` · ${s.otherAccount} made on another Kiln account (${o.scopeNote ?? 'outside the scope'})` : ''),
    `F1: ${s.f1Before} / ${s.f1} model calls Kiln shows are dated before the payment they led to` + (s.medianLeadSec !== undefined ? ` (median ${s.medianLeadSec} s before pay())` : ''),
    ...(s.medianKilnLatencyMs !== undefined ? [`Kiln-side latency, median over the ${s.match + s.differs} calls Kiln shows: ${s.medianKilnLatencyMs} ms`] : []),
    '',
  ];
  return [...head, ...r.rows.map(line), '', attestExitCode(r) === 0 ? `OK — every model call this Kiln account made is on Kiln's record as written (${s.match} / ${s.match})` : 'NOT OK — see the rows above'].join('\n');
}
