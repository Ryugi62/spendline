import { audit, type AuditResult, type Verdict } from '../domain/audit';
import { fmtUsdt } from '../domain/money';
import type { Hasher, Receipt } from '../domain/receipt';
import type { EventSource } from './ports';

/** UC-4 as something anyone can run: receipts file + public events → verdicts. No key, no .env, no operator UI. */
export class ReceiptsFileError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `line ${line}: ${message}` : message);
  }
}

export type ReceiptsFile = { vault?: string; receipts: Receipt[] };

const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown) => typeof x === 'string';
function asReceipt(o: unknown, line?: number): Receipt {
  const r = o as Record<string, unknown> | null;
  const q = (r?.request ?? null) as Record<string, unknown> | null;
  const ok =
    r && isNum(r.seq) && isStr(r.mandateId) && isStr(r.intentText) && Array.isArray(r.flows) && isStr(r.prevHash) && isStr(r.hash) &&
    q && isStr(q.merchant) && isNum(q.amount) && isNum(q.fee) && isNum(q.at);
  if (!ok) throw new ReceiptsFileError('not a receipt (needs seq, mandateId, request{merchant,amount,fee,at}, intentText, flows, prevHash, hash)', line ?? 1);
  return o as Receipt;
}

/** `.jsonl` (one receipt per line) or a run JSON `{ vault, receipts: [...] }`. */
export function parseReceiptsFile(text: string): ReceiptsFile {
  const trimmed = text.trim();
  if (!trimmed) throw new ReceiptsFileError('the file is empty');
  if (trimmed.startsWith('{')) {
    try {
      const whole = JSON.parse(trimmed) as { vault?: unknown; receipts?: unknown };
      if (Array.isArray(whole.receipts)) return { vault: isStr(whole.vault) ? (whole.vault as string) : undefined, receipts: whole.receipts.map((r) => asReceipt(r)) };
    } catch (e) {
      if (e instanceof ReceiptsFileError) throw e;
      // not one JSON document → treat as JSON lines below
    }
  }
  const receipts: Receipt[] = [];
  text.split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    let o: unknown;
    try {
      o = JSON.parse(raw);
    } catch {
      throw new ReceiptsFileError('not valid JSON', i + 1);
    }
    receipts.push(asReceipt(o, i + 1));
  });
  return { receipts };
}

export type AuditDeps = { events: EventSource; hash: Hasher };
export async function auditRecords(d: AuditDeps, file: ReceiptsFile & { vault: string }): Promise<AuditResult> {
  return audit({ mandates: [], receipts: file.receipts, events: await d.events.events(file.vault), hash: d.hash });
}

export type VerdictCounts = { paidInside: number; stopped: number; mismatch: number; noEvent: number };
export function countVerdicts(verdicts: Verdict[]): VerdictCounts {
  const n = (v: Verdict['verdict']) => verdicts.filter((x) => x.verdict === v).length;
  return { paidInside: n('PAID_INSIDE'), stopped: n('STOPPED'), mismatch: n('MISMATCH'), noEvent: n('NO_CHAIN_EVENT') };
}

/** Problems a reader must look at: a broken hash chain, a chain outcome the policy disagrees with, a receipt the chain never saw, a chain spend no receipt accounts for. */
export const problemCount = (res: AuditResult): number => {
  const c = countVerdicts(res.verdicts);
  return c.mismatch + c.noEvent + res.unreceipted.length + (res.chain.ok ? 0 : 1);
};
export const auditExitCode = (res: AuditResult): 0 | 1 => (problemCount(res) === 0 ? 0 : 1);

export function formatAuditReport(res: AuditResult, o: { vault: string; source: string }): string {
  const c = countVerdicts(res.verdicts);
  const lines = [
    `Spendline audit · vault ${o.vault} · ${res.verdicts.length} receipts · events: ${o.source}`,
    `hash chain: ${res.chain.ok ? 'intact' : `BROKEN at #${res.chain.brokenAt}`}`,
    ...res.verdicts.map((v) => `#${v.seq} ${v.verdict}${v.reason ? ` ${v.reason}` : ''} · tx ${v.txHash ?? '-'} · ${v.why}`),
    ...res.unreceipted.map((u) => `! ${u.kind.toUpperCase()} ${fmtUsdt(u.amount + u.fee)} USDT · tx ${u.txHash} · no receipt: ${u.why}`),
    ...(res.replays ?? []).map((x) => `~ replay of #${x.seq} stopped on-chain DUPLICATE_RECEIPT · tx ${x.txHash} · the vault decides a receipt once`),
    `${c.paidInside} paid inside · ${c.stopped} stopped · ${c.mismatch} mismatch · ${c.noEvent} without chain event · ${res.unreceipted.length} chain spend${
      res.unreceipted.length === 1 ? '' : 's'
    } without a receipt${(res.replays ?? []).length ? ` · ${res.replays.length} replay${res.replays.length === 1 ? '' : 's'} stopped` : ''} · paid ${fmtUsdt(res.totalPaid)} USDT → ${
      auditExitCode(res) === 0 ? 'OK' : 'PROBLEMS'
    }`,
  ];
  return lines.join('\n');
}
