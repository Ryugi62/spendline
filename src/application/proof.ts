// AC-38 — organizer's required item 4: "Proof of API usage in your README (on-chain tx hashes + Kiln API call logs, per flow)".
// Pure: joins each Kiln call (generation id, tokens, USD) to the on-chain event of the receipt it belongs to.
import type { ChainEvent } from '../domain/audit';
import type { Receipt } from '../domain/receipt';
import { isKilnCall, type UsageRecord } from '../domain/tokenLedger';
import type { AnswerRecord } from './ports';

type Call = Pick<UsageRecord, 'generationId' | 'promptTokens' | 'completionTokens' | 'costUsd' | 'via' | 'serverMs'>;
export type F1Row = Call & { seq: number; at: number; words: string; outcome: string; txHash?: string };
export type AnswerRow = Call & { seq: number | null; question?: string; shown: boolean; txHash?: string };
export type Proof = { f1: F1Row[]; f2: AnswerRow[]; f3: AnswerRow[]; /** v1.1 AC-44: MCP host planner calls that led to a pay() */ f4: F1Row[]; /** host calls in no receipt */ f4Other: Call[]; excludedStandIns: number; findings: string[] };

const call = (u: UsageRecord): Call => ({
  generationId: u.generationId, promptTokens: u.promptTokens, completionTokens: u.completionTokens, costUsd: u.costUsd,
  ...(u.via ? { via: u.via } : {}), ...(u.serverMs !== undefined ? { serverMs: u.serverMs } : {}),
});

export function proofByFlow(o: { receipts: Receipt[]; events: ChainEvent[]; answers: AnswerRecord[]; hostCalls?: UsageRecord[]; /** generation id → the person's request, from the MCP host logs (receipts before v1.1 did not keep it) */ requestOf?: Map<string, string> }): Proof {
  const firstEvent = new Map<string, Extract<ChainEvent, { receiptHash: string }>>();
  for (const e of o.events) if ((e.kind === 'paid' || e.kind === 'blocked') && !firstEvent.has(e.receiptHash)) firstEvent.set(e.receiptHash, e);
  const txOfSeq = new Map<number, string>();
  const findings: string[] = [];
  let excludedStandIns = 0;
  const f1: F1Row[] = [];
  const f4: F1Row[] = [];
  for (const r of o.receipts) {
    const ev = firstEvent.get(r.hash);
    if (ev) txOfSeq.set(r.seq, ev.txHash);
    for (const u of r.flows) {
      if (!isKilnCall(u)) { excludedStandIns++; continue; }
      if (!ev) findings.push(`receipt #${r.seq} (${u.generationId}) has no on-chain event`);
      (u.flow === 'F4_mcp_host' ? f4 : f1).push({ ...call(u), seq: r.seq, at: r.request.at, words: r.asked ?? (o.requestOf?.has(u.generationId) ? `${o.requestOf.get(u.generationId)} (host log)` : r.intentText), outcome: !ev ? 'no event' : ev.kind === 'paid' ? 'paid' : `stopped ${ev.reason}`, ...(ev ? { txHash: ev.txHash } : {}) });
    }
  }
  const rows = (flow: AnswerRecord['flow']): AnswerRow[] =>
    o.answers.flatMap((a) => {
      if (a.flow !== flow || !a.usage) return [];
      if (!isKilnCall(a.usage)) { excludedStandIns++; return []; }
      const tx = a.txHash ?? (a.seq !== null ? txOfSeq.get(a.seq) : undefined);
      return [{ ...call(a.usage), seq: a.seq, ...(a.question ? { question: a.question } : {}), shown: a.grounded, ...(tx ? { txHash: tx } : {}) }];
    });
  const f2 = rows('F2_explain');
  const f3 = rows('F3_dispute');
  const f4Other = (o.hostCalls ?? []).filter(isKilnCall).map(call);
  return { f1, f2, f3, f4, f4Other, excludedStandIns, findings };
}

const kst = (unix: number) => new Date((unix + 9 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST';
const txLink = (tx: string | undefined, network: string) => (tx ? `[${tx.slice(0, 6)}…](https://${network}.tronscan.org/#/transaction/${tx})` : '—');
const usd = (n: number) => `$${n.toFixed(7)}`;
const cell = (s: string) => s.replace(/\|/g, '\\|');

export function formatProof(p: Proof, o: { network: string }): string {
  const rows = [...p.f1, ...p.f2, ...p.f3, ...p.f4, ...p.f4Other];
  const all = [...new Map(rows.map((r) => [r.generationId, r])).values()]; // one Kiln reply can back several receipts: count the call once
  const calls = all.length;
  const tokens = all.reduce((n, r) => n + r.promptTokens + r.completionTokens, 0);
  const cost = all.reduce((n, r) => n + r.costUsd, 0);
  let md = `${calls} Kiln calls${rows.length !== calls ? ` (${rows.length} rows)` : ''} · ${tokens} tokens · ${usd(cost)} (Kiln \`usage.cost\`) · every row = one Kiln response with its \`X-Neocloud-Generation-Id\`, joined to the on-chain event of the receipt it belongs to. Stand-in usage excluded: ${p.excludedStandIns}.${p.findings.length ? ` **Findings: ${p.findings.join('; ')}.**` : ' Findings: 0 (every receipt has its on-chain event).'}\n\n`;
  md += `### F1 intent — one Kiln call per purchase attempt → \`pay()\` on-chain\n| # | Time (request) | Request words | Kiln generation id | Tokens in / out | USD | F1 via · Kiln server time | Vault outcome | On-chain tx |\n|---:|---|---|---|---:|---:|---|---|---|\n`;
  for (const r of p.f1) md += `| ${r.seq} | ${kst(r.at)} | ${cell(r.words)} | \`${r.generationId}\` | ${r.promptTokens} / ${r.completionTokens} | ${usd(r.costUsd)} | ${r.via ?? '—'}${r.serverMs !== undefined ? ` · ${(r.serverMs / 1000).toFixed(2)} s` : ''} | ${r.outcome} | ${txLink(r.txHash, o.network)} |\n`;
  const answerTable = (title: string, rows: AnswerRow[]) => {
    let t = `\n### ${title}\n| About receipt | Question | Kiln generation id | Tokens in / out | USD | Reply shown (echoes the audit) | Receipt's on-chain tx |\n|---:|---|---|---:|---:|---|---|\n`;
    for (const r of rows) t += `| ${r.seq === null ? '—' : `#${r.seq}`} | ${r.question ? cell(r.question) : '(explain this receipt)'} | \`${r.generationId}\` | ${r.promptTokens} / ${r.completionTokens} | ${usd(r.costUsd)} | ${r.shown ? 'yes' : 'held back'} | ${txLink(r.txHash, o.network)} |\n`;
    return t;
  };
  md += answerTable('F2 explain — why was this receipt stopped / paid?', p.f2);
  md += answerTable('F3 dispute — a teammate\'s question → which receipt', p.f3);
  if (p.f4.length || p.f4Other.length) {
    md += `\n### F4 MCP host (v1.1) — Qwen3-32B on Kiln plans a general agent → \`spendline_pay\` → \`pay()\` on-chain\n| # | Time (request) | The person's words | Kiln generation id | Tokens in / out | USD | via | Vault outcome | On-chain tx |\n|---:|---|---|---|---:|---:|---|---|---|\n`;
    for (const r of p.f4) md += `| ${r.seq} | ${kst(r.at)} | ${cell(r.words)} | \`${r.generationId}\` | ${r.promptTokens} / ${r.completionTokens} | ${usd(r.costUsd)} | ${r.via ?? '—'} | ${r.outcome} | ${txLink(r.txHash, o.network)} |\n`;
    if (p.f4Other.length) md += `\nHost calls in no receipt (a closing answer, a call refused before the chain, a call the host could not parse — docs/live/mcp-host-*.json): ${p.f4Other.map((c) => `\`${c.generationId}\` ${c.promptTokens} / ${c.completionTokens} ${usd(c.costUsd)}`).join(' · ')}\n`;
  }
  return md;
}
