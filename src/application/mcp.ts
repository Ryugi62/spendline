// AC-43 — Spendline as three MCP tools. Pure handlers (no SDK here): src/adapters/mcp.ts puts them on the wire.
// No model call is added — the MCP host keeps its own planner; every pay attempt goes through guardedPay (AC-37).
import { fmtUsdt } from '../domain/money';
import type { UsageRecord } from '../domain/tokenLedger';
import { auditRecords, problemCount } from './auditRecords';
import type { EventSource, Offer } from './ports';
import { guardedPay, serialized, type GuardedPayDeps } from './plugIn';

export type McpResult = { text: string; data?: Record<string, unknown>; isError?: boolean };
/** Host-code data rides in the MCP request's `_meta` (never in the tool schema a host's model reads): `spendline/request` = the person's
 *  words, `spendline/kiln_usage` = the Kiln call that decided the payment. */
export const META_REQUEST = 'spendline/request';
export const META_KILN_USAGE = 'spendline/kiln_usage';
/** the n-th identical pay call (same seller, item, quantity) within one request — so two identical items are two purchases */
export const META_OCCURRENCE = 'spendline/occurrence';
/** The same request again within this window on the same line is a replay; a host retrying the same call in one session: 10 minutes. */
export const REPLAY_WINDOW_SEC = 3600;
export const SESSION_WINDOW_SEC = 600;
export type McpTool = { name: string; description: string; inputSchema: Record<string, unknown>; run(args: Record<string, unknown>, meta?: Record<string, unknown>): Promise<McpResult> };
export type McpDeps = GuardedPayDeps & { events: EventSource; labels: Record<string, string>; offers?: Offer[]; vault: string;
  /** AC-45: the Kiln call behind these arguments, from the pass-through journal (for hosts that send no _meta) */
  witness?: (args: Record<string, unknown>) => Promise<(UsageRecord & { asked?: string; occurrence?: number }) | undefined>; /** in-memory sandbox (`npm run mcp -- --demo`): said in every line reply */ demo?: boolean };

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
  return [{ flow: 'F4_mcp_host', promptTokens: u.prompt_tokens as number, completionTokens: u.completion_tokens as number, costUsd: u.cost_usd, latencyMs: int(u.latency_ms) ? (u.latency_ms as number) : 0, ...(int(u.server_ms) ? { serverMs: u.server_ms as number } : {}), generationId: u.generation_id.trim(), ...via, ...(typeof u.args === 'string' ? { args: u.args } : {}) }];
}

export function mcpTools(d: McpDeps): McpTool[] {
  const offers = d.offers ?? [];
  const session = new Map<string, { seq: number; at: number }>(); // this server session's pay calls, for a host that retries without a request
  const byName = new Map(Object.entries(d.labels).map(([addr, name]) => [name.toLowerCase(), addr]));
  const nameOf = (addr: string) => d.labels[addr];
  const seller = (to: unknown): string | undefined => {
    if (typeof to !== 'string') return undefined;
    const t = to.trim();
    return TRON_ADDRESS.test(t) ? t : byName.get(t.toLowerCase());
  };
  /** what is left on the line after this attempt — so a host (and its model) never has to compute it (round-4: a stock agent misstated it) */
  async function left() {
    const [m, spent] = await Promise.all([d.chain.mandate(), d.chain.spent()]);
    return { spent_usdt: fmtUsdt(spent), left_usdt: fmtUsdt(Math.max(0, m.budget - spent)) };
  }
  async function pay(a: Record<string, unknown>, meta: Record<string, unknown>): Promise<McpResult> {
        const to = seller(a.to);
        if (!to) return refuse(`unknown seller "${String(a.to)}": give a TRON address or one of: ${Object.values(d.labels).join(', ')}`);
        if (typeof a.why !== 'string' || !a.why.trim()) return refuse('why is required: the reason in the words of the request');
        const modelAmount = a.amount_usdt === undefined ? undefined : microUsdt(a.amount_usdt, 'amount_usdt');
        if (typeof modelAmount === 'string') return refuse(modelAmount);
        const modelFee = a.fee_usdt === undefined ? undefined : microUsdt(a.fee_usdt, 'fee_usdt', true);
        if (typeof modelFee === 'string') return refuse(modelFee);
        const sells = offers.filter((o) => o.merchant === to);
        let amount: number, fee: number, pricedBy: 'catalog' | 'caller';
        if (sells.length) {
          const item = typeof a.item === 'string' && a.item.trim() ? a.item.trim() : sells.length === 1 ? sells[0].item : undefined;
          const offer = sells.find((o) => o.item === item);
          if (!offer) return refuse(`${nameOf(to) ?? to} sells ${sells.map((o) => o.item).join(', ')} — give one of them as item`);
          const q = a.quantity === undefined ? 1 : Number(a.quantity);
          if (!Number.isFinite(q) || q <= 0 || Math.abs(q * 1e6 - Math.round(q * 1e6)) > 1e-6) return refuse('quantity must be a number more than 0');
          [amount, fee, pricedBy] = [Math.round(offer.unitPrice * q), offer.fee, 'catalog'];
        } else {
          if (modelAmount === undefined) return refuse('amount_usdt is required for a seller that is not in the catalog');
          [amount, fee, pricedBy] = [modelAmount, modelFee ?? 0, 'caller'];
        }
        let flows: UsageRecord[] | string = meta[META_KILN_USAGE] === undefined ? [] : usageFrom(meta[META_KILN_USAGE]);
        if (typeof flows === 'string') return refuse(flows);
        let fromJournal: { asked?: string; occurrence?: number } = {};
        if (!flows.length && d.witness) {
          const w = await d.witness(a);
          if (w) {
            const { key: _k, asked: wAsked, occurrence: wOcc, conversation: _c, ...u } = w as UsageRecord & { key?: string; asked?: string; occurrence?: number; conversation?: string };
            flows = [u];
            fromJournal = { ...(wAsked ? { asked: wAsked } : {}), ...(wOcc !== undefined ? { occurrence: wOcc } : {}) };
          }
        }
        const asked = typeof meta[META_REQUEST] === 'string' && (meta[META_REQUEST] as string).trim() ? (meta[META_REQUEST] as string).trim() : fromJournal.asked; // a stock host: the person's words from the Kiln pass-through journal
        const ignored = pricedBy === 'catalog' && modelAmount !== undefined && modelAmount !== amount ? { model_amount_ignored: fmtUsdt(modelAmount) } : {};
        const base = { seller: nameOf(to) ?? to, amount_usdt: fmtUsdt(amount), fee_usdt: fmtUsdt(fee), priced_by: pricedBy, ...ignored };
        const [mandate, now] = await Promise.all([d.chain.mandate(), d.chain.now()]);
        const sameCall = `${to}|${amount}|${fee}|${a.why.trim().toLowerCase()}`;
        const all = await d.store.all();
        // a repeat = an earlier PAID purchase of the same request (the n-th identical item matches the n-th earlier one) within the window
        const paidHashes = async () => new Set((await d.events.events(d.vault)).flatMap((e) => (e.kind === 'paid' ? [e.receiptHash] : [])));
        let prior: (typeof all)[number] | undefined;
        if (asked) {
          const same = all.filter((r) => r.asked === asked && r.mandateId === mandate.id && r.request.merchant === to && r.request.amount === amount && r.request.fee === fee && now - r.request.at <= REPLAY_WINDOW_SEC);
          if (same.length) { const paidSet = await paidHashes(); prior = same.filter((r) => paidSet.has(r.hash))[Number(meta[META_OCCURRENCE] ?? fromJournal.occurrence ?? 0)]; }
        } else {
          const hit = session.get(sameCall);
          const r = hit && now - hit.at <= SESSION_WINDOW_SEC ? all.find((x) => x.seq === hit.seq) : undefined;
          if (r && (await paidHashes()).has(r.hash)) prior = r;
        }
        {
          if (prior) {
            // the same request again: send the ORIGINAL receipt hash — the vault decides a receipt once, so the repeat is stopped on-chain (DUPLICATE_RECEIPT)
            const out = await d.chain.pay({ merchant: to, amount, fee, receiptHash: prior.hash });
            const l = await left();
            return ok({ ok: out.kind === 'paid', ...(out.kind === 'blocked' ? { reason: out.reason } : {}), ...base, tx: out.txHash, replay_of: prior.seq, ...(flows[0] ? { kiln_witness: flows[0].generationId } : {}), ...l, summary: `Refused on-chain as a repeat of receipt #${prior.seq} — nothing paid; ${l.left_usdt} USDT left on the line.` });
          }
        }
        const r = await guardedPay(d, { merchant: to, amount, fee, why: a.why.trim(), flows, ...(asked ? { asked } : {}) });
        session.set(sameCall, { seq: r.receipt.seq, at: now });
        const l = await left();
        const who = nameOf(to) ?? to;
        const summary = r.outcome.kind === 'paid'
          ? `Paid ${fmtUsdt(amount + fee)} USDT (${fmtUsdt(amount)} + fee ${fmtUsdt(fee)}) to ${who}; ${l.left_usdt} USDT left on the line.`
          : `Stopped on-chain (${r.outcome.reason}) — nothing paid to ${who}; ${l.left_usdt} USDT left on the line.`;
        const rest = { ...base, tx: r.outcome.txHash, receipt_seq: r.receipt.seq, receipt_hash: r.receipt.hash, ...(flows[0] ? { kiln_witness: flows[0].generationId } : {}), ...l, summary };
        return r.outcome.kind === 'paid' ? ok({ ok: true, ...rest }) : ok({ ok: false, reason: r.outcome.reason, ...rest });
  }
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
          offers: offers.map((o) => ({ seller: nameOf(o.merchant) ?? o.label, item: o.item, unit_price_usdt: fmtUsdt(o.unitPrice), fee_usdt: fmtUsdt(o.fee) })),
          ...(d.demo ? { demo: true, note: 'in-memory sandbox: same rule as the vault, nothing is sent to TRON' } : {}),
        });
      },
    },
    {
      name: 'spendline_pay',
      description:
        'Pay a seller in test USDT through the Spendline vault on TRON. Tell the person the reply\'s `summary` (what was paid with the fee, and what is left). For a seller in the catalog (spendline_line.offers) give the item and quantity: code prices it. The vault pays only inside the line; outside it the payment is stopped and the reason is recorded on-chain (ok: false). Every attempt that reaches the vault leaves a hash-chained receipt anyone can audit.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: `seller: one of these names exactly: ${Object.values(d.labels).join(', ')} — or a TRON address` },
          item: { type: 'string', description: `catalog item: ${[...new Set(offers.map((o) => o.item))].join(', ')} (optional when the seller sells one item)` },
          quantity: { type: 'number', description: 'how many units, default 1' },
          why: { type: 'string', description: "the reason in the words of the request — becomes the receipt's words" },
          amount_usdt: { type: 'number', description: 'only for a seller that is not in the catalog: the amount in USDT (up to 6 decimals), fee not included' },
          fee_usdt: { type: 'number', description: 'only for a seller that is not in the catalog: the fee in USDT, default 0' },
        },
        required: ['to', 'why'],
        additionalProperties: false,
      },
      run(a, meta = {}) {
        return serialized(session, () => pay(a, meta)); // parallel tool calls from a host run one at a time (live 2026-09-29)
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
