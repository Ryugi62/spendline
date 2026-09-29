import type { AuditResult } from '../domain/audit';
import { strayNumbers } from '../domain/answers';
import type { AbSummary, FlowReport } from '../domain/flowReport';
import { fmtUsdt } from '../domain/money';
import { countVerdicts, problemCount } from './auditRecords';

/**
 * AC-31 / AC-32: the video, the pitch and the deck say only what the record says.
 * Facts are computed here from the audit, the flow report and the A/B summary; copy may quote them, never invent a number.
 * The same number rule the model's F2 / F3 answers obey (domain/answers.strayNumbers) is applied to our own words.
 */
export type PitchFacts = {
  vault: string;
  receipts: number;
  paid: number;
  stopped: number;
  replays: number;
  problems: number;
  paidUsdt: string;
  /** seq of the receipt stopped because the seller was not on the list — the demo opens on it */
  merchantStopSeq?: number;
  kilnCalls: number;
  tokens: string;
  usd: string;
  wh: string;
  whPerPurchase: string;
  callsPerPurchase: string;
  flows: number;
  ab: { n: number; offTokens: number; onTokens: number; offSeconds: string; onSeconds: string; sameJson: number; tokensSavedPct: number; latencySavedPct: number };
  tests: number;
  /** measured cost of one guarded decision: Kiln F1 USD per purchase, TRON fee per Paid / stopped pay() (Nile, median) */
  cost?: { f1Usd: string; paidTrx: string; stopTrx: string };
  /** every tx hash in the public record (receipts' events, replays, grants, STOPs) */
  txHashes: string[];
  /** evidence rows the deck and the video point at — all from the audit */
  stops: { seq: number; reason: string; tx: string }[];
  paidTx: string[];
  replayTx?: string;
  stopTx?: string;
  grantTx?: string;
  /** stated assumptions with their numbers, e.g. "180 W — RNGD card TDP (furiosa.ai/rngd)" */
  stated: string[];
  /** v1.1 AC-40: Kiln's own record vs the receipts (team32 account) — MATCH count, calls Kiln shows, F1 calls dated before pay(), lead range in s */
  attest?: { match: number; shown: number; otherAccount: number; f1Before: number; f1: number; leadMin: number; leadMax: number };
  /** v1.1 AC-43/44: MCP tools, host runs on Kiln, their Kiln calls, pay attempts that reached the vault, calls per attempt */
  mcp?: { tools: number; runs: number; calls: number; attempts: number; perAttempt: string };
  /** v1.1 AC-41: what the statement adds up — USDT kept in the vault by stops */
  kept?: { usdt: string; stops: number };
};

export function pitchFacts(res: AuditResult, report: FlowReport, ab: AbSummary, o: { vault: string; tests: number; extraTx?: string[]; stated: string[]; stopTx?: string; grantTx?: string; chain?: { paidTrx: number; stopTrx: number } }): PitchFacts {
  const c = countVerdicts(res.verdicts);
  const f1 = report.rows[0];
  return {
    vault: o.vault,
    receipts: res.verdicts.length,
    paid: c.paidInside,
    stopped: c.stopped,
    replays: res.replays.length,
    problems: problemCount(res),
    paidUsdt: fmtUsdt(res.totalPaid),
    merchantStopSeq: res.verdicts.find((v) => v.verdict === 'STOPPED' && v.reason === 'MERCHANT_NOT_ALLOWED')?.seq,
    kilnCalls: report.total.calls,
    tokens: report.total.totalTokens.toLocaleString('en-US'),
    usd: report.total.costUsd.toFixed(7),
    wh: report.total.wh.toFixed(2),
    whPerPurchase: (f1.calls ? f1.whPerCall : 0).toFixed(2),
    callsPerPurchase: report.callsPerPurchase.toFixed(2),
    flows: report.rows.filter((r) => r.calls > 0).length,
    ab: {
      n: ab.n,
      offTokens: ab.off.medianCompletion,
      onTokens: ab.on.medianCompletion,
      offSeconds: (ab.off.medianLatencyMs / 1000).toFixed(2),
      onSeconds: (ab.on.medianLatencyMs / 1000).toFixed(2),
      sameJson: ab.sameJson,
      tokensSavedPct: Math.round(ab.completionSavedPct),
      latencySavedPct: Math.round(ab.latencySavedPct),
    },
    tests: o.tests,
    ...(o.chain ? { cost: { f1Usd: (f1.calls ? f1.costUsd / f1.calls : 0).toFixed(7), paidTrx: o.chain.paidTrx.toFixed(2), stopTrx: o.chain.stopTrx.toFixed(2) } } : {}),
    stops: res.verdicts.flatMap((v) => (v.verdict === 'STOPPED' && v.reason && v.txHash ? [{ seq: v.seq, reason: v.reason, tx: v.txHash }] : [])),
    paidTx: res.verdicts.flatMap((v) => (v.verdict === 'PAID_INSIDE' && v.txHash ? [v.txHash] : [])),
    replayTx: res.replays[0]?.txHash,
    stopTx: o.stopTx,
    grantTx: o.grantTx,
    txHashes: [...new Set([...res.verdicts.flatMap((v) => (v.txHash ? [v.txHash] : [])), ...res.replays.map((r) => r.txHash), ...(o.extraTx ?? []), ...(o.stopTx ? [o.stopTx] : []), ...(o.grantTx ? [o.grantTx] : [])])],
    stated: o.stated,
  };
}

/** Everything a sentence may quote, as text — the allow-list for the number rule. */
export function factsText(f: PitchFacts): string {
  const { txHashes: _tx, stops: _s, paidTx: _p, replayTx: _r, stopTx: _st, grantTx: _g, stated, ab, ...rest } = f;
  return [JSON.stringify(rest), JSON.stringify(ab), JSON.stringify(_s.map((x) => ({ seq: x.seq, reason: x.reason }))), ...stated].join('\n');
}

/** Numbers in `words` that are neither a fact nor a stated assumption. */
export const strayInCopy = (words: string, f: PitchFacts): string[] => strayNumbers(words, factsText(f));

export type Scene = { id: string; url: string; en: string; actions?: string[] };
export type ScriptRules = { maxSeconds: number; /** demo only: a scene opening the seller-not-listed stop must start before this second */ firstStopBy?: number };

/** words ÷ 2.6 per second (macOS `say` at 175 wpm is ≈ 2.9 — the estimate errs long) + 0.9 s gap per scene */
export const estimateSeconds = (en: string) => en.split(/\s+/).filter(Boolean).length / 2.6 + 0.9;

/** AC-31: findings (empty = fit to record). */
export function checkScript(scenes: Scene[], f: PitchFacts, rules: ScriptRules): string[] {
  const out: string[] = [];
  const total = scenes.reduce((n, s) => n + estimateSeconds(s.en), 0);
  if (total > rules.maxSeconds) out.push(`estimated ${total.toFixed(0)} s > ${rules.maxSeconds} s — cut words`);
  if (rules.firstStopBy !== undefined) {
    let t = 0;
    let at: number | undefined;
    for (const s of scenes) {
      if (f.merchantStopSeq !== undefined && s.url.includes(`#/receipt/${f.merchantStopSeq}`)) {
        at = t;
        break;
      }
      t += estimateSeconds(s.en);
    }
    if (at === undefined || at >= rules.firstStopBy) out.push(`the seller-not-listed stop (receipt #${f.merchantStopSeq ?? '?'}) must be on screen before 0:${rules.firstStopBy}`);
  }
  for (const s of scenes) {
    const stray = strayInCopy(s.en, f);
    if (stray.length) out.push(`${s.id}: number not in the record: ${stray.join(', ')}`);
    for (const p of s.en.match(/\b(?=[0-9a-f]*[a-f])(?=[a-f]*[0-9])[0-9a-f]{6,}\b/g) ?? []) if (!f.txHashes.some((h) => h.startsWith(p))) out.push(`${s.id}: ${p} is not a tx of the record`);
  }
  return out;
}
