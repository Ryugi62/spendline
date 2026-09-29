// AC-45 — the pass-through an unmodified agent host points its OpenAI-compatible base URL at. It forwards to Kiln with the Kiln key
// (the host may send any key), returns Kiln's reply unchanged, and journals what the witness needs. Streamed requests pass through unjournaled.
import { entryFromKilnResponse, type JournalEntry } from '../domain/kilnJournal';

export type ProxyOut = { status: number; headers: Record<string, string>; body: string };
export async function proxyChat(o: { body: string; kiln: { baseUrl: string; apiKey: string }; fetchImpl: typeof fetch; record: (e: JournalEntry) => Promise<void>; now: () => number }): Promise<ProxyOut> {
  let streamed = false;
  try { streamed = (JSON.parse(o.body) as { stream?: unknown }).stream === true; } catch { /* Kiln answers a bad body itself */ }
  const t0 = o.now();
  const res = await o.fetchImpl(`${o.kiln.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${o.kiln.apiKey}`, 'Content-Type': 'application/json' }, body: o.body });
  const text = await res.text();
  const headers: Record<string, string> = { 'content-type': res.headers.get('content-type') ?? 'application/json' };
  const gen = res.headers.get('x-neocloud-generation-id');
  if (gen) headers['x-neocloud-generation-id'] = gen;
  if (streamed) return { status: res.status, headers: { ...headers, 'x-spendline-witness': 'not recorded: streamed' }, body: text };
  if (res.ok && gen) {
    try {
      const server = Number(res.headers.get('x-envoy-upstream-service-time'));
      await o.record(entryFromKilnResponse(JSON.parse(text), { generationId: gen, latencyMs: o.now() - t0, ...(Number.isFinite(server) && res.headers.has('x-envoy-upstream-service-time') ? { serverMs: server } : {}), at: o.now() }));
      headers['x-spendline-witness'] = 'recorded';
    } catch { headers['x-spendline-witness'] = 'not recorded: unreadable reply'; }
  }
  return { status: res.status, headers, body: text };
}
