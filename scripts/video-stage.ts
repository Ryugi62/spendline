// Stage page for the demo video (M0-16): terminal-style panels built ONLY from public record files —
// the vault's SpendBlocked event as TronGrid returned it (session.json), the keyless audit output, the per-flow report.
// v0.8 (AC-36): #agent = the live `npm run agent` transcripts of the 48 h window (docs/live/agent-*.txt), verbatim, each checked against the record.
// usage: npm run video:stage   → docs/video/stage.html (open with file://, no network)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { esc } from '../src/adapters/web/render';
import { checkTranscript, terminalScene } from '../src/application/terminal';
import type { Session } from '../src/application/views';
import { recordFacts } from '../src/infrastructure/record-facts';
import { REASON_CODE } from '../src/domain/mandate';

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
// runs 4–5: the plain-words request (Kiln sent three tool calls in one reply; code priced them) and the same request again (repeats refused on-chain)
const condense = (t: string) => t.slice(0, t.indexOf('Kiln qwen3-32b → answer')).trim().split('\n').filter((l) => !l.startsWith('→ docs/') && !/^\d{4}-\d\d-\d\dT/.test(l)).map((l) => {
  if (l.startsWith('$ ')) return l.replace('$ date -u; git rev-parse --short HEAD; ', '$ ');
  const call = l.match(/spendline_pay\((\{.*?\})\) · (\d+)\+(\d+) tokens.* gen ([0-9a-f]{8})[0-9a-f-]* · via (.*)$/);
  if (call) { const a = JSON.parse(call[1]) as Record<string, unknown>; return `Kiln → spendline_pay(${a.to} · ${a.item} × ${a.quantity ?? 1}) · ${call[2]}+${call[3]} tokens · gen ${call[4]}… · ${call[5]}`; }
  const m = l.match(/^  ← (\{.*\})$/);
  if (!m) return l.replace(/ · \$[0-9.]+ · gen ([0-9a-f]{8})[0-9a-f-]+/, ' · gen $1…');
  const r = JSON.parse(m[1]) as Record<string, unknown>;
  if (typeof r.tx === 'string' && !txs.includes(r.tx)) throw new Error(`#mcp refused: ${r.tx} is not in the record`);
  return `  ← ${r.ok ? 'ok' : `stopped ${r.reason}`} · ${r.seller} ${r.amount_usdt} + ${r.fee_usdt} (${r.priced_by}) · ${r.replay_of ? `repeat of #${r.replay_of}` : `receipt #${r.receipt_seq}`} · tx ${String(r.tx).slice(0, 10)}…`;
}).join('\n');
const field = (l: string, k: string) => l.match(new RegExp(`"${k}":"?([^",}]*)`))?.[1];
// the stock agent with thinking off (#35, #36), then the same request again (both refused on-chain) — its own transcripts, condensed
const sdkCondense = (t: string) => t.split('\n').filter((l) => l.startsWith('$ ') || l.startsWith('→ spendline_pay') || l.startsWith('  ← {')).map((l) => {
  if (l.startsWith('$ ')) return l.replace('$ date -u; git rev-parse --short HEAD; ', '$ ');
  const call = l.match(/^→ spendline_pay\((\{.*?\})\)/);
  if (call) { const a = JSON.parse(call[1]) as Record<string, unknown>; return `→ spendline_pay(${a.to} · ${a.item} × ${a.quantity ?? 1})`; }
  const tx = field(l, 'tx') ?? '';
  if (!txs.includes(tx)) throw new Error(`#mcp refused: ${tx} is not in the record`);
  return `  ← ${field(l, 'ok') === 'true' ? 'ok' : `stopped ${field(l, 'reason')}`} · ${field(l, 'seller')} ${field(l, 'amount_usdt')} + fee ${field(l, 'fee_usdt')} · ${field(l, 'replay_of') ? `repeat of #${field(l, 'replay_of')}` : `receipt #${field(l, 'receipt_seq')}`}${field(l, 'left_usdt') ? ` · left ${field(l, 'left_usdt')}` : ''} · tx ${tx.slice(0, 10)}…`;
}).join('\n');
const mcpShown = ['docs/live/agents-sdk-live-20260929152005.txt', 'docs/live/agents-sdk-live-20260929152025.txt'].map((f) => sdkCondense(readFileSync(f, 'utf8').trim())).join('\n\n');
// the attest panel shows the calls behind payments; F2 / F3 / host-only rows stay in docs/kiln-attest.txt
const attestOut = readFileSync('docs/kiln-attest.txt', 'utf8').trim().split('\n').filter((l) => !l.startsWith('OTHER_ACCOUNT') && !/^MATCH\s+(F2|F3|F4 host)/.test(l) && !(/^MATCH/.test(l) && !l.includes('args →'))).map((l) => l.replace(/ \(the builder's personal key[^)]*\)/, ' (the builder\'s personal key, before team32)')).join('\n');
const statementHead = readFileSync('docs/statement.md', 'utf8').split('\n').filter((l) => l.startsWith('Paid inside') || /^\| (GPU Shop|Kiln credits|[A-Z_]+ \|)/.test(l)).join('\n');
const tuneOut = readFileSync('docs/tune-next-line.txt', 'utf8').trim();
// #sdk: the stock OpenAI Agents SDK's live run (verbatim lines: its pay calls with the Kiln generation each was bound to, and the results)
const sdkRaw = readFileSync('docs/live/agents-sdk-live-20260929144349.txt', 'utf8').trim().split('\n');
const sdkShown = sdkRaw.filter((l) => l.startsWith('→ spendline_pay') || (l.startsWith('  ← {') && l.includes('"receipt_seq"')) || l.startsWith('# Kiln reply 50598d32')).map((l) => {
  const call = l.match(/^→ spendline_pay\((\{.*?\})\) · Kiln gen ([0-9a-f]{8})/);
  if (call) { const a = JSON.parse(call[1]) as Record<string, unknown>; return `→ spendline_pay(${a.to} · ${a.item} × ${a.quantity ?? 1}) · bound to Kiln reply ${call[2]}…`; }
  if (!l.startsWith('  ← ')) return l.replace(/ · \$[0-9.]+/, '');
  const tx = field(l, 'tx') ?? '';
  if (!txs.includes(tx)) throw new Error(`#sdk refused: ${tx} is not in the record`);
  return `  ← ${field(l, 'ok') === 'true' ? 'ok' : `stopped ${field(l, 'reason')}`} · ${field(l, 'seller')} ${field(l, 'amount_usdt')} + fee ${field(l, 'fee_usdt')} · receipt #${field(l, 'receipt_seq')} · tx ${tx.slice(0, 10)}…`;
}).join('\n');
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
${panel('title', 'Spendline — receipts for AI spending', `<h1>Spendline</h1><p class="big">A person draws the line. The agent only asks. The vault on TRON decides — and records every stop it makes.</p>`)}
${panel('event', "The vault's public event — read from TronGrid with no key, reason code decoded", `<pre>${esc(JSON.stringify({ event: 'SpendBlocked', receiptHash: (event as { receiptHash?: string }).receiptHash, merchant: (event as { merchant?: string }).merchant, reason: `${REASON_CODE[stop.reason as keyof typeof REASON_CODE]} = ${stop.reason}`, txHash: stop.tx }, null, 2)).replace(stop.reason, `<span class="hl">${stop.reason}</span>`)}</pre><p class="s">Vault ${esc(f.vault)} · TRON Nile</p>`)}
${panel('grant', 'The person signs — owner key, on their own machine', `<pre>$ npm run grant -- mandate.json      # the JSON the Grant screen copies
MandateGranted · tx ${esc(f.grantTx ?? '')}

$ npm run stop
Paused · tx ${esc(f.stopTx ?? '')}</pre>`)}
${panel('audit', 'Anyone checks it — no key, no .env', `<pre>${esc(auditOut).replace(/→ OK/, '→ <span class="ok">OK</span>')}</pre>`)}
${panel('agent', 'Live, during the event window — npm run agent on Kiln + TRON Nile', `<p class="s">${agentNote} · from the receipts file</p><div class="term">${agentPre}</div>`)}
${panel('sdk', 'An unmodified agent (OpenAI Agents SDK) on Kiln, through the Spendline pass-through — live on TRON Nile', `<pre>${esc(sdkShown).replace(/← ok/g, '← <span class="ok">ok</span>').replace(/(stopped [A-Z_]+)/g, '<span class="hl">$1</span>')}</pre><p class="s">Each payment is bound to the Kiln call that asked for it: same arguments, byte for byte (docs/live/kiln-journal-20260929144349.jsonl)</p>`)}
${panel('mcp', 'The same unmodified agent, thinking off via the pass-through — the request, then the same request again (live, TRON Nile)', `<pre class="small">${esc(mcpShown).replace(/← ok/g, '← <span class="ok">ok</span>').replace(/(stopped [A-Z_]+)/g, '<span class="hl">$1</span>')}</pre>`)}
${panel('attest', "Two witnesses — Kiln's own record vs the receipts on TRON", `<pre class="small">${esc(attestOut).replace(/^(OK — .*)$/m, '<span class="ok">$1</span>')}</pre>`)}
${panel('weekly', "The lead's Friday — npm run statement · npm run tune -- next.json", `<pre>${esc(statementHead)}</pre><pre>${esc(tuneOut)}</pre>`)}
${panel('tokens', 'Kiln tokens by flow — live qwen3-32b', `<table><tr><th>Flow</th><th>Calls</th><th>Tokens</th><th>USD</th><th>Median latency</th><th>Wh (est.)</th></tr>${rows}</table><p class="s">${f.callsPerPurchase} LLM call per purchase · Wh = 180 W (RNGD TDP) × measured wall time — an estimate, stated</p>`)}
${panel('ab', '/no_think A/B — the same request, n = ' + f.ab.n, `<table><tr><th>Arm</th><th>n</th><th>JSON parsed</th><th>Median output tokens</th><th>Median latency</th><th>Median Wh</th></tr>${abRows}</table><p class="s">Same JSON ${f.ab.sameJson} / ${f.ab.n} pairs</p>`)}
${panel('end', 'Spendline', `<h1>Spendline</h1><p class="big">Not an agent that can pay — a payment that can prove it was allowed.</p><p class="s">${f.receipts} receipts · ${f.problems} problems · every model call on Kiln · every stop the vault makes on-chain</p>`)}
</body></html>`;
writeFileSync('docs/video/stage.html', html);
console.log('docs/video/stage.html');
