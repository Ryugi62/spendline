// AC-43 — Spendline as three MCP tools. Pure handlers (no SDK here): src/adapters/mcp.ts puts them on the wire.
// No model call is added — the MCP host keeps its own planner; every pay attempt goes through guardedPay (AC-37).
import { fmtUsdt } from '../domain/money';
import type { UsageRecord } from '../domain/tokenLedger';
import { auditRecords, problemCount } from './auditRecords';
import type { EventSource } from './ports';
import { guardedPay, type GuardedPayDeps } from './plugIn';

export type McpResult = { text: string; data?: Record<string, unknown>; isError?: boolean };
export type McpTool = { name: string; description: string; inputSchema: Record<string, unknown>; run(args: Record<string, unknown>): Promise<McpResult> };
export type McpDeps = GuardedPayDeps & { events: EventSource; labels: Record<string, string>; vault: string; /** in-memory sandbox (`npm run mcp -- --demo`): said in every line reply */ demo?: boolean };

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const kst = (unix: number) => new Date((unix + 9 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19);
const ok = (data: Record<string, unknown>): McpResult => ({ text: JSON.stringify(data), data });
const refuse = (why: string): McpResult => ({ text: why, isError: true });

/** USDT with ≤ 6 decimals → micro-USDT, or a plain-language reason. */
export function microUsdt(v: unknown, field: string, allowZero = false): number | string {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof x !== 'number' || !Number.isFinite(x)) return `${field} must be a number of USDT`;
  if (x < 0 || (!allowZero && x === 0)) return `${field} must be more than 0`;
  const micro = x * 1e6;
  if (Math.abs(micro - Math.round(micro)) > 1e-6) return `${field} has more than 6 decimals (USDT has 6)`;
  return Math.round(micro);
}

/** The host's Kiln call behind a payment → the receipt's F1 usage record, or a plain-language reason. */
export function usageFrom(v: unknown): UsageRecord[] | string {
  const u = (v ?? {}) as Record<string, unknown>;
  const int = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0;
  if (typeof u.generation_id !== 'string' || !u.generation_id.trim()) return 'kiln_usage.generation_id is required';
  if (!int(u.prompt_tokens) || !int(u.completion_tokens)) return 'kiln_usage tokens must be whole numbers ≥ 0';
  if (typeof u.cost_usd !== 'number' || !(u.cost_usd >= 0)) return 'kiln_usage.cost_usd must be a number ≥ 0';
  const via: Pick<UsageRecord, 'via'> = u.via === 'tool_call' || u.via === 'tool_call_in_text' || u.via === 'text' ? { via: u.via } : {};
  return [{ flow: 'F1_intent', promptTokens: u.prompt_tokens as number, completionTokens: u.completion_tokens as number, costUsd: u.cost_usd, latencyMs: int(u.latency_ms) ? (u.latency_ms as number) : 0, generationId: u.generation_id.trim(), ...via }];
}

export function mcpTools(d: McpDeps): McpTool[] {
  const byName = new Map(Object.entries(d.labels).map(([addr, name]) => [name.toLowerCase(), addr]));
  const nameOf = (addr: string) => d.labels[addr];
  const seller = (to: unknown): string | undefined => {
    if (typeof to !== 'string') return undefined;
    const t = to.trim();
    return TRON_ADDRESS.test(t) ? t : byName.get(t.toLowerCase());
  };
  return [
    {
      name: 'spendline_line',
      description: 'Read the spending line the person granted: budget, spent, left, per-payment cap, allowed sellers, deadline, STOP. Read-only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const [m, spent] = await Promise.all([d.chain.mandate(), d.chain.spent()]);
        return ok({
          budget_usdt: fmtUsdt(m.budget), spent_usdt: fmtUsdt(spent), left_usdt: fmtUsdt(Math.max(0, m.budget - spent)), per_payment_cap_usdt: fmtUsdt(m.perTxCap),
          sellers: m.merchants.map((a) => ({ address: a, ...(nameOf(a) ? { name: nameOf(a) } : {}) })), deadline_kst: kst(m.deadline), stop: m.paused,
          ...(d.demo ? { demo: true, note: 'in-memory sandbox: same rule as the vault, nothing is sent to TRON' } : {}),
        });
      },
    },
    {
      name: 'spendline_pay',
      description:
        'Pay a seller in test USDT through the Spendline vault on TRON. The vault pays only inside the line; outside it the payment is stopped and the reason is recorded on-chain (ok: false). Every attempt leaves a hash-chained receipt anyone can audit.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: `seller: a TRON address, or one of these names exactly: ${Object.values(d.labels).join(', ')}` },
          amount_usdt: { type: 'number', description: 'amount in USDT (up to 6 decimals), fee not included' },
          why: { type: 'string', description: 'the reason in the words of the request — becomes the receipt\'s words' },
          fee_usdt: { type: 'number', description: 'seller fee in USDT, default 0' },
          kiln_usage: {
            type: 'object',
            description: 'set by the host code, not the model: the Kiln call that decided this payment (generation id, tokens, cost) — it goes into the receipt, so the on-chain hash commits to it and Kiln can attest it',
            properties: { generation_id: { type: 'string' }, prompt_tokens: { type: 'integer' }, completion_tokens: { type: 'integer' }, cost_usd: { type: 'number' }, latency_ms: { type: 'integer' }, via: { type: 'string', enum: ['tool_call', 'tool_call_in_text', 'text'] } },
            required: ['generation_id', 'prompt_tokens', 'completion_tokens', 'cost_usd'],
          },
        },
        required: ['to', 'amount_usdt', 'why'],
        additionalProperties: false,
      },
      async run(a) {
        const to = seller(a.to);
        if (!to) return refuse(`unknown seller "${String(a.to)}": give a TRON address or one of: ${Object.values(d.labels).join(', ')}`);
        if (typeof a.why !== 'string' || !a.why.trim()) return refuse('why is required: the reason in the words of the request');
        const amount = microUsdt(a.amount_usdt, 'amount_usdt');
        if (typeof amount === 'string') return refuse(amount);
        const fee = a.fee_usdt === undefined ? 0 : microUsdt(a.fee_usdt, 'fee_usdt', true);
        if (typeof fee === 'string') return refuse(fee);
        const flows = a.kiln_usage === undefined ? [] : usageFrom(a.kiln_usage);
        if (typeof flows === 'string') return refuse(flows);
        const r = await guardedPay(d, { merchant: to, amount, fee, why: a.why.trim(), flows });
        const base = { seller: nameOf(to) ?? to, amount_usdt: fmtUsdt(amount), fee_usdt: fmtUsdt(fee), tx: r.outcome.txHash, receipt_seq: r.receipt.seq, receipt_hash: r.receipt.hash };
        return r.outcome.kind === 'paid' ? ok({ ok: true, ...base }) : ok({ ok: false, reason: r.outcome.reason, ...base });
      },
    },
    {
      name: 'spendline_check',
      description: "Check one receipt the way an auditor would: rebuild its verdict from the receipts file and the vault's public events (no key).",
      inputSchema: { type: 'object', properties: { seq: { type: 'integer', minimum: 1, description: 'receipt number' } }, required: ['seq'], additionalProperties: false },
      async run(a) {
        const receipts = await d.store.all();
        const res = await auditRecords({ events: d.events, hash: d.hash }, { receipts, vault: d.vault });
        const v = res.verdicts.find((x) => x.seq === Number(a.seq));
        if (!v) return refuse(`no receipt #${String(a.seq)} (receipts: ${receipts.length})`);
        return ok({ seq: v.seq, verdict: v.verdict, ...(v.reason ? { reason: v.reason } : {}), ...(v.txHash ? { tx: v.txHash } : {}), why: v.why, chain_ok: res.chain.ok, problems: problemCount(res) });
      },
    },
  ];
}
