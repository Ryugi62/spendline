// AC-45 composition root — the Kiln pass-through for an unmodified agent host:
//   npm run kiln:proxy [-- --port 8787]      then point the host's OpenAI base URL at http://127.0.0.1:8787/v1 (any API key)
// Forwards to Kiln with the Kiln key from .env, returns Kiln's reply unchanged, and appends one line per reply to the journal
// (generation id, usage, the tool calls asked for — no prompt text). `npm run mcp` with SPENDLINE_KILN_JOURNAL set binds each
// spendline_pay to the Kiln reply whose tool call carries exactly its arguments.
import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname } from 'node:path';
import { proxyChat } from '../application/kilnProxy';
import { flag, need, readEnv } from './runtime';

export const DEFAULT_JOURNAL = '.spendline/kiln-journal.jsonl';

export function startKilnProxy(o: { port: number; kiln: { baseUrl: string; apiKey: string }; journalPath: string }): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  mkdirSync(dirname(o.journalPath), { recursive: true });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      if (req.method === 'POST' && req.url?.replace(/\/$/, '').endsWith('/chat/completions')) {
        const out = await proxyChat({ body, kiln: o.kiln, fetchImpl: fetch, record: async (e) => appendFileSync(o.journalPath, JSON.stringify(e) + '\n'), now: () => Date.now() });
        res.writeHead(out.status, out.headers).end(out.body);
      } else if (req.method === 'GET' && req.url?.endsWith('/models')) {
        const r = await fetch(`${o.kiln.baseUrl}/models`, { headers: { Authorization: `Bearer ${o.kiln.apiKey}` } });
        res.writeHead(r.status, { 'content-type': 'application/json' }).end(await r.text());
      } else res.writeHead(404).end();
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `proxy: ${e instanceof Error ? e.message : String(e)}` } }));
    }
  });
  return new Promise((resolve) => server.listen(o.port, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    resolve({ url: `http://127.0.0.1:${port}/v1`, server, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

export function kilnFromEnv() {
  const env = readEnv();
  need(env, 'KILN_API_KEY');
  return { baseUrl: (env.KILN_BASE_URL ?? 'https://api.bricksum.com/v1').replace(/\/$/, ''), apiKey: env.KILN_API_KEY };
}

if (process.argv[1]?.endsWith('kiln-proxy.ts')) {
  const args = process.argv.slice(2);
  const journalPath = flag(args, '--journal') ?? process.env.SPENDLINE_KILN_JOURNAL ?? DEFAULT_JOURNAL;
  startKilnProxy({ port: Number(flag(args, '--port') ?? 8787), kiln: kilnFromEnv(), journalPath }).then((p) => console.error(`Kiln pass-through on ${p.url} → journal ${journalPath}`));
}
