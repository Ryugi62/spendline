// Stage page for the demo video (M0-16): terminal-style panels built ONLY from public record files —
// the vault's SpendBlocked event as TronGrid returned it (session.json), the keyless audit output, the per-flow report.
// usage: npm run video:stage   → docs/video/stage.html (open with file://, no network)
import { readFileSync, writeFileSync } from 'node:fs';
import { esc } from '../src/adapters/web/render';
import type { Session } from '../src/application/views';
import { recordFacts } from '../src/infrastructure/record-facts';

const f = recordFacts();
const s = JSON.parse(readFileSync('web/public/session.json', 'utf8')) as Session;
const stop = f.stops.find((x) => x.seq === f.merchantStopSeq)!;
const event = s.events.find((e) => e.txHash === stop.tx)!;
const auditOut = readFileSync('docs/audit-nile-live-2026-09-26.txt', 'utf8').trim();
const table = readFileSync('docs/tokens-by-flow.md', 'utf8').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Flow') && !l.startsWith('|---'));
const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/\*\*/g, '').replace(/`/g, ''));
const rows = table.slice(0, 4).map((l) => { const c = cells(l); return `<tr><td>${esc(c[0])}</td><td>${c[2]}</td><td>${c[5]}</td><td>${esc(c[6])}</td><td>${esc(c[7])}</td><td>${c[9]}</td></tr>`; }).join('');
const abRows = table.slice(4).map((l) => { const c = cells(l); return `<tr><td>${esc(c[0])}</td><td>${c[1]}</td><td>${c[2]}</td><td>${c[3]}</td><td>${esc(c[4])}</td><td>${c[5]}</td></tr>`; }).join('');

const panel = (id: string, title: string, body: string) => `<section id="${id}"><p class="t">${esc(title)}</p>${body}</section>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spendline — demo stage</title><style>
html,body{margin:0;background:#101113;color:#f2f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
section{height:720px;margin-bottom:240px;box-sizing:border-box;padding:56px 72px 120px;display:flex;flex-direction:column;gap:18px;justify-content:center}
.t{font-size:30px;font-weight:700;margin:0}.s{color:#b0b8c1;font-size:20px;margin:0}
pre{font:17px/1.55 ui-monospace,Menlo,monospace;background:#1b1d21;border-radius:16px;padding:20px 24px;margin:0;white-space:pre-wrap;word-break:break-all}
.hl{color:#ff6b78;font-weight:700}.ok{color:#3ddc84;font-weight:700}
table{border-collapse:collapse;font-size:20px}td,th{padding:10px 16px;border-bottom:1px solid #2c2f35;text-align:right}td:first-child,th:first-child{text-align:left}th{color:#b0b8c1;font-weight:600}
h1{font-size:72px;margin:0;color:#3182f6}.big{font-size:30px;line-height:1.4;margin:0}
</style></head><body>
${panel('title', 'Spendline — receipts for AI spending', `<h1>Spendline</h1><p class="big">A person draws the line. The agent only asks. The vault on TRON decides — and records every stop.</p>`)}
${panel('event', "The vault's public event — as TronGrid returns it (no key)", `<pre>${esc(JSON.stringify({ event: 'SpendBlocked', receiptHash: (event as { receiptHash?: string }).receiptHash, merchant: (event as { merchant?: string }).merchant, reason: stop.reason, txHash: stop.tx }, null, 2)).replace(stop.reason, `<span class="hl">${stop.reason}</span>`)}</pre><p class="s">Vault ${esc(f.vault)} · TRON Nile</p>`)}
${panel('grant', 'The person signs — owner key, on their own machine', `<pre>$ npm run grant -- mandate.json      # the JSON the Grant screen copies
MandateGranted · tx ${esc(f.grantTx ?? '')}

$ npm run stop
Paused · tx ${esc(f.stopTx ?? '')}</pre>`)}
${panel('audit', 'Anyone checks it — no key, no .env', `<pre>${esc(auditOut).replace(/→ OK/, '→ <span class="ok">OK</span>')}</pre>`)}
${panel('tokens', 'Kiln tokens by flow — live qwen3-32b', `<table><tr><th>Flow</th><th>Calls</th><th>Tokens</th><th>USD</th><th>Median latency</th><th>Wh (est.)</th></tr>${rows}</table><p class="s">${f.callsPerPurchase} LLM call per purchase · Wh = 180 W (RNGD TDP) × measured wall time — an estimate, stated</p>`)}
${panel('ab', '/no_think A/B — the same request, n = ' + f.ab.n, `<table><tr><th>Arm</th><th>n</th><th>JSON parsed</th><th>Median output tokens</th><th>Median latency</th><th>Median Wh</th></tr>${abRows}</table><p class="s">Same JSON ${f.ab.sameJson} / ${f.ab.n} pairs</p>`)}
${panel('end', 'Spendline', `<h1>Spendline</h1><p class="big">Not an agent that can pay — a payment that can prove it was allowed.</p><p class="s">${f.receipts} receipts · ${f.problems} problems · every model call on Kiln · every stop on-chain</p>`)}
</body></html>`;
writeFileSync('docs/video/stage.html', html);
console.log('docs/video/stage.html');
