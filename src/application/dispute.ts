import { checkDisputeReply } from '../domain/answers';
import { audit, type ChainEvent, type Verdict } from '../domain/audit';
import { fmtUsdt } from '../domain/money';
import type { Receipt } from '../domain/receipt';
import { fromLog, templateAnswer, utc, type AnswerDeps, type PublicRecord } from './explain';
import type { Answer } from './ports';

/**
 * UC-6 dispute (flow F3): "was this payment inside the line?" asked in a teammate's own words.
 * One Kiln call reads the question against a table the code built from audit() and picks the receipt it is about.
 * The verdict, reason and tx always come from the audit; the model's sentence is shown only if it echoes that verdict.
 */
/** v3: per-receipt STOP relation written by code (the model misordered STOP / re-grant times 9 s apart, live 2026-09-26). */
export const DISPUTE_VERSION = 4; // v4: numbers in the answer must come from the table (the model computed a wrong duration)
export const TABLE_LIMIT = 30; // newest receipts sent to the model — bounds F3 tokens as the record grows

export const DISPUTE_SYSTEM_HEAD = [
  "You settle a question about an AI purchasing agent's past payments.",
  'Below are the line events (grants and STOPs) and the audited record, one line per receipt. The verdict on each line was computed by an independent audit of the receipts and the chain; you cannot change it.',
  'A new grant replaces the line and lifts any earlier STOP.',
  'Pick the ONE receipt the question is about and answer in at most two short sentences using only these lines. Copy numbers and times from these lines — do not compute new ones. Say whether it was paid inside the line; if the question is about STOP, copy that line\'s "line and STOP at that moment" fact.',
  'Reply with ONE JSON object and nothing else: {"seq": <receipt number, or null if no line matches>, "verdict": "<copy that line\'s verdict, or null>", "answer": "<at most two sentences>"}',
  '/no_think',
].join('\n');
export const TABLE_HEADER = 'seq | time | request words | seller | total | verdict | reason | STOP in force | line and STOP at that moment';

export function lineEvents(events: ChainEvent[], labels?: Record<string, string>): string[] {
  const name = (a: string) => labels?.[a] ?? a;
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at - b.e.at || a.i - b.i)
    .map(({ e }) =>
      e.kind === 'granted'
        ? `${utc(e.at)} · line granted: budget ${fmtUsdt(e.mandate.budget)} USDT · per-payment cap ${fmtUsdt(e.mandate.perTxCap)} USDT · deadline ${utc(e.mandate.deadline)} · sellers ${e.mandate.merchants.map(name).join(', ')} (tx ${e.txHash})`
        : e.kind === 'paused'
          ? `${utc(e.at)} · STOP pressed (tx ${e.txHash})`
          : e.kind === 'resumed'
            ? `${utc(e.at)} · STOP lifted (tx ${e.txHash})`
            : '',
    )
    .filter(Boolean)
    .slice(-20);
}

/** The STOP relation at time t, computed from grant / STOP / resume events — so the model copies it instead of ordering times. */
export function stopStateAt(events: ChainEvent[], t: number): string {
  let grantAt: number | undefined;
  let stopAt: number | undefined;
  let liftedByGrant: number | undefined;
  let resume: { stop: number; at: number } | undefined;
  const ordered = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);
  for (const e of ordered) {
    if (e.at > t) break;
    if (e.kind === 'granted') [grantAt, liftedByGrant, stopAt, resume] = [e.at, stopAt, undefined, undefined];
    else if (e.kind === 'paused') [stopAt, resume] = [e.at, undefined];
    else if (e.kind === 'resumed' && stopAt !== undefined) [resume, stopAt] = [{ stop: stopAt, at: e.at }, undefined];
  }
  if (stopAt !== undefined) return `STOP in force since ${utc(stopAt)}`;
  if (resume) return `STOP of ${utc(resume.stop)} lifted by resume at ${utc(resume.at)}`;
  if (grantAt === undefined) return 'no line granted yet';
  return liftedByGrant !== undefined ? `line granted ${utc(grantAt)} — this grant lifted the STOP of ${utc(liftedByGrant)}` : `line granted ${utc(grantAt)} — no STOP since`;
}

export function disputeLine(r: Receipt, v: Verdict, labels?: Record<string, string>, events: ChainEvent[] = []): string {
  const q = r.request;
  const name = labels?.[q.merchant] ?? q.merchant;
  const listed = v.line ? (v.line.merchants.includes(q.merchant) ? 'on the list' : 'not on the list') : 'list unknown';
  const stop = v.line ? (v.line.paused ? 'yes' : 'no') : 'unknown';
  return `#${r.seq} | ${utc(q.at)} | “${r.intentText}” | ${name} — ${listed} | ${fmtUsdt(q.amount + q.fee)} USDT | ${v.verdict} | ${v.reason ?? '-'} | ${stop} | ${stopStateAt(events, q.at)}`;
}

const normalize = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

export async function dispute(d: AnswerDeps, rec: PublicRecord, question: string): Promise<Answer> {
  const last = rec.receipts.at(-1)?.hash ?? 'empty';
  const key = `F3v${DISPUTE_VERSION}:${d.hash(`${normalize(question)}|${last}`)}`;
  const hit = await d.log.find(key);
  if (hit) return fromLog(hit);

  const verdicts = audit({ mandates: [], receipts: rec.receipts, events: rec.events, hash: d.hash }).verdicts.slice(-TABLE_LIMIT);
  const bySeq = new Map(rec.receipts.map((r) => [r.seq, r]));
  const table = verdicts.map((v) => disputeLine(bySeq.get(v.seq)!, v, d.labels, rec.events)).join('\n');
  const system = `${DISPUTE_SYSTEM_HEAD}\n\nline events (oldest first):\n${lineEvents(rec.events, d.labels).join('\n') || '(none)'}\n\n${TABLE_HEADER}\n${table}`;
  const { text, usage } = await d.llm.chat(
    'F3_dispute',
    [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
    { maxTokens: 200, thinking: false },
  );
  const c = checkDisputeReply(text, verdicts, `${system}\n${question}`);
  const v = c.seq === null ? undefined : verdicts.find((x) => x.seq === c.seq);
  const r = c.seq === null ? undefined : bySeq.get(c.seq);
  const answer: Answer = {
    flow: 'F3_dispute',
    question,
    seq: c.seq,
    verdict: v?.verdict,
    reason: v?.reason,
    txHash: v?.txHash,
    text: c.ok ? c.answer : r && v ? `${templateAnswer(r, v, d.labels)} At that moment: ${stopStateAt(rec.events, r.request.at)}.` : 'No receipt in this record matches that question.',
    grounded: c.ok,
    rejected: c.ok ? undefined : c.why,
    usage,
    cached: false,
  };
  const { cached: _c, ...record } = answer;
  await d.log.append({ key, ...record });
  return answer;
}
