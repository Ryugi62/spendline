import type { UsageRecord } from '../domain/tokenLedger';
import { toolCallDecision, type AbSummary, type FlowReport, type FlowRow } from '../domain/flowReport';

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

/** Answers-log keys are `F2v<n>:…` / `F3v<n>:…` (plain `F2:` / `F3:` = v1). Every revision was asked on live Kiln, so every call counts. */
export function revisionNotes(keys: string[]): string[] {
  const out: string[] = [];
  for (const [flow, name, per] of [['F2', 'F2 explain', 'receipt'], ['F3', 'F3 dispute', 'question']] as const) {
    const vs = keys.map((k) => k.match(new RegExp(`^${flow}(?:v(\\d+))?:`))).filter(Boolean).map((m) => Number(m![1] ?? 1));
    if (!vs.length) continue;
    const by = [...new Set(vs)].sort((a, b) => a - b).map((v) => `v${v} ×${vs.filter((x) => x === v).length}`);
    out.push(`${name}: ${vs.length} calls = ${by.join(' · ')} (one call per ${per} per prompt version)`);
  }
  return out;
}

export function formatFlowReport(r: FlowReport, o: { title: string; sources: string[]; wattsSource: string; notes?: string[] }): string {
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
    ...(o.notes ?? []).map((n) => `- ${n}`),
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

/** AC-34: tool call (arm `off`) vs text JSON (arm `on`), and the decision the pre-registered rule makes. */
export function formatToolAb(a: AbSummary, o: { file: string; date: string }): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const armRow = (name: string, x: AbSummary['off']) =>
    `| ${name} | ${x.n} | ${pct(x.parseRate)} | ${x.medianPrompt} | ${x.medianCompletion} | ${s(x.medianLatencyMs)} | ${x.medianWh.toFixed(4)} | ${usd(x.costUsd)} |`;
  const d = toolCallDecision(a);
  return [
    `## F1 tool call vs text JSON — n = ${a.n} pairs${a.note ? ` (${a.note})` : ''}`,
    `Same F1 request, once as a Kiln tool call (\`propose_purchase\`, tool_choice auto) and once as JSON in the text reply, both \`/no_think\`, pairs in alternating order, ${o.date}. Raw calls with generation ids: \`${o.file}\`.`,
    '',
    '| Arm | n | Intent parsed | Median prompt tokens | Median output tokens | Median latency | Median Wh (est.) | USD total |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    armRow('tool call `propose_purchase`', a.off),
    armRow('JSON in the text reply', a.on),
    '',
    `- Same intent (item · quantity · price cap · seller hint): ${a.sameJson} / ${a.n} pairs.`,
    `- Rule fixed before the run (SPEC AC-34): tool call only if it parses as often, agrees on ≥ 11 / 12 and is not > 1.2× slower. **Production: ${d.production === 'tool_call' ? 'tool call' : 'text JSON'}** — ${d.why}.`,
    '',
  ].join('\n');
}

/** M1 review: the same calls' Wh from client wall time and from Kiln's upstream time. */
export function formatServerEnergy(e: { calls: number; wallMs: number; serverMs: number; whWall: number; whServer: number }, o: { file: string; date: string; paths?: string }): string {
  return [
    `## Energy with Kiln's server-side time — n = ${e.calls} F1 calls (tool call, \`/no_think\`), ${o.date}`,
    'Kiln returns `x-envoy-upstream-service-time` on every response: the time spent behind Kiln\'s edge. It excludes the network, so it is a tighter upper bound than client wall time — still not NPU busy time (queueing is inside it).',
    '',
    '| Time base | Total | Wh (est., × 180 W) | Wh per F1 call |',
    '|---|---:|---:|---:|',
    `| client wall time | ${s(e.wallMs)} | ${e.whWall.toFixed(4)} | ${(e.whWall / e.calls).toFixed(4)} |`,
    `| Kiln upstream time | ${s(e.serverMs)} | ${e.whServer.toFixed(4)} | ${(e.whServer / e.calls).toFixed(4)} |`,
    '',
    `- Server time is ${Math.round((e.serverMs / e.wallMs) * 100)}% of wall time on these calls${o.paths ? `; ${o.paths}` : ''}. Raw: \`${o.file}\`. New receipts carry \`serverMs\` from v0.7 on.`,
    '',
  ].join('\n');
}

// AC-44 — the Kiln calls of MCP host runs (docs/live/mcp-host-*.json): a general host plans with more calls and longer prompts than F1.
export type HostRunLog = { calls: UsageRecord[]; steps: { tool: string; isError: boolean }[] };
export type HostRunsSummary = { runs: number; calls: number; payments: number; noPayment: number; callsPerPayment: number; medianPromptTokens: number; tokens: number; costUsd: number };
export function hostRunsSummary(runs: HostRunLog[]): HostRunsSummary {
  const calls = runs.flatMap((r) => r.calls);
  const payments = runs.reduce((n, r) => n + r.steps.filter((s) => s.tool === 'spendline_pay' && !s.isError).length, 0);
  const prompts = calls.map((c) => c.promptTokens).sort((a, b) => a - b);
  const mid = prompts.length % 2 ? prompts[(prompts.length - 1) / 2] : (prompts[prompts.length / 2 - 1] + prompts[prompts.length / 2]) / 2;
  return {
    runs: runs.length, calls: calls.length, payments, noPayment: calls.length - payments,
    callsPerPayment: payments ? Math.round((calls.length / payments) * 100) / 100 : 0, medianPromptTokens: mid ?? 0,
    tokens: calls.reduce((n, c) => n + c.promptTokens + c.completionTokens, 0), costUsd: Math.round(calls.reduce((n, c) => n + c.costUsd, 0) * 1e8) / 1e8,
  };
}
export function formatHostRuns(h: HostRunsSummary, o: { f1MedianPrompt: number }): string {
  return `\n## MCP host on Kiln (AC-44) — the same payments through a general agent\n- ${h.runs} runs of \`npm run mcp:host\`: ${h.calls} Kiln calls for ${h.payments} pay attempts that reached the vault (${h.callsPerPayment.toFixed(2)} per attempt; ${h.noPayment} calls decided no payment — closing answers and a refused call) · ${h.tokens.toLocaleString('en-US')} tokens · $${h.costUsd.toFixed(7)}\n- Median prompt ${h.medianPromptTokens} tokens per call vs ${o.f1MedianPrompt} for Spendline's own F1 with the tool offered (1 call per purchase): the purpose-built F1 stays the efficient path; MCP is the path for an agent that already has a planner.\n- The pay calls are inside the F1 row above (each receipt carries its host call, AC-43); the other calls are only here.\n`;
}
