// AC-45 — the Kiln witness for an unmodified agent host. A pass-through in front of Kiln keeps, per reply: the generation id, the usage
// and the tool calls the model asked for. A spendline_pay is bound to the newest reply (≤ 120 s) whose tool call carries exactly its
// arguments — the model's own words about the payment — so a stock host gets witnessed receipts without any host code.
import { balancedObjects, leakedToolCall } from './intent';
import { canonical } from './receipt';
import type { UsageRecord } from './tokenLedger';
import type { KilnGeneration } from './attest';

export type JournalCall = { name: string; arguments: string; via: 'tool_call' | 'tool_call_in_text' };
export type JournalEntry = {
  generationId: string; at: number; usage: UsageRecord; toolCalls: JournalCall[];
  /** round-4 review: the person's request (the last user turn), the conversation it belongs to (hash of its opening),
   *  whether this reply opened it, sha256 of Kiln's whole reply body, and whether the pass-through switched thinking off */
  asked?: string; conversationKey?: string; conversationStart?: boolean; bodySha256?: string; noThink?: boolean;
  /** round-7 review: the items (seller|item|quantity) of pay calls since the last user turn whose result the model saw as paid */
  paidSeen?: string[];
};
export const WITNESS_WINDOW_MS = 120_000;

type KilnReply = { choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };

export function entryFromKilnResponse(j: KilnReply, o: { generationId: string; latencyMs: number; serverMs?: number; at: number }): JournalEntry {
  const m = j.choices?.[0]?.message;
  const proper: JournalCall[] = (m?.tool_calls ?? []).flatMap((c) => (c.function?.name ? [{ name: c.function.name, arguments: c.function.arguments ?? '{}', via: 'tool_call' as const }] : []));
  const text = (m?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const leaked: JournalCall[] = proper.length ? [] : balancedObjects(text).flatMap((b) => {
    const name = (() => { try { return (JSON.parse(b) as { name?: unknown }).name; } catch { return undefined; } })();
    const args = typeof name === 'string' ? leakedToolCall(b, name) : undefined;
    return typeof name === 'string' && args ? [{ name, arguments: args, via: 'tool_call_in_text' as const }] : [];
  });
  return {
    generationId: o.generationId,
    at: o.at,
    usage: {
      flow: 'F4_mcp_host', promptTokens: j.usage?.prompt_tokens ?? 0, completionTokens: j.usage?.completion_tokens ?? 0, costUsd: j.usage?.cost ?? 0,
      latencyMs: Math.round(o.latencyMs), generationId: o.generationId, ...(o.serverMs !== undefined ? { serverMs: o.serverMs } : {}),
    },
    toolCalls: [...proper, ...leaked],
  };
}

const same = (raw: string, args: unknown) => { try { return canonical(JSON.parse(raw)) === canonical(args); } catch { return false; } };
/** the same item = seller, item and quantity (what the vault is asked to pay for), whatever free text (`why`) the model wrote */
export const itemOf = (a: unknown) => { const o = (a ?? {}) as Record<string, unknown>; return `${String(o.to ?? '').trim().toLowerCase()}|${String(o.item ?? '')}|${String(o.quantity ?? 1)}`; };
const sameItem = (raw: string, args: unknown) => { try { return itemOf(JSON.parse(raw)) === itemOf(args); } catch { return false; } };

/** The Kiln call behind this tool call, as the receipt's usage (with the model's arguments verbatim), or undefined. `key` marks it used. */
/** The conversation instance of an entry: the latest reply at or before it that opened a conversation with the same opening. */
function instanceOf(entries: JournalEntry[], e: JournalEntry): string {
  if (e.conversationKey === undefined) return e.generationId;
  const start = entries.filter((x) => x.conversationKey === e.conversationKey && x.conversationStart && x.at <= e.at).sort((a, b) => b.at - a.at)[0];
  return start?.generationId ?? e.generationId;
}

export type Witness = UsageRecord & { key: string; occurrence: number; conversation: string; asked?: string };
export function findWitness(entries: JournalEntry[], call: { name: string; args: unknown }, o: { now: number; used: Set<string>; windowMs?: number }): Witness | undefined {
  const win = o.windowMs ?? WITNESS_WINDOW_MS;
  for (const e of [...entries].filter((x) => x.at <= o.now && o.now - x.at <= win).sort((a, b) => b.at - a.at)) {
    for (const [i, tc] of e.toolCalls.entries()) {
      const key = `${e.generationId}#${i}`;
      if (tc.name === call.name && !o.used.has(key) && same(tc.arguments, call.args)) {
        // occurrence = identical items earlier IN THIS Kiln reply: two identical items asked for together → 0, 1. Round-6 review: the same
        // item asked for again in a later reply (a retry after a timeout or an error) starts at 0 again, so it maps to the earlier paid
        // purchase and is refused as a repeat — a double charge is worse than a refusal; more of one item goes in `quantity`.
        const conversation = instanceOf(entries, e);
        // round-7 review: plus identical items the model already SAW PAID in this turn (a result {"ok":true,"receipt_seq":…} in the request) —
        // a second hour after a paid first is a new purchase; after an error, a timeout or no result it is a retry.
        const earlier = e.toolCalls.filter((t, j) => j < i && t.name === call.name && sameItem(t.arguments, call.args)).length
          + (e.paidSeen ?? []).filter((x) => x === itemOf(call.args)).length;
        return { ...e.usage, args: tc.arguments, via: tc.via, key, occurrence: earlier, conversation, ...(e.asked ? { asked: e.asked } : {}) };
      }
    }
  }
  return undefined;
}

type ChatMsg = { role?: string; content?: unknown; tool_call_id?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] };
/** The pay calls since the last user turn whose tool result the model saw say paid (`ok: true` with a receipt) — as items. */
export function paidSeen(msgs: ChatMsg[], tool = 'spendline_pay'): string[] {
  const from = msgs.map((m) => m.role).lastIndexOf('user');
  const turn = msgs.slice(from + 1);
  const results = new Map(turn.filter((m) => m.role === 'tool' && m.tool_call_id).map((m) => [m.tool_call_id!, typeof m.content === 'string' ? m.content : '']));
  return turn.flatMap((m) => (m.role === 'assistant' ? m.tool_calls ?? [] : [])).flatMap((c) => {
    if (c.function?.name !== tool || !c.id) return [];
    try {
      const r = JSON.parse(results.get(c.id) ?? '') as { ok?: unknown; receipt_seq?: unknown };
      return r.ok === true && typeof r.receipt_seq === 'number' ? [itemOf(JSON.parse(c.function.arguments ?? '{}'))] : [];
    } catch { return []; }
  });
}

/** Receipts whose Kiln call is in the published journal: its arguments must be one of that reply's tool calls, byte for byte. */
export function journalCheck(receipts: { seq: number; flows: UsageRecord[] }[], entries: JournalEntry[]): { inJournal: number; checked: number; mismatches: string[] } {
  const byGen = new Map(entries.map((e) => [e.generationId, e]));
  let inJournal = 0, checked = 0;
  const mismatches: string[] = [];
  for (const r of receipts) for (const u of r.flows) {
    const e = byGen.get(u.generationId);
    if (!e || u.args === undefined) continue;
    checked++;
    if (e.toolCalls.some((t) => t.arguments === u.args)) inJournal++;
    else mismatches.push(`#${r.seq}: the journal has no such call for ${u.generationId}`);
  }
  return { inJournal, checked, mismatches };
}

/** Published reply bodies (docs/live/kiln-replies-*): each must hash to the journal's bodySha256, re-parse to exactly the journal's tool
 *  calls, and (round-6 review) agree with Kiln's own GET /v1/generations record for that id — prompt and completion tokens, cost, and
 *  its time within 10 s. The last check does not rest on our files: Kiln counted those tokens for that id. */
export function bodyCheck(entries: JournalEntry[], bodies: Map<string, string>, hash: (s: string) => string, kiln?: Record<string, KilnGeneration | null>): { checked: number; ok: number; bad: string[]; hashMatch: number; callsMatch: number; kilnMatch: number } {
  let checked = 0, ok = 0, hashMatch = 0, callsMatch = 0, kilnMatch = 0;
  const bad: string[] = [];
  for (const e of entries) {
    const b = bodies.get(e.generationId);
    if (b === undefined || !e.bodySha256) continue;
    checked++;
    const problems: string[] = [];
    if (hash(b) === e.bodySha256) hashMatch++; else problems.push('sha256 differs from the journal');
    let j: (KilnReply & { created?: number }) | undefined;
    try { j = JSON.parse(b) as KilnReply & { created?: number }; } catch { /* not JSON: its calls cannot match */ }
    const calls = j ? entryFromKilnResponse(j, { generationId: e.generationId, latencyMs: 0, at: 0 }).toolCalls : undefined;
    if (calls && canonical(calls.map((c) => [c.name, c.arguments])) === canonical(e.toolCalls.map((c) => [c.name, c.arguments]))) callsMatch++; else problems.push('tool calls differ from the journal');
    const k = kiln?.[e.generationId];
    if (kiln) {
      if (k && j?.usage && j.usage.prompt_tokens === k.promptTokens && j.usage.completion_tokens === k.completionTokens && Math.abs((j.usage.cost ?? 0) - k.totalCost) < 1e-9 && typeof j.created === 'number' && Math.abs(j.created - k.createdAt) <= 10) kilnMatch++;
      else problems.push("usage or time differs from Kiln's record");
    }
    if (problems.length) bad.push(`${e.generationId}: ${problems.join(', ')}`); else ok++;
  }
  return { checked, ok, bad, hashMatch, callsMatch, kilnMatch };
}
