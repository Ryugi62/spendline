// Stage page for the demo video (M0-16): terminal-style panels built ONLY from public record files —
// the vault's SpendBlocked event as TronGrid returned it (session.json), the keyless audit output, the per-flow report.
// v0.8 (AC-36): #agent = the live `npm run agent` transcripts of the 48 h window (docs/live/agent-*.txt), verbatim, each checked against the record.
// usage: npm run video:stage   → docs/video/stage.html (open with file://, no network)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { esc } from '../src/adapters/web/render';
import { checkTranscript, terminalScene } from '../src/application/terminal';
import type { Session } from '../src/application/views';
import { recordFacts } from '../src/infrastructure/record-facts';

const f = recordFacts();
const s = JSON.parse(readFileSync('web/public/session.json', 'utf8')) as Session;
const stop = f.stops.find((x) => x.seq === f.merchantStopSeq)!;
const event = s.events.find((e) => e.txHash === stop.tx)!;
const latestAudit = readdirSync('docs').filter((n) => /^audit-nile-live-\d{4}-\d{2}-\d{2}\.txt$/.test(n)).sort().at(-1)!; // the newest saved keyless audit
const auditOut = readFileSync(`docs/${latestAudit}`, 'utf8').trim();
const table = readFileSync('docs/tokens-by-flow.md', 'utf8').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Flow') && !l.startsWith('|---'));
const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/\*\*/g, '').replace(/`/g, ''));
const rows = table.slice(0, 4).map((l) => { const c = cells(l); return `<tr><td>${esc(c[0])}</td><td>${c[2]}</td><td>${c[5]}</td><td>${esc(c[6])}</td><td>${esc(c[7])}</td><td>${c[9]}</td></tr>`; }).join('');
const abRows = table.slice(4).filter((l) => /^\| (`\/no_think`|thinking on)/.test(l)).map((l) => { const c = cells(l); return `<tr><td>${esc(c[0])}</td><td>${c[1]}</td><td>${c[2]}</td><td>${c[3]}</td><td>${esc(c[4])}</td><td>${c[5]}</td></tr>`; }).join('');

// The panel fits three: the newest three live runs are shown (every transcript is still checked below). The d12b narration names what they show.
const allTranscripts = readdirSync('docs/live').filter((n) => /^agent-.*\.txt$/.test(n)).sort().map((n) => readFileSync(`docs/live/${n}`, 'utf8').trim());
const transcripts = allTranscripts.slice(-3);
const txs = s.events.map((e) => e.txHash);
const bad = allTranscripts.flatMap((t) => checkTranscript(t, s.receipts, txs));
if (bad.length) throw new Error(`#agent refused (AC-36): ${bad.join('; ')}`);
const live = terminalScene(transcripts, s.receipts);
const agentPre = live.map((r) => `<pre>${esc(r.transcript).replace(/(#\d+ PAID)/, '<span class="ok">$1</span>')}</pre>`).join('');
const agentNote = live.map((r) => `#${r.seq}: F1 via ${esc(r.via)} · ${r.latencyS} s wall · ${r.serverS} s on Kiln's server`).join(' &nbsp;·&nbsp; ');
// v1.1: #mcp = the clean MCP host run (docs/live/mcp-*-run*.txt, newest), every tx checked against the record · #attest = `npm run attest -- --saved`
// (docs/kiln-attest.txt, team32 rows) · #weekly = the statement's head + `npm run tune` on examples/next-line.json (saved in docs/tune-next-line.txt)
const mcpRun = readdirSync('docs/live').filter((n) => /^mcp-.*-run\d+\.txt$/.test(n)).sort().at(-1)!;
const mcpText = readFileSync(`docs/live/${mcpRun}`, 'utf8').trim().split('\n').filter((l) => !l.startsWith('→ docs/')).join('\n');
for (const tx of mcpText.match(/\b[0-9a-f]{64}\b/g) ?? []) if (!txs.includes(tx) && !s.receipts.some((r) => r.hash === tx)) throw new Error(`#mcp refused: ${tx} is not in the record`);
const mcpShown = mcpText.replace(/"receipt_hash":"[0-9a-f]{64}"/g, (m) => m.slice(0, 31) + '…"').replace(/("tx":"[0-9a-f]{16})[0-9a-f]{48}"/g, '$1…"');
const attestOut = readFileSync('docs/kiln-attest.txt', 'utf8').trim().split('\n').filter((l) => !l.startsWith('OTHER_ACCOUNT')).map((l) => l.replace(/ \(the builder's personal key[^)]*\)/, ' (the builder\'s personal key, before team32)')).join('\n');
const statementHead = readFileSync('docs/statement.md', 'utf8').split('\n').filter((l) => l.startsWith('Paid inside') || /^\| (GPU Shop|Kiln credits|[A-Z_]+ \|)/.test(l)).join('\n');
const tuneOut = readFileSync('docs/tune-next-line.txt', 'utf8').trim();
const panel = (id: string, title: string, body: string) => `<section id="${id}"><p class="t">${esc(title)}</p>${body}</section>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spendline — demo stage</title><style>
html,body{margin:0;background:#101113;color:#f2f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
section{height:720px;margin-bottom:240px;box-sizing:border-box;padding:56px 72px 120px;display:flex;flex-direction:column;gap:18px;justify-content:center}
.t{font-size:30px;font-weight:700;margin:0}.s{color:#b0b8c1;font-size:20px;margin:0}
pre{font:17px/1.55 ui-monospace,Menlo,monospace;background:#1b1d21;border-radius:16px;padding:20px 24px;margin:0;white-space:pre-wrap;word-break:break-all}
.hl{color:#ff6b78;font-weight:700}.ok{color:#3ddc84;font-weight:700}
table{border-collapse:collapse;font-size:20px}td,th{padding:10px 16px;border-bottom:1px solid #2c2f35;text-align:right}td:first-child,th:first-child{text-align:left}th{color:#b0b8c1;font-weight:600}
section#agent{justify-content:flex-start;gap:8px}.term{display:flex;flex-direction:column;gap:5px}.term pre{font-size:13px;line-height:1.24;padding:6px 14px}#agent .s{font-size:15px}
h1{font-size:72px;margin:0;color:#3182f6}pre.small{font-size:12.5px;line-height:1.3;padding:10px 16px}section#mcp,section#attest{justify-content:flex-start;gap:10px;padding-top:40px}.big{font-size:30px;line-height:1.4;margin:0}
</style></head><body>
${panel('title', 'Spendline — receipts for AI spending', `<h1>Spendline</h1><p class="big">A person draws the line. The agent only asks. The vault on TRON decides — and records every stop.</p>`)}
${panel('event', "The vault's public event — as TronGrid returns it (no key)", `<pre>${esc(JSON.stringify({ event: 'SpendBlocked', receiptHash: (event as { receiptHash?: string }).receiptHash, merchant: (event as { merchant?: string }).merchant, reason: stop.reason, txHash: stop.tx }, null, 2)).replace(stop.reason, `<span class="hl">${stop.reason}</span>`)}</pre><p class="s">Vault ${esc(f.vault)} · TRON Nile</p>`)}
${panel('grant', 'The person signs — owner key, on their own machine', `<pre>$ npm run grant -- mandate.json      # the JSON the Grant screen copies
MandateGranted · tx ${esc(f.grantTx ?? '')}

$ npm run stop
Paused · tx ${esc(f.stopTx ?? '')}</pre>`)}
${panel('audit', 'Anyone checks it — no key, no .env', `<pre>${esc(auditOut).replace(/→ OK/, '→ <span class="ok">OK</span>')}</pre>`)}
${panel('agent', 'Live, during the event window — npm run agent on Kiln + TRON Nile', `<p class="s">${agentNote} · from the receipts file</p><div class="term">${agentPre}</div>`)}
${panel('mcp', 'Any MCP host — here Qwen3-32B on Kiln (organizer account) + TRON Nile, live', `<pre class="small">${esc(mcpShown).replace(/("ok":true)/g, '<span class="ok">$1</span>').replace(/(MERCHANT_NOT_ALLOWED)/, '<span class="hl">$1</span>')}</pre>`)}
${panel('attest', "Two witnesses — Kiln's own record vs the receipts on TRON", `<pre class="small">${esc(attestOut).replace(/^(OK — .*)$/m, '<span class="ok">$1</span>')}</pre>`)}
${panel('weekly', "The lead's Friday — npm run statement · npm run tune -- next.json", `<pre>${esc(statementHead)}</pre><pre>${esc(tuneOut)}</pre>`)}
${panel('tokens', 'Kiln tokens by flow — live qwen3-32b', `<table><tr><th>Flow</th><th>Calls</th><th>Tokens</th><th>USD</th><th>Median latency</th><th>Wh (est.)</th></tr>${rows}</table><p class="s">${f.callsPerPurchase} LLM call per purchase · Wh = 180 W (RNGD TDP) × measured wall time — an estimate, stated</p>`)}
${panel('ab', '/no_think A/B — the same request, n = ' + f.ab.n, `<table><tr><th>Arm</th><th>n</th><th>JSON parsed</th><th>Median output tokens</th><th>Median latency</th><th>Median Wh</th></tr>${abRows}</table><p class="s">Same JSON ${f.ab.sameJson} / ${f.ab.n} pairs</p>`)}
${panel('end', 'Spendline', `<h1>Spendline</h1><p class="big">Not an agent that can pay — a payment that can prove it was allowed.</p><p class="s">${f.receipts} receipts · ${f.problems} problems · every model call on Kiln · every stop on-chain</p>`)}
</body></html>`;
writeFileSync('docs/video/stage.html', html);
console.log('docs/video/stage.html');
