import type { AbSummary, FlowReport, FlowRow } from '../domain/flowReport';

/** Markdown for docs/tokens-by-flow.md (M0-11) and its /no_think section (M0-12). Numbers come from domain/flowReport only. */
const WHAT: Record<string, string> = {
  F1_intent: 'request words → `{item, quantity, maxUnitPrice?, merchantHint?}`; code picks the offer and does the money math',
  F2_explain: 'audit facts → two plain sentences about one receipt (shown only if it echoes the audit verdict)',
  F3_dispute: "a teammate's question → which receipt it is about (verdict always from the audit)",
};
const NAME: Record<string, string> = { F1_intent: 'F1 intent', F2_explain: 'F2 explain', F3_dispute: 'F3 dispute' };
const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const usd = (x: number) => `$${x.toFixed(7)}`;

function line(r: FlowRow): string {
  return `| ${NAME[r.flow]} | ${WHAT[r.flow]} | ${r.calls} | ${r.promptTokens} | ${r.completionTokens} | ${r.totalTokens} | ${usd(r.costUsd)} | ${s(r.latencyMedianMs)} | ${s(r.latencyTotalMs)} | ${r.wh.toFixed(4)} | ${r.whPerCall.toFixed(4)} |`;
}

export function formatFlowReport(r: FlowReport, o: { title: string; sources: string[]; wattsSource: string }): string {
  const t = r.total;
  const perPurchaseWh = r.rows[0].calls ? r.rows[0].whPerCall : 0;
  return [
    `# ${o.title}`,
    '',
    `Sources: ${o.sources.map((x) => `\`${x}\``).join(' · ')}. Every row is a real Kiln call (qwen3-32b) with its \`X-Neocloud-Generation-Id\`; usage without one is not counted. Stand-in usage excluded: ${r.standIns} record${r.standIns === 1 ? '' : 's'}.`,
    '',
    '| Flow | What the model does | Calls | Prompt tokens | Output tokens | Total tokens | USD (Kiln `usage.cost`) | Median latency | Total wall time | Wh (est.) | Wh / call (est.) |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...r.rows.map(line),
    `| **Total** | | **${t.calls}** | **${t.promptTokens}** | **${t.completionTokens}** | **${t.totalTokens}** | **${usd(t.costUsd)}** | ${s(t.latencyMedianMs)} | **${s(t.latencyTotalMs)}** | **${t.wh.toFixed(4)}** | ${t.whPerCall.toFixed(4)} |`,
    '',
    `- LLM calls per purchase: **${r.callsPerPurchase.toFixed(2)}** (${r.rows[0].calls} F1 calls / ${r.purchases} receipts) — the design limit is 2. Offer choice, money math, the rule and the receipt are code: no call is spent on them.`,
    '- F2 and F3 run only when a person asks, and the same question on the same record is answered from the answers log with 0 calls.',
    `- Energy per purchase (F1, est.): **${perPurchaseWh.toFixed(4)} Wh**.`,
    '',
    '## Energy — an assumption, not a measurement',
    `Kiln exposes no power telemetry, so Wh = ${r.npuWatts} W × measured wall time ÷ 3600 per call. ${r.npuWatts} W source: ${o.wattsSource}. It is an upper bound: ${r.assumption}. Wall time is measured at the client, so it also includes network time.`,
    '',
    '## Generation ids (Kiln `X-Neocloud-Generation-Id`)',
    ...r.rows.filter((x) => x.calls).map((x) => `- ${NAME[x.flow]}: ${x.generationIds.map((g) => `\`${g}\``).join(' · ')}`),
    '',
  ].join('\n');
}

export function formatAb(a: AbSummary, o: { file: string; date: string }): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const armRow = (name: string, x: AbSummary['off']) => `| ${name} | ${x.n} | ${pct(x.parseRate)} | ${x.medianCompletion} | ${s(x.medianLatencyMs)} | ${x.medianWh.toFixed(4)} | ${usd(x.costUsd)} |`;
  return [
    `## /no_think A/B — n = ${a.n} pairs${a.note ? ` (${a.note})` : ''}`,
    `Same F1 request, sent once with Qwen3's \`/no_think\` soft switch and once with thinking on, pairs in alternating order, ${o.date}. Raw calls with generation ids: \`${o.file}\`.`,
    '',
    '| Arm | n | JSON parsed | Median output tokens | Median latency | Median Wh (est.) | USD total |',
    '|---|---:|---:|---:|---:|---:|---:|',
    armRow('`/no_think` (production)', a.off),
    armRow('thinking on', a.on),
    '',
    `- Same JSON (item · quantity · price cap · seller hint): ${a.sameJson} / ${a.n} pairs.`,
    `- \`/no_think\` saves ${a.completionSavedPct.toFixed(0)}% of median output tokens and ${a.latencySavedPct.toFixed(0)}% of median latency (≈ the same share of estimated Wh).`,
    '',
  ].join('\n');
}
