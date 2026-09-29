// AC-45 — the Kiln witness for an unmodified agent host. A pass-through in front of Kiln keeps, per reply: the generation id, the usage
// and the tool calls the model asked for. A spendline_pay is bound to the newest reply (≤ 120 s) whose tool call carries exactly its
// arguments — the model's own words about the payment — so a stock host gets witnessed receipts without any host code.
import { balancedObjects, leakedToolCall } from './intent';
import { canonical } from './receipt';
import type { UsageRecord } from './tokenLedger';

export type JournalCall = { name: string; arguments: string; via: 'tool_call' | 'tool_call_in_text' };
export type JournalEntry = {
  generationId: string; at: number; usage: UsageRecord; toolCalls: JournalCall[];
  /** round-4 review: the person's request (the conversation's first user message), the conversation it belongs to (hash of its opening),
   *  whether this reply opened it, sha256 of Kiln's whole reply body, and whether the pass-through switched thinking off */
  asked?: string; conversationKey?: string; conversationStart?: boolean; bodySha256?: string; noThink?: boolean;
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
const itemOf = (a: unknown) => { const o = (a ?? {}) as Record<string, unknown>; return `${String(o.to ?? '').trim().toLowerCase()}|${String(o.item ?? '')}|${String(o.quantity ?? 1)}`; };
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
        // occurrence = identical calls earlier in the same conversation instance (the model's own sequence): two identical items → 0, 1
        const conversation = instanceOf(entries, e);
        const earlier = entries.filter((x) => instanceOf(entries, x) === conversation).flatMap((x) => x.toolCalls.map((t, j) => ({ x, t, j })))
          .filter(({ x, t, j }) => (x.at < e.at || (x === e && j < i)) && t.name === call.name && sameItem(t.arguments, call.args)).length;
        return { ...e.usage, args: tc.arguments, via: tc.via, key, occurrence: earlier, conversation, ...(e.asked ? { asked: e.asked } : {}) };
      }
    }
  }
  return undefined;
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

/** Published reply bodies (docs/live/kiln-replies-*) hash to the journal's bodySha256 — the journal's tool calls are what Kiln returned. */
export function bodyCheck(entries: JournalEntry[], bodies: Map<string, string>, hash: (s: string) => string): { checked: number; ok: number; bad: string[] } {
  let checked = 0, ok = 0;
  const bad: string[] = [];
  for (const e of entries) {
    const b = bodies.get(e.generationId);
    if (b === undefined || !e.bodySha256) continue;
    checked++;
    if (hash(b) === e.bodySha256) ok++; else bad.push(e.generationId);
  }
  return { checked, ok, bad };
}
