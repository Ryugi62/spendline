import type { PitchFacts } from '../../application/pitch';
import { esc } from './render';

/**
 * AC-32: Project Introduction + Pitch Deck, built from the record's facts (no number typed by hand).
 * One slide = one 1280×720 page. Toss rules: one message per slide, number first, short words, white + blue.
 */
export type Slide = { id: string; title: string; html: string };

const tx = (h?: string) => (h ? `<code>${esc(h.slice(0, 8))}…</code>` : '<code>—</code>');
const REASON: Record<string, string> = {
  MERCHANT_NOT_ALLOWED: 'seller not on the list',
  OVER_BUDGET_WITH_FEES: 'over budget once fees are added',
  PAUSED: 'after the person pressed STOP',
  DEADLINE_PASSED: 'after the time window closed',
  OVER_TX_CAP: 'over the per-payment cap',
  INVALID_AMOUNT: 'zero or negative amount',
  DUPLICATE_RECEIPT: 'a receipt sent a second time',
};

export function deckSlides(f: PitchFacts, declared: string): Slide[] {
  const stops = f.stops.map((s) => `<li><b>#${s.seq}</b> ${esc(REASON[s.reason] ?? s.reason)} <span class="r">${esc(s.reason)}</span> ${tx(s.tx)}</li>`).join('');
  return [
    {
      id: 'title',
      title: 'Spendline — receipts for AI spending',
      html: `<p class="kicker">GWDC 2026 Korea Hackathon · FuriosaAI × Bricksum · Challenge B</p>
<h1>Spendline</h1><p class="lead">Not “an agent that can pay” — <b>a payment that can prove it was allowed.</b></p>
<p class="declared">${esc(declared)}</p>
<p class="kicker">Taegeol Kim · solo team · github.com/Ryugi62</p>`,
    },
    {
      id: 'moment',
      title: 'The moment: “why did we buy this?”',
      html: `<p class="lead">A 3-person AI startup lead hands the team's weekly GPU-hour and inference-credit budget to a purchasing agent.</p>
<ul class="big-list"><li>A teammate asks: <b>“why did we buy this?”</b></li><li>Payment rails say who paid whom — <i>not who allowed it, or under what line.</i> (the brief)</li>
<li>The lead needs <b>one receipt</b> that answers — and someone else must be able to check it <b>without trusting the lead, the agent or this app.</b></li></ul>`,
    },
    {
      id: 'how',
      title: 'How it works',
      html: `<div class="flow"><div class="box p">Person<br><small>grants a line · STOP<br>(owner key)</small></div><div class="arrow">→</div>
<div class="box k">Kiln · Qwen3-32B<br><small>F1: request words → JSON<br>1 call per purchase</small></div><div class="arrow">→</div>
<div class="box c">Code<br><small>offer · money math · receipt</small></div><div class="arrow">→</div>
<div class="box v">SpendlineVault<br><small>TRON Nile · pays inside the line<br>or records the stop</small></div><div class="arrow">→</div>
<div class="box a">Anyone<br><small>npm run audit<br>no key</small></div></div>
<p class="note">The model reads words. Code does the money. The chain enforces the line. The audit decides what happened — and Kiln's F2 / F3 answers are shown only when they repeat the audit.</p>`,
    },
    {
      id: 'boundaries',
      title: 'Boundaries & stopping — every stop is on-chain',
      html: `<div class="split"><div><p class="num">${f.stopped}<span> stops recorded</span></p><ul class="ev">${stops}
<li><b>replay</b> a paid receipt's hash sent again <span class="r">DUPLICATE_RECEIPT</span> ${tx(f.replayTx)}</li></ul>
<p class="note">Enforced in <code>SpendlineVault.pay() → check()</code>. A stop is an event (<code>SpendBlocked</code>), never a silent revert.</p></div>
<img src="../ui/receipt-stopped-390.png" alt="Receipt screen: stopped on-chain, seller is not on your list"></div>`,
    },
    {
      id: 'kiln',
      title: 'Kiln integration & efficiency',
      html: `<div class="stats"><div><p class="num">${f.callsPerPurchase}</p><p>LLM call per purchase<br><small>design limit 2</small></p></div>
<div><p class="num">${f.kilnCalls}</p><p>live Kiln calls in ${f.flows} flows<br><small>${f.tokens} tokens · $${f.usd}</small></p></div>
<div><p class="num">${f.whPerPurchase}<span> Wh</span></p><p>per purchase (est.)<br><small>${f.wh} Wh in total</small></p></div></div>
<p class="lead">F1 offers a Kiln tool call (<code>propose_purchase</code>, the Qwen3-32B tool parser) — chosen by a rule we fixed before a live A/B; a reply as plain JSON or a call leaked into text is parsed too, and each receipt records which.</p>
<p class="lead">/no_think A/B, n = ${f.ab.n}: median ${f.ab.offTokens} vs ${f.ab.onTokens} output tokens · ${f.ab.offSeconds} vs ${f.ab.onSeconds} s · same JSON ${f.ab.sameJson}/${f.ab.n} → ${f.ab.tokensSavedPct}% fewer tokens.</p>
<p class="note">Receipt #13 on, with its F2 / F3: the organizer-issued Kiln account (team32). Energy is an estimate, never a measurement: 180 W (RNGD card TDP, furiosa.ai/rngd) × measured wall time. Tokens by flow, generation ids: docs/tokens-by-flow.md.</p>`,
    },
    {
      id: 'chain',
      title: 'Blockchain integration — read · write · settle',
      html: `<ul class="big-list"><li><b>Agent reads</b> the line: budget, per-payment cap, sellers, deadline, paused, spent.</li>
<li><b>Agent writes</b> <code>pay(seller, amount, fee, receiptHash)</code> — the receipt hash lands in the <code>Paid</code> / <code>SpendBlocked</code> event, 1 : 1.</li>
<li><b>Settles</b> inside <code>pay()</code>: test USDT (TRC20) moves vault → seller. Paid: ${f.paidTx.map(tx).join(' · ')}</li>
<li><b>Person writes</b> <code>grant()</code> ${tx(f.grantTx)} and <code>pause()</code> ${tx(f.stopTx)} with the owner key.</li></ul>
<p class="note">Vault <code>${esc(f.vault)}</code> on TRON Nile.</p>`,
    },
    {
      id: 'evidence',
      title: 'Approval & evidence — rebuilt from records alone',
      html: `<div class="split"><div><p class="num">${f.problems}<span> problems</span></p>
<p class="lead">${f.receipts} receipts · ${f.paid} paid inside · ${f.stopped} stopped · ${f.replays} replay stopped · ${f.paidUsdt} USDT paid</p>
<pre>npm run audit -- docs/receipts-nile-live.jsonl \\
  --vault ${esc(f.vault)}</pre>
<p class="note">No key, no .env. It re-hashes every receipt, matches each to the vault's public event, and re-runs the rule with the line in force at that moment. A dropped receipt leaves a vault event with no receipt → exit 1.</p></div>
<img src="../ui/audit-390.png" alt="Audit screen: problems, receipt by receipt"></div>`,
    },
    {
      id: 'new',
      title: "What's new",
      html: `<ul class="big-list tight"><li><b>Two witnesses per payment.</b> The receipt hash on TRON commits to the Kiln generation behind it; Kiln's own record (<code>GET /v1/generations/{id}</code>) is the second witness.${f.attest ? ` On the organizer's account ${f.attest.match} of ${f.attest.shown} calls match — model, tokens, cost — and every F1 call is dated ${f.attest.leadMin}–${f.attest.leadMax} s before its <code>pay()</code> (<code>npm run attest</code>).` : ''}</li>
<li><b>A stop is an event.</b> Refusals are recorded on-chain with the reason, so the history shows what the agent was <i>not</i> allowed to do.</li>
<li><b>Receipts are hash-chained and anchored.</b> Each receipt's hash is an argument of <code>pay()</code>; the vault decides each hash once.</li>
<li><b>The model phrases, the audit decides.</b> Kiln's words about a receipt are shown only if they repeat the audit's verdict and use only numbers from the record.</li></ul>`,
    },
    {
      id: 'value',
      title: 'Who pays · where it plugs in',
      html: `<ul class="big-list tight"><li><b>Plugs in</b> two ways: as an MCP server any agent host can add (<code>npm run mcp</code>: <code>spendline_line</code> · <code>spendline_pay</code> · <code>spendline_check</code>${f.mcp ? ` — live with Qwen3-32B on Kiln as the host, ${f.mcp.runs} runs, ${f.mcp.attempts} pay attempts` : ''}), or as a drop-in <code>spendlineWallet(…)</code> with the same <code>transfer(to, amount, memo)</code> call. The person keeps the owner key; the agent key can only ask.</li>
<li><b>The lead's week</b>: grant a line → the agent spends → <code>npm run statement</code> writes the statement and a CSV for the accountant${f.kept ? ` (${f.kept.usdt} USDT kept in the vault by ${f.kept.stops} stops)` : ''} → <code>npm run tune -- next.json</code> shows what next week's line would have done to this week's requests.</li>
${f.cost ? `<li><b>One guarded decision, measured</b> (TRON Nile): Kiln F1 $${f.cost.f1Usd} + <code>pay()</code> ${f.cost.paidTrx} TRX when paid, ${f.cost.stopTrx} TRX when stopped (median).</li>` : ''}
<li><b>Who needs it</b>: teams that let agents buy compute, credits and API time. Business (hypothesis, not validated): vault and audit open (Apache-2.0); a hosted audit with alerts on stops is the paid layer.</li>
<li><b>Why TRON · USDT</b>: an agent's budget is money people already hold as a stablecoin, settled as a plain TRC20 transfer inside <code>pay()</code>.</li></ul>`,
    },
    {
      id: 'limits',
      title: 'Check it yourself · not done, stated',
      html: `<pre class="cmd">npm install
npm run audit -- docs/receipts-nile-live.jsonl --vault ${esc(f.vault)}
npm run attest -- --saved   # Kiln's own record vs the receipts
npm run statement  # the week's statement + CSV
npm run ui         # Grant · Feed · Receipt · Audit</pre>
<ul class="big-list tight"><li>Testnet only (TRON Nile, test USDT), as the brief asks · one line per vault — a new grant replaces the old one (the audit replays every grant).</li>
<li>Signing is on the person's machine (CLI), never in the browser · energy is an estimate from wall time — Kiln exposes no power telemetry.</li>
<li>Parts were built before the event window; the README lists every commit, before and during.</li></ul>
<p class="kicker">${f.tests} tests · every model call on live Kiln · every stop on-chain — Spendline, a payment that can prove it was allowed.</p>`,
    },
  ];
}

const CSS = `@page{size:1280px 720px;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo',sans-serif;color:#191f28}
.slide{width:1280px;height:720px;padding:56px 72px;position:relative;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;gap:18px}
.slide:last-child{page-break-after:auto}.slide h2{font-size:40px;margin:0 0 6px;letter-spacing:-.5px}.slide h1{font-size:88px;margin:0;color:#3182f6;letter-spacing:-2px}
.kicker{color:#4e5968;font-size:20px;margin:0}.lead{font-size:26px;line-height:1.45;margin:0}.declared{font-size:20px;line-height:1.55;color:#4e5968;border-left:4px solid #3182f6;padding-left:18px;margin:12px 0 0}
.big-list{font-size:25px;line-height:1.45;margin:0;padding-left:26px;display:flex;flex-direction:column;gap:14px}.big-list.tight{font-size:21px;line-height:1.4;gap:10px}
.note{font-size:18px;color:#4e5968;line-height:1.5;margin:auto 0 0}.num{font-size:64px;font-weight:800;color:#3182f6;margin:0;letter-spacing:-1px}.num span{font-size:26px;color:#191f28;font-weight:600;letter-spacing:0}
.split{display:grid;grid-template-columns:1fr 300px;gap:40px;align-items:start;flex:1;min-height:0;overflow:hidden}.split img{width:300px;height:500px;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.12);object-fit:cover;object-position:top}
.ev{font-size:22px;line-height:1.5;padding-left:22px;margin:10px 0}.r{font:600 14px ui-monospace,Menlo,monospace;background:#ffeef0;color:#d22030;border-radius:8px;padding:2px 8px}
code{font:16px ui-monospace,Menlo,monospace;background:#f2f4f6;border-radius:6px;padding:1px 6px}pre{font:18px/1.5 ui-monospace,Menlo,monospace;background:#191f28;color:#f2f4f6;border-radius:16px;padding:18px 22px;margin:8px 0;white-space:pre-wrap}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.stats>div{background:#f2f4f6;border-radius:16px;padding:22px}.stats p{margin:0;font-size:20px;line-height:1.4}.stats p.num{font-size:56px;line-height:1.1;margin-bottom:8px}.stats small{color:#4e5968;font-size:16px}
.flow{display:flex;align-items:center;gap:10px;margin-top:24px}.box{flex:1;border-radius:16px;padding:20px 14px;font-size:21px;font-weight:700;text-align:center;background:#f2f4f6;min-height:150px;display:flex;flex-direction:column;justify-content:center}
.box small{font-weight:400;font-size:15px;color:#4e5968;line-height:1.4;margin-top:6px}.box.k{background:#e8f3ff}.box.v{background:#e8f7ee}.arrow{font-size:28px;color:#8b95a1}
.foot{position:absolute;right:40px;bottom:22px;font-size:14px;color:#8b95a1}`;

export function deckDocument(slides: Slide[]): string {
  const body = slides
    .map((s, i) => `<section class="slide" id="${s.id}">${s.id === 'title' ? '' : `<h2>${esc(s.title)}</h2>`}${s.html}<p class="foot">Spendline · ${i + 1} / ${slides.length}</p></section>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1280"><title>Spendline — deck</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

/** Visible text of a slide (for the number rule). */
export const slideText = (s: Slide) => `${s.title}\n${s.html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ')}`;
