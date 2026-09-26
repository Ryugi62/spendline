import type { Verdict } from './audit';
import type { BlockReason } from './mandate';

/**
 * F2 / F3 answers. Kiln has no response_format, so the model is asked for one JSON object and this module decides
 * whether its words may be shown: the model must echo the verdict the audit computed. The model never decides a verdict.
 */
export type VerdictKind = Verdict['verdict'];
export class AnswerError extends Error {}
export type Checked<T> = { ok: true; value: T } | { ok: false; why: string };

const MAX_CHARS = 600;

export function extractJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AnswerError('no JSON object in model output');
  let o: unknown;
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AnswerError('model output is not valid JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new AnswerError('model output is not a JSON object');
  return o as Record<string, unknown>;
}

function words(x: unknown, field: string): string {
  if (typeof x !== 'string' || !x.trim()) throw new AnswerError(`${field} missing`);
  if (x.length > MAX_CHARS) throw new AnswerError(`${field} longer than ${MAX_CHARS} characters`);
  return x.trim();
}

const orNone = (x: unknown) => (x === null || x === undefined || x === '' ? undefined : x);

/** F2: `{verdict, reason, explanation}` — verdict and reason must be the audit's, word for word. */
export function checkExplanation(text: string, expect: { verdict: VerdictKind; reason?: BlockReason }): Checked<string> {
  try {
    const o = extractJsonObject(text);
    if (o.verdict !== expect.verdict) return { ok: false, why: `model said ${String(o.verdict)}, audit says ${expect.verdict}` };
    const reason = orNone(o.reason);
    if (reason !== expect.reason) return { ok: false, why: `model gave reason ${String(reason ?? 'none')}, audit says ${expect.reason ?? 'none'}` };
    return { ok: true, value: words(o.explanation, 'explanation') };
  } catch (e) {
    if (e instanceof AnswerError) return { ok: false, why: e.message };
    throw e;
  }
}

export type TableLine = { seq: number; verdict: VerdictKind; reason?: BlockReason };
export type DisputeCheck = { ok: true; seq: number | null; answer: string } | { ok: false; seq: number | null; why: string };

/** F3: `{seq, verdict, answer}` — seq must be a receipt of the table (or null = none), verdict must echo that line. */
export function checkDisputeReply(text: string, table: TableLine[]): DisputeCheck {
  let o: Record<string, unknown>;
  try {
    o = extractJsonObject(text);
  } catch (e) {
    if (e instanceof AnswerError) return { ok: false, seq: null, why: e.message };
    throw e;
  }
  const raw = orNone(o.seq);
  const answer = (): DisputeCheck | string => {
    try {
      return words(o.answer, 'answer');
    } catch (e) {
      return { ok: false, seq: null, why: (e as Error).message };
    }
  };
  if (raw === undefined) {
    const a = answer();
    return typeof a === 'string' ? { ok: true, seq: null, answer: a } : a;
  }
  const seq = typeof raw === 'number' ? raw : typeof raw === 'string' && /^#?\d+$/.test(raw) ? Number(raw.replace('#', '')) : Number.NaN;
  if (!Number.isInteger(seq)) return { ok: false, seq: null, why: 'seq is not a receipt number' };
  const line = table.find((t) => t.seq === seq);
  if (!line) return { ok: false, seq: null, why: `model picked #${seq}, which is not in the record` };
  // Kiln 2026-09-26: the model may copy verdict and reason together ("STOPPED OVER_BUDGET_WITH_FEES") — fine only if both match.
  const echo = typeof o.verdict === 'string' ? o.verdict.trim() : o.verdict;
  const full = line.reason ? `${line.verdict} ${line.reason}` : line.verdict;
  if (echo !== line.verdict && echo !== full) return { ok: false, seq, why: `model said ${String(o.verdict)}, audit says ${full}` };
  const a = answer();
  return typeof a === 'string' ? { ok: true, seq, answer: a } : { ...a, seq };
}
