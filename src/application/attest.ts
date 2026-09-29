// AC-40 — report for the two-witness check (pure formatting; the comparison is src/domain/attest.ts).
import { MAX_LEAD_SEC, type AttestResult, type AttestRow } from '../domain/attest';

const kst = (unix: number) => new Date((unix + 9 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST';
const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export type AttestSummary = {
  calls: number; match: number; differs: number; notFound: number; otherAccount: number;
  /** calls that led to a payment (F1 or MCP host with a pay() event) · of those dated before and within the limit */
  paying: number; payingBefore: number; medianLeadSec?: number; minLeadSec?: number; maxLeadSec?: number;
  medianKilnLatencyMs?: number; whPerCallKiln?: number; cached?: number; prompt?: number; argsBound: number; argsRows: number;
};
export function summarizeAttest(r: AttestResult, watts = 180): AttestSummary {
  const paying = r.rows.filter((x) => x.leadSec !== undefined);
  const leads = paying.map((x) => x.leadSec!);
  const lat = r.rows.flatMap((x) => (x.kilnLatencyMs !== undefined ? [x.kilnLatencyMs] : []));
  const withCache = r.rows.filter((x) => x.cachedTokens !== undefined);
  const med = median(lat);
  return {
    calls: r.rows.length, ...r.counts, paying: paying.length, payingBefore: paying.filter((x) => x.leadSec! >= 0 && x.leadSec! <= MAX_LEAD_SEC).length,
    ...(leads.length ? { medianLeadSec: median(leads), minLeadSec: Math.min(...leads), maxLeadSec: Math.max(...leads) } : {}),
    ...(med !== undefined ? { medianKilnLatencyMs: med, whPerCallKiln: (watts * med) / 3_600_000 } : {}),
    ...(withCache.length ? { cached: withCache.reduce((n, x) => n + x.cachedTokens!, 0), prompt: withCache.reduce((n, x) => n + x.promptTokens!, 0) } : {}),
    argsBound: r.rows.filter((x) => x.argsBound === true).length, argsRows: r.rows.filter((x) => x.argsBound !== undefined).length,
  };
}

export const attestExitCode = (r: AttestResult): 0 | 1 => (r.counts.differs === 0 && r.counts.notFound === 0 && r.counts.match > 0 ? 0 : 1);

const line = (x: AttestRow) => {
  const who = x.flow === 'F1_intent' ? `F1 #${x.seq}` : x.flow === 'F4_mcp_host' ? (x.seq === null ? 'F4 host' : `F4 #${x.seq}`) : `${x.flow === 'F2_explain' ? 'F2' : 'F3'} on #${x.seq ?? '-'}`;
  const when = x.kilnAt !== undefined ? ` · Kiln ${kst(Math.floor(x.kilnAt))}` + (x.payAt !== undefined ? ` → pay() ${kst(x.payAt)} (+${x.leadSec} s)` : '') : '';
  const bound = x.argsBound === undefined ? '' : x.argsBound ? ' · args → payment ✓' : ' · args → payment ✗';
  return `${x.status.padEnd(9)} ${who.padEnd(9)} ${x.generationId}${when}${bound}${x.diffs.length ? ` — ${x.diffs.join('; ')}` : ''}`;
};

export function formatAttest(r: AttestResult, o: { source: string; scopeNote?: string }): string {
  const s = summarizeAttest(r);
  const head = [
    `Two witnesses — Kiln's own record (${o.source}) vs the receipts whose hashes are on TRON`,
    `${s.calls} Kiln calls in the record · ${s.match} MATCH · ${s.differs} DIFFERS · ${s.notFound} NOT_FOUND` + (s.otherAccount ? ` · ${s.otherAccount} made on another Kiln account (${o.scopeNote ?? 'outside the scope'})` : ''),
    `Calls that led to a payment: ${s.payingBefore} / ${s.paying} dated before their pay() and within ${MAX_LEAD_SEC} s` + (s.medianLeadSec !== undefined ? ` (${s.minLeadSec}–${s.maxLeadSec} s, median ${s.medianLeadSec} s) · each generation id backs one receipt` : ''),
    ...(s.argsRows ? [`The model's own arguments re-derive the payment (seller, item × quantity + fee from the catalog): ${s.argsBound} / ${s.argsRows}`] : []),
    ...(s.medianKilnLatencyMs !== undefined ? [`On Kiln's own clock: median latency ${s.medianKilnLatencyMs} ms → ≈${s.whPerCallKiln!.toFixed(4)} Wh per call at 180 W (an estimate)` + (s.prompt ? ` · prompt tokens served from Kiln's cache: ${s.cached} / ${s.prompt} (${Math.round((100 * s.cached!) / s.prompt)}%)` : '')] : []),
    '',
  ];
  return [...head, ...r.rows.map(line), '', attestExitCode(r) === 0 ? `OK — every call in the record made on this Kiln account matches Kiln's own record (${s.match} / ${s.match})` : 'NOT OK — see the rows above'].join('\n');
}
