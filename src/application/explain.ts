import { checkExplanation } from '../domain/answers';
import { audit, type ChainEvent, type Verdict } from '../domain/audit';
import { fmtUsdt } from '../domain/money';
import { estimateEnergy } from '../domain/energy';
import type { Hasher, Receipt } from '../domain/receipt';
import { isKilnCall, type UsageRecord } from '../domain/tokenLedger';
import type { Answer, AnswerLog, AnswerRecord, LlmPort } from './ports';
import { REASON_TEXT } from './views';

/**
 * UC-5 explain (flow F2). On demand only, cached in the answers log.
 * Code computes every fact from audit(); Kiln only turns the facts into two plain sentences, and its reply is shown
 * only if it echoes the audit verdict (checkExplanation). Otherwise the code's own sentence is shown.
 */
export type PublicRecord = { receipts: Receipt[]; events: ChainEvent[] };
/** labels: seller address → name from the catalog (public), so answers can say "GPU Shop" instead of an address. */
export type AnswerDeps = { llm: LlmPort; log: AnswerLog; hash: Hasher; labels?: Record<string, string> };

export const EXPLAIN_SYSTEM = [
  'You explain one past payment attempt of an AI purchasing agent to the person who set its spending line.',
  'Use ONLY the facts given. At most two short sentences, plain words, no advice.',
  'Reply with ONE JSON object and nothing else: {"verdict": "<copy the verdict fact>", "reason": "<copy the reason code, or null>", "explanation": "<at most two sentences>"}',
  '/no_think',
].join('\n');

export const utc = (t: number) => new Date(t * 1000).toISOString().replace('T', ' ').replace(/:\d\d\.\d{3}Z$/, ' UTC');
export const sellerName = (addr: string, labels?: Record<string, string>) => (labels?.[addr] ? `${labels[addr]} (${addr})` : addr);

export function explainFacts(r: Receipt, v: Verdict, labels?: Record<string, string>): string[] {
  const q = r.request;
  const listed = v.line ? (v.line.merchants.includes(q.merchant) ? 'yes' : 'no') : 'unknown';
  return [
    `receipt: #${r.seq} · ${utc(q.at)}`,
    `request words: “${r.intentText}”`,
    `seller: ${sellerName(q.merchant, labels)} — on the list: ${listed}`,
    `amount: ${fmtUsdt(q.amount)} USDT + fee ${fmtUsdt(q.fee)} USDT = ${fmtUsdt(q.amount + q.fee)} USDT`,
    v.line
      ? `line in force: budget ${fmtUsdt(v.line.budget)} USDT · per-payment cap ${fmtUsdt(v.line.perTxCap)} USDT · deadline ${utc(v.line.deadline)} · STOP pressed: ${v.line.paused ? 'yes' : 'no'}`
      : 'line in force: unknown (no chain event for this receipt)',
    `spent before this attempt: ${v.spentBefore === undefined ? 'unknown' : `${fmtUsdt(v.spentBefore)} USDT`}`,
    `verdict: ${v.verdict}`,
    `reason: ${v.reason ? `${v.reason} (${REASON_TEXT[v.reason]})` : 'none'}`,
    `chain tx: ${v.txHash ?? 'none'}`,
  ];
}

/** The code's own answer — used whenever the model's reply is not grounded. */
export function templateAnswer(r: Receipt, v: Verdict, labels?: Record<string, string>): string {
  const total = `${fmtUsdt(r.request.amount + r.request.fee)} USDT`;
  const seller = labels?.[r.request.merchant] ?? r.request.merchant;
  switch (v.verdict) {
    case 'PAID_INSIDE':
      return `Paid inside your line: ${total} to ${seller} for “${r.intentText}”. The audit re-ran your rule against the chain record and it agrees.`;
    case 'STOPPED':
      return `Stopped on-chain: ${v.reason ? REASON_TEXT[v.reason] : 'refused'}. ${total} to ${seller} for “${r.intentText}” was refused by the vault, and nothing was paid.`;
    case 'MISMATCH':
      return `Doesn't add up — ${v.why}. Open Audit to see the chain record.`;
    default:
      return `Not on chain — ${v.why}.`;
  }
}

export const fromLog = (a: AnswerRecord): Answer => {
  const { key: _k, usage: _u, ...rest } = a;
  return { ...rest, cached: true };
};

export async function explain(d: AnswerDeps, rec: PublicRecord, seq: number): Promise<Answer> {
  const r = rec.receipts.find((x) => x.seq === seq);
  if (!r) return { flow: 'F2_explain', seq: null, text: `No receipt #${seq} in this record.`, grounded: false, cached: false };
  const key = `F2:${r.hash}`;
  const hit = await d.log.find(key);
  if (hit) return fromLog(hit);

  const v = audit({ mandates: [], receipts: rec.receipts, events: rec.events, hash: d.hash }).verdicts.find((x) => x.seq === seq)!;
  const { text, usage } = await d.llm.chat(
    'F2_explain',
    [
      { role: 'system', content: EXPLAIN_SYSTEM },
      { role: 'user', content: explainFacts(r, v, d.labels).join('\n') },
    ],
    { maxTokens: 200, thinking: false },
  );
  const c = checkExplanation(text, { verdict: v.verdict, reason: v.reason });
  const answer: Answer = {
    flow: 'F2_explain',
    seq,
    verdict: v.verdict,
    reason: v.reason,
    txHash: v.txHash,
    text: c.ok ? c.value : templateAnswer(r, v, d.labels),
    grounded: c.ok,
    rejected: c.ok ? undefined : c.why,
    usage,
    cached: false,
  };
  const { cached: _c, ...record } = answer;
  await d.log.append({ key, ...record });
  return answer;
}

/** One line per Kiln call: what the thinking cost, in the units the brief asks for. Stand-ins are never called Kiln (AC-22). */
export function usageLine(u: UsageRecord): string {
  const who = isKilnCall(u) ? 'Kiln qwen3-32b' : 'scripted stand-in — no Kiln call';
  const wh = estimateEnergy({ latencyMs: u.latencyMs }).wh;
  return `${who} · ${u.flow} · ${u.promptTokens}+${u.completionTokens} tokens · ${(u.latencyMs / 1000).toFixed(2)} s · $${Number(u.costUsd.toFixed(8))} · gen ${u.generationId || '-'} · ≈${wh.toFixed(4)} Wh`;
}

export function formatAnswer(a: Answer): string {
  const label = a.flow === 'F2_explain' ? 'F2 explain' : 'F3 dispute';
  const head =
    a.seq === null
      ? `${label} · no matching receipt`
      : `${label} · receipt #${a.seq} · audit verdict ${a.verdict ?? '?'}${a.reason ? ` ${a.reason}` : ''} · tx ${a.txHash ?? 'none'}`;
  return [
    head,
    ...(a.question ? [`question: “${a.question}”`] : []),
    a.text,
    ...(a.rejected ? [`(model reply not shown — ${a.rejected}; the audit's own sentence is shown instead)`] : []),
    a.usage ? usageLine(a.usage) : a.cached ? 'answered from the answers log — 0 Kiln calls' : 'no model call',
  ].join('\n');
}
