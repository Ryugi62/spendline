import type { AuditView, FeedView, GrantField, QuestionRow, ReceiptView, RowStatus } from '../../application/views';
import { txUrl } from '../../application/views';
import type { Mandate } from '../../domain/mandate';
import { fmtUsdt } from '../../domain/money';

/**
 * Driving adapter: view models → HTML strings (no DOM here, so every screen is testable in node).
 * Toss rules applied: one question per step, number first, proofs folded, one fixed bottom CTA per screen.
 */
export type Fmt = { time: (unix: number) => string };
export type Tab = 'grant' | 'feed' | 'audit';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const CHIP: Record<RowStatus, string> = { paid: 'Paid', stopped: 'Stopped', problem: 'Check' };

function page(tab: Tab, body: string, cta: string): string {
  const t = (id: Tab, label: string) => `<a class="tab${id === tab ? ' on' : ''}" href="#/${id}"${id === tab ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="top"><a class="brand" href="#/feed">Spendline</a><nav class="tabs" aria-label="Screens">${t('grant', 'Grant')}${t('feed', 'Feed')}${t('audit', 'Audit')}</nav></header>
<main class="screen">${body}</main>
<div class="cta-bar">${cta}</div>`;
}

// ── Grant ───────────────────────────────────────────────────────────────────────
export type GrantState = {
  step: 1 | 2 | 3 | 4;
  form: { budget: string; perTxCap: string; merchants: string; deadline: string };
  errors: Partial<Record<GrantField, string>>;
  draft?: Omit<Mandate, 'id'>;
};

const field = (id: GrantField, label: string, input: string, err: string | undefined, hint = '') =>
  `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<p class="hint">${hint}</p>` : ''}${err ? `<p class="err" id="err-${id}">${esc(err)}</p>` : ''}</div>`;
const describedBy = (id: GrantField, err?: string) => (err ? ` aria-invalid="true" aria-describedby="err-${id}"` : '');

export function renderGrant(s: GrantState, fmt: Fmt): string {
  const { form: f, errors: e } = s;
  const progress = `<p class="step">Step ${s.step} of 4</p><div class="progress" aria-hidden="true"><span style="width:${s.step * 25}%"></span></div>`;
  const back = s.step > 1 ? `<button class="link" data-action="back" type="button">← Back</button>` : '';
  let body = '';
  if (s.step === 1)
    body = `<h1 class="title">How much can the agent spend?</h1>
${field('budget', 'Total budget (USDT)', `<input id="budget" name="budget" inputmode="decimal" autocomplete="off" placeholder="9.90" value="${esc(f.budget)}"${describedBy('budget', e.budget)}>`, e.budget)}
${field('perTxCap', 'Most in one payment, fees included', `<input id="perTxCap" name="perTxCap" inputmode="decimal" autocomplete="off" placeholder="8.00" value="${esc(f.perTxCap)}"${describedBy('perTxCap', e.perTxCap)}>`, e.perTxCap, 'Fees count too — the vault adds them before it says yes.')}`;
  if (s.step === 2)
    body = `<h1 class="title">Who can it pay?</h1>
${field('merchants', 'Seller addresses, one per line', `<textarea id="merchants" name="merchants" rows="4" spellcheck="false" placeholder="T… (TRON address)"${describedBy('merchants', e.merchants)}>${esc(f.merchants)}</textarea>`, e.merchants, 'Anyone not on this list is stopped, however cheap.')}`;
  if (s.step === 3)
    body = `<h1 class="title">Until when?</h1>
${field('deadline', 'Last moment a payment can go through', `<input id="deadline" name="deadline" type="datetime-local" value="${esc(f.deadline)}"${describedBy('deadline', e.deadline)}>`, e.deadline, 'After this, every payment is stopped — even one that was fine a minute before.')}`;
  if (s.step === 4 && s.draft) {
    const d = s.draft;
    const args = { budget: d.budget, perTxCap: d.perTxCap, deadline: d.deadline, merchants: d.merchants };
    body = `<section class="hero"><p class="label">Your line</p><p class="big">${fmtUsdt(d.budget)} <span class="unit">USDT</span></p>
<p class="verdict ok">Ready to sign on your machine</p></section>
<section class="card"><h2 class="section-title">The vault will stop</h2><ul class="stops">
<li>Any single payment over <b>${fmtUsdt(d.perTxCap)} USDT</b>, fees included</li>
<li>Anything that would pass <b>${fmtUsdt(d.budget)} USDT</b> in total, fees included</li>
<li>Any seller that is not ${d.merchants.length === 1 ? 'your <b>1</b> address' : `one of your <b>${d.merchants.length}</b> addresses`}</li>
<li>Everything after <b>${esc(fmt.time(d.deadline))}</b></li>
<li>Everything, the moment you press STOP</li></ul>
<p class="hint">Stops are written on-chain as events, so anyone can check them later.</p></section>
<p class="hint">Copy it, save it as <code>mandate.json</code>, and run <code>npm run grant -- mandate.json</code> — your owner key signs it on your machine.</p>
<details class="proof"><summary>What gets signed</summary><p class="hint">vault.grant(mandateId, budget, perTxCap, deadline, merchants) — amounts in micro-USDT. Your owner key signs it on your machine; this page never holds keys.</p><pre>${esc(JSON.stringify(args, null, 1))}</pre></details>`;
  }
  const cta = s.step < 4 ? `<button class="cta" data-action="next" type="button">Next</button>` : `<button class="cta" data-action="copy-mandate" type="button">Copy the mandate</button>`;
  return page('grant', `${progress}${back}${body}`, cta);
}

// ── Feed ────────────────────────────────────────────────────────────────────────
export function renderFeed(v: FeedView, fmt: Fmt): string {
  if (v.kind === 'empty')
    return page(
      'feed',
      `<div class="empty"><p class="title">No payments yet</p><p>When your agent tries to pay, every attempt shows up here — paid or stopped, with the reason.</p></div>`,
      `<a class="cta" href="#/grant">Grant a budget</a>`,
    );
  const pct = v.budget ? Math.min(100, Math.round((v.spent / v.budget) * 100)) : 0;
  const status =
    v.state === 'stopped'
      ? `<p class="verdict no">Stopped by you — nothing more can be paid</p>`
      : v.state === 'expired'
        ? `<p class="verdict warn">Window closed at ${esc(fmt.time(v.deadline))} — new payments are stopped</p>`
        : `<p class="verdict ok">Open until ${esc(fmt.time(v.deadline))} · ${fmtUsdt(v.left)} USDT left</p>`;
  const rows = v.rows
    .map(
      (r) => `<li><a class="row" href="#/receipt/${r.seq}"><span class="chip ${r.status}">${CHIP[r.status]}</span><span class="row-main"><span class="words">“${esc(r.words)}”</span>
<span class="meta">${fmtUsdt(r.amount + r.fee)} USDT · ${esc(r.reasonText)} · ${esc(fmt.time(r.at))}</span></span></a></li>`,
    )
    .join('');
  const problems = v.problems ? `<p class="banner warn">${v.problems} record${v.problems > 1 ? 's' : ''} don't add up — open Audit to see which.</p>` : '';
  const sheet = `<dialog class="sheet" id="stop-sheet" aria-labelledby="stop-title"><p class="title" id="stop-title">STOP is signed with your owner key</p>
<p>So it happens on your machine, never in this page: run <code>npm run stop</code> there. It signs <code>vault.pause()</code>, and from that block on every payment is stopped on-chain as PAUSED until you grant a new line.</p>
${v.lastStopTx ? `<p>A STOP pressed on this vault is on-chain as a public event: <a href="${txUrl(v.lastStopTx)}" target="_blank" rel="noopener">${short(v.lastStopTx)}</a>${v.stopTx ? '' : ' (before the current line was granted)'}.</p>` : '<p>No STOP has been pressed on this vault yet.</p>'}
<form method="dialog"><button class="sheet-btn" type="submit">Got it</button></form></dialog>`;
  return page(
    'feed',
    `<section class="hero"><p class="label">Spent from your line</p><p class="big">${fmtUsdt(v.spent)} <span class="unit">/ ${fmtUsdt(v.budget)} USDT</span></p>${status}
<div class="meter" aria-hidden="true"><span style="width:${pct}%"></span></div></section>${problems}
<section><h2 class="section-title">Every attempt</h2><ul class="rows">${rows}</ul></section>${sheet}`,
    `<button class="cta cta-stop" data-action="stop" type="button">STOP the agent</button>`,
  );
}

// ── Receipt ─────────────────────────────────────────────────────────────────────
export function renderReceipt(v: ReceiptView, fmt: Fmt): string {
  if (v.kind === 'missing')
    return page('feed', `<div class="empty"><p class="title">No receipt #${v.seq}</p><p>It isn't in this record. Go back to the feed and pick one.</p></div>`, `<a class="cta" href="#/feed">Back to the feed</a>`);
  const tone = v.status === 'paid' ? 'ok' : v.status === 'stopped' ? 'no' : 'warn';
  const cost = v.kilnCalls
    ? `${v.kilnCalls} Kiln call${v.kilnCalls > 1 ? 's' : ''} · ${v.tokens} tokens`
    : v.standInCalls
      ? 'scripted stand-in — no Kiln call (template test run)'
      : 'no model call recorded';
  const flows = v.flows.map((f) => `<li>${esc(f.flow)} · ${f.promptTokens}+${f.completionTokens} tokens · ${f.latencyMs} ms · $${f.costUsd} · <code>${esc(f.generationId || '-')}</code></li>`).join('');
  return page(
    'feed',
    `<a class="back" href="#/feed">← Feed</a>
<section class="hero"><p class="label">Receipt #${v.seq} · ${esc(fmt.time(v.at))}</p><p class="big">${fmtUsdt(v.total)} <span class="unit">USDT${v.status === 'paid' ? ' paid' : ', not paid'}</span></p><p class="verdict ${tone}">${esc(v.line)}</p></section>
${v.why ? `<section class="card why"><p class="label">Why — in Kiln · Qwen3-32B's words</p><p class="said">${esc(v.why)}</p><p class="hint">Shown because it repeats the audit's verdict and uses only numbers from the record.</p></section>` : ''}
<section class="card"><dl class="facts">
<div><dt>What was asked</dt><dd>“${esc(v.words)}”</dd></div>
<div><dt>Seller</dt><dd><code title="${esc(v.merchant)}">${esc(short(v.merchant))}</code></dd></div>
<div><dt>Amount</dt><dd>${fmtUsdt(v.amount)} + fee ${fmtUsdt(v.fee)} USDT</dd></div>
<div><dt>Thinking it cost</dt><dd>${esc(cost)}</dd></div>
</dl></section>
<details class="proof"><summary>Proof — hashes, tx and tokens</summary><dl class="facts mono">
<div><dt>Receipt hash</dt><dd>${esc(v.hash)}</dd></div><div><dt>Previous hash</dt><dd>${esc(v.prevHash)}</dd></div>
<div><dt>Mandate</dt><dd>${esc(v.mandateId)}</dd></div><div><dt>Transaction</dt><dd>${esc(v.txHash ?? 'none')}</dd></div></dl>
${flows ? `<ul class="flows">${flows}</ul>` : ''}<pre>${esc(v.json)}</pre></details>`,
    v.txUrl ? `<a class="cta" href="${v.txUrl}" target="_blank" rel="noopener">See it on Tronscan</a>` : `<a class="cta" href="#/feed">Back to the feed</a>`,
  );
}

// ── Audit ───────────────────────────────────────────────────────────────────────
const questionRow = (q: QuestionRow) =>
  `<li class="qa"><p class="q">“${esc(q.question)}”</p>${
    q.seq === null
      ? `<p class="verdict warn">No receipt matches</p>`
      : `<a class="row" href="#/receipt/${q.seq}"><span class="chip ${q.status}">${CHIP[q.status!]}</span><span class="row-main"><span class="words">#${q.seq} · ${esc(q.line!)}</span><span class="meta">${q.txHash ? `tx ${esc(short(q.txHash))}` : 'no on-chain event'} · verdict from the audit</span></span></a>`
  }<p class="said">${esc(q.answer)} <span class="hint">— Kiln · Qwen3-32B</span></p></li>`;

export function renderAudit(v: AuditView, fmt: Fmt, o: { source: string; at?: number; error?: string; questions?: QuestionRow[] }): string {
  const n = v.rows.length;
  const lost = v.orphans.length;
  const verdict = v.ok
    ? `<p class="verdict ok">All ${n} receipts check out</p>`
    : `<p class="verdict no">${lost ? `${lost} on-chain spend${lost > 1 ? 's' : ''} with no receipt${v.problems > lost ? ` · ${v.problems - lost} of ${n} receipts need a look` : ''}` : `${v.problems} of ${n} need a look`}</p>`;
  const rows = v.rows
    .map(
      (r) => `<li><a class="row" href="#/receipt/${r.seq}"><span class="chip ${r.status}">${CHIP[r.status]}</span><span class="row-main"><span class="words">#${r.seq} · ${esc(r.reasonText)}</span>
<span class="meta">${r.txHash ? `tx ${esc(short(r.txHash))}` : 'no on-chain event'}${r.status === 'problem' ? ` · ${esc(r.label)}` : ''}</span></span></a></li>`,
    )
    .join('');
  const orphans = v.orphans
    .map(
      (o) => `<li><a class="row" href="${txUrl(o.txHash)}" target="_blank" rel="noopener"><span class="chip problem">${CHIP.problem}</span><span class="row-main"><span class="words">${esc(o.reasonText)}</span>
<span class="meta">${o.kind} ${fmtUsdt(o.total)} USDT · tx ${esc(short(o.txHash))}</span></span></a></li>`,
    )
    .join('');
  const replays = (v.replays ?? [])
    .map(
      (x) => `<li><a class="row" href="${txUrl(x.txHash)}" target="_blank" rel="noopener"><span class="chip stopped">${CHIP.stopped}</span><span class="row-main"><span class="words">${esc(x.reasonText)}</span>
<span class="meta">${fmtUsdt(x.total)} USDT asked again · tx ${esc(short(x.txHash))}</span></span></a></li>`,
    )
    .join('');
  return page(
    'audit',
    `<section class="hero"><p class="label">Rebuilt from public records only</p><p class="big">${v.problems} <span class="unit">problem${v.problems === 1 ? '' : 's'}</span></p>${verdict}</section>
<p class="sub">${esc(v.chainLine)} · paid ${fmtUsdt(v.totalPaid)} USDT in total</p>
${o.error ? `<p class="banner no" role="alert">${esc(o.error)}</p>` : ''}
<section><h2 class="section-title">Receipt by receipt</h2><ul class="rows">${rows}${replays}${orphans}</ul></section>
${o.questions?.length ? `<section><h2 class="section-title">Questions a teammate asked</h2><ul class="rows qas">${o.questions.map(questionRow).join('')}</ul></section>` : ''}
<details class="proof"><summary>How this is checked</summary><ol class="how">
<li>Each receipt's hash is recomputed and must chain to the one before it.</li>
<li>Each receipt is matched, by that hash, to the vault's public event (paid or stopped).</li>
<li>The rule is re-run with the line in force at that moment — grants and STOPs included — and must agree with the chain.</li>
<li>Every paid or stopped event of the vault must belong to exactly one receipt — a spend with no receipt is a problem.</li></ol>
<p class="hint">Same check without this page, no key needed: <code>npm run audit -- docs/receipts-nile.jsonl --vault T…</code></p>
<p class="hint">Records: ${esc(o.source)}${o.at ? ` · fetched ${esc(fmt.time(o.at))}` : ''}</p></details>
<input type="file" id="receipts-file" accept=".jsonl,.json,application/json" hidden>`,
    `<label class="cta" for="receipts-file" role="button" tabindex="0">Check another receipts file</label>`,
  );
}

export function renderLoadError(detail: string): string {
  return page(
    'feed',
    `<div class="empty"><p class="title">We couldn't load the record</p><p>Run <code>npm run ui:data</code> to fetch it from the chain, then try again.</p><p class="hint">${esc(detail)}</p></div>`,
    `<button class="cta" data-action="reload" type="button">Try again</button>`,
  );
}
