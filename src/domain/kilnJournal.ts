// AC-45 — the Kiln witness for an unmodified agent host. A pass-through in front of Kiln keeps, per reply: the generation id, the usage
// and the tool calls the model asked for. A spendline_pay is bound to the newest reply (≤ 120 s) whose tool call carries exactly its
// arguments — the model's own words about the payment — so a stock host gets witnessed receipts without any host code.
import { balancedObjects, leakedToolCall } from './intent';
import { canonical } from './receipt';
import type { UsageRecord } from './tokenLedger';

export type JournalCall = { name: string; arguments: string; via: 'tool_call' | 'tool_call_in_text' };
export type JournalEntry = { generationId: string; at: number; usage: UsageRecord; toolCalls: JournalCall[] };
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

/** The Kiln call behind this tool call, as the receipt's usage (with the model's arguments verbatim), or undefined. `key` marks it used. */
export function findWitness(entries: JournalEntry[], call: { name: string; args: unknown }, o: { now: number; used: Set<string>; windowMs?: number }): (UsageRecord & { key: string }) | undefined {
  const win = o.windowMs ?? WITNESS_WINDOW_MS;
  for (const e of [...entries].filter((x) => x.at <= o.now && o.now - x.at <= win).sort((a, b) => b.at - a.at)) {
    for (const [i, tc] of e.toolCalls.entries()) {
      const key = `${e.generationId}#${i}`;
      if (tc.name === call.name && !o.used.has(key) && same(tc.arguments, call.args)) return { ...e.usage, args: tc.arguments, via: tc.via, key };
    }
  }
  return undefined;
}
