// AC-40 — report for the two-witness check (pure formatting; the comparison is src/domain/attest.ts).
import { MAX_LEAD_SEC, type AttestResult, type AttestRow } from '../domain/attest';

const kst = (unix: number) => new Date((unix + 9 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST';
const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export type AttestSummary = {
  calls: number; match: number; differs: number; notFound: number; otherAccount: number; noKilnCall: number;
  /** distinct Kiln calls among the paying rows · rows flagged for a shared generation */
  payingCalls: number; shared: number;
  /** calls that led to a payment (F1 or MCP host with a pay() event) · of those dated before and within the limit */
  paying: number; payingBefore: number; medianLeadSec?: number; minLeadSec?: number; maxLeadSec?: number;
  medianKilnLatencyMs?: number; whPerCallKiln?: number; cached?: number; prompt?: number; argsBound: number; argsRows: number;
};
export function summarizeAttest(r: AttestResult, watts = 180): AttestSummary {
  const paying = r.rows.filter((x) => x.leadSec !== undefined);
  const leads = paying.map((x) => x.leadSec!);
  const unique = [...new Map(r.rows.filter((x) => x.generationId).map((x) => [x.generationId, x])).values()]; // stats per Kiln call, not per receipt
  const lat = unique.flatMap((x) => (x.kilnLatencyMs !== undefined ? [x.kilnLatencyMs] : []));
  const withCache = unique.filter((x) => x.cachedTokens !== undefined);
  const med = median(lat);
  return {
    calls: r.rows.length, ...r.counts, paying: paying.length, payingCalls: new Set(paying.map((x) => x.generationId)).size, shared: r.rows.filter((x) => x.diffs.some((d) => d.startsWith('generation id also on') || d.startsWith('generation shared'))).length, payingBefore: paying.filter((x) => x.leadSec! >= 0 && x.leadSec! <= MAX_LEAD_SEC).length,
    ...(leads.length ? { medianLeadSec: median(leads), minLeadSec: Math.min(...leads), maxLeadSec: Math.max(...leads) } : {}),
    ...(med !== undefined ? { medianKilnLatencyMs: med, whPerCallKiln: (watts * med) / 3_600_000 } : {}),
    ...(withCache.length ? { cached: withCache.reduce((n, x) => n + x.cachedTokens!, 0), prompt: withCache.reduce((n, x) => n + x.promptTokens!, 0) } : {}),
    argsBound: r.rows.filter((x) => x.argsBound === true).length, argsRows: r.rows.filter((x) => x.argsBound !== undefined).length,
  };
}

export const attestExitCode = (r: AttestResult): 0 | 1 => (r.counts.differs === 0 && r.counts.notFound === 0 && r.counts.noKilnCall === 0 && r.counts.match > 0 ? 0 : 1);

const line = (x: AttestRow) => {
  const who = x.flow === 'F1_intent' ? `F1 #${x.seq}` : x.flow === 'F4_mcp_host' ? (x.seq === null ? 'F4 host' : `F4 #${x.seq}`) : `${x.flow === 'F2_explain' ? 'F2' : 'F3'} on #${x.seq ?? '-'}`;
  const when = x.kilnAt !== undefined ? ` · Kiln ${kst(Math.floor(x.kilnAt))}` + (x.payAt !== undefined ? ` → pay() ${kst(x.payAt)} (+${x.leadSec} s)` : '') : '';
  const bound = x.argsBound === undefined ? '' : x.argsBound ? ' · args → payment ✓' : ' · args → payment ✗';
  return `${x.status.padEnd(9)} ${who.padEnd(9)} ${x.generationId}${when}${bound}${x.diffs.length ? ` — ${x.diffs.join('; ')}` : ''}`;
};

export function formatAttest(r: AttestResult, o: { source: string; scopeNote?: string; journal?: { inJournal: number; checked: number; mismatches: string[]; files: number; bodies?: { checked: number; ok: number; bad: string[]; hashMatch?: number; callsMatch?: number; kilnMatch?: number } } }): string {
  const s = summarizeAttest(r);
  const head = [
    `Two witnesses — Kiln's own record (${o.source}) vs the receipts whose hashes are on TRON`,
    `${new Set(r.rows.filter((x) => x.generationId).map((x) => x.generationId)).size} Kiln calls in the record (${s.calls} rows — one reply with several tool calls backs several receipts) · ${s.match} MATCH · ${s.differs} DIFFERS · ${s.notFound} NOT_FOUND · ${s.noKilnCall} NO_KILN_CALL` + (s.otherAccount ? ` · ${s.otherAccount} made on another Kiln account (${o.scopeNote ?? 'outside the scope'})` : ''),
    `pay() attempts decided on Kiln: ${s.payingBefore} / ${s.paying} dated after their Kiln call and within ${MAX_LEAD_SEC} s (${s.payingCalls} Kiln calls)` + (s.medianLeadSec !== undefined ? ` (${s.minLeadSec}–${s.maxLeadSec} s, median ${s.medianLeadSec} s)` : '') + (s.shared ? ` · ${s.shared} rows share a generation wrongly` : ' · no (generation, arguments) backs two receipts, no generation spans two requests'),
    ...(s.argsRows ? [`The model's own arguments re-derive the payment (seller, item × quantity + fee from the catalog): ${s.argsBound} / ${s.argsRows}`] : []),
    ...(o.journal && o.journal.checked ? [`Published pass-through journal (${o.journal.files} file${o.journal.files === 1 ? '' : 's'}, docs/live/kiln-journal-*.jsonl): ${o.journal.inJournal} / ${o.journal.checked} bound receipts' arguments appear in it byte for byte${o.journal.mismatches.length ? ` — ${o.journal.mismatches.join('; ')}` : ''}` + (o.journal.bodies?.checked ? ` · Kiln's reply bodies, published: ${o.journal.bodies.ok} / ${o.journal.bodies.checked} hash to the journal's sha256, re-parse to its tool calls${o.journal.bodies.kilnMatch !== undefined ? ` and carry the tokens, cost and time Kiln's own record has for that id` : ''}${o.journal.bodies.bad.length ? ` (not: ${o.journal.bodies.bad.join('; ')})` : ''}` : '')] : []),
    ...(s.medianKilnLatencyMs !== undefined ? [`On Kiln's own clock (per call): median latency ${s.medianKilnLatencyMs} ms → ≈${s.whPerCallKiln!.toFixed(4)} Wh per call at 180 W (an estimate)` + (s.prompt ? ` · prompt tokens served from Kiln's cache: ${s.cached} / ${s.prompt} (${Math.round((100 * s.cached!) / s.prompt)}%)` : '')] : []),
    '',
  ];
  return [...head, ...r.rows.map(line), '', attestExitCode(r) === 0 ? `OK — every call in the record made on this Kiln account matches Kiln's own record (${s.match} / ${s.match} rows)` : 'NOT OK — see the rows above'].join('\n');
}
