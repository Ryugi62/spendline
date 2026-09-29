// AC-45 — the pass-through an unmodified agent host points its OpenAI-compatible base URL at. It forwards to Kiln with the Kiln key
// (the host may send any key), returns Kiln's reply unchanged, and journals what the witness needs. Streamed requests pass through unjournaled.
import { entryFromKilnResponse, paidSeen, type JournalEntry } from '../domain/kilnJournal';

export type ProxyOut = { status: number; headers: Record<string, string>; body: string };
type Msg = { role?: string; content?: unknown };
const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : '')).join('') : '');

export async function proxyChat(o: { body: string; kiln: { baseUrl: string; apiKey: string }; fetchImpl: typeof fetch; record: (e: JournalEntry) => Promise<void>; now: () => number;
  /** sha256 hex (the adapter passes node:crypto) — for the reply body and the conversation key */ hash?: (s: string) => string;
  /** add Qwen3's /no_think soft switch to the last user turn (a stock host does not) */ noThink?: boolean;
  /** keep Kiln's reply body verbatim (published next to the journal, so bodySha256 can be recomputed) */ saveBody?: (generationId: string, body: string) => Promise<void> }): Promise<ProxyOut> {
  let body = o.body;
  let msgs: Msg[] = [];
  try {
    const j = JSON.parse(body) as { messages?: Msg[] };
    msgs = j.messages ?? [];
    if (o.noThink) {
      const last = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
      if (last && !/\/(no_)?think\b/.test(String(last.content))) { last.content = `${String(last.content)} /no_think`; body = JSON.stringify(j); }
    }
  } catch { /* not JSON: Kiln answers it */ }
  // the person's request = the LAST user turn; the conversation instance = the chat up to that turn (a new turn opens a new instance)
  const users = msgs.filter((m) => m.role === 'user').map((m) => textOf(m.content).replace(/ \/no_think$/, ''));
  const asked = users.at(-1);
  const opening = [textOf(msgs.find((m) => m.role === 'system')?.content), ...users].join('\n');
  const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
  const convo = { ...(asked ? { asked } : {}), conversationKey: o.hash ? o.hash(opening) : opening, conversationStart: lastUser >= 0 && !msgs.slice(lastUser + 1).some((m) => m.role === 'assistant' || m.role === 'tool'), ...(o.noThink ? { noThink: true } : {}), paidSeen: paidSeen(msgs as Parameters<typeof paidSeen>[0]) };
  let streamed = false;
  try { streamed = (JSON.parse(body) as { stream?: unknown }).stream === true; } catch { /* Kiln answers a bad body itself */ }
  const t0 = o.now();
  const res = await o.fetchImpl(`${o.kiln.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${o.kiln.apiKey}`, 'Content-Type': 'application/json' }, body });
  const text = await res.text();
  const headers: Record<string, string> = { 'content-type': res.headers.get('content-type') ?? 'application/json' };
  const gen = res.headers.get('x-neocloud-generation-id');
  if (gen) headers['x-neocloud-generation-id'] = gen;
  if (streamed) return { status: res.status, headers: { ...headers, 'x-spendline-witness': 'not recorded: streamed' }, body: text };
  if (res.ok && gen) {
    try {
      const server = Number(res.headers.get('x-envoy-upstream-service-time'));
      await o.record({ ...entryFromKilnResponse(JSON.parse(text), { generationId: gen, latencyMs: o.now() - t0, ...(Number.isFinite(server) && res.headers.has('x-envoy-upstream-service-time') ? { serverMs: server } : {}), at: o.now() }), ...convo, ...(o.hash ? { bodySha256: o.hash(text) } : {}) });
      if (o.saveBody) await o.saveBody(gen, text);
      headers['x-spendline-witness'] = 'recorded';
    } catch { headers['x-spendline-witness'] = 'not recorded: unreadable reply'; }
  }
  return { status: res.status, headers, body: text };
}
