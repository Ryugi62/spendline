// Composition root for the web UI (R1). Wires: session.json (public record) + browser SHA-256 → view models → HTML.
// The page holds no key and calls no signer; everything it shows is re-derived by audit() from receipts + chain events.
import { sha256Hex } from '../../adapters/sha256';
import { renderAudit, renderFeed, renderGrant, renderLoadError, renderReceipt, type Fmt, type GrantState } from '../../adapters/web/render';
import { parseReceiptsFile, ReceiptsFileError } from '../../application/auditRecords';
import { auditView, feedView, grantDraft, receiptView, type GrantField, type Session } from '../../application/views';
import { audit } from '../../domain/audit';

const app = document.getElementById('app')!;
const clock = new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
const fmt: Fmt = { time: (t) => `${clock.format(new Date(t * 1000))} KST` };
const nowS = () => Math.floor(Date.now() / 1000);

let session: Session | undefined;
let loadError = '';
let auditOverride: { source: string; receipts?: Session['receipts']; error?: string } | undefined;
const grant: GrantState = { step: 1, form: { budget: '', perTxCap: '', merchants: '', deadline: '' }, errors: {} };
const STEP_FIELDS: Record<1 | 2 | 3, GrantField[]> = { 1: ['budget', 'perTxCap'], 2: ['merchants'], 3: ['deadline'] };

async function load() {
  try {
    const res = await fetch('./session.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`session.json → HTTP ${res.status}`);
    session = (await res.json()) as Session;
    loadError = '';
  } catch (e) {
    loadError = (e as Error).message;
  }
  route();
}

function route() {
  const [, screen = 'feed', arg] = location.hash.split('/');
  window.scrollTo(0, 0);
  if (screen === 'grant') return show(renderGrant(grant, fmt));
  if (!session) return show(loadError ? renderLoadError(loadError) : app.innerHTML);
  if (screen === 'receipt') return show(renderReceipt(receiptView(session, Number(arg), sha256Hex), fmt));
  if (screen === 'audit') {
    const receipts = auditOverride?.receipts ?? session.receipts;
    const res = audit({ mandates: [], receipts, events: session.events, hash: sha256Hex });
    return show(renderAudit(auditView(res), fmt, { source: auditOverride?.source ?? `recorded run on vault ${session.vault}`, at: session.generatedAt, error: auditOverride?.error }));
  }
  show(renderFeed(feedView(session, sha256Hex, nowS()), fmt));
}

function show(html: string) {
  app.innerHTML = html;
}

function readGrantInputs() {
  for (const k of ['budget', 'perTxCap', 'merchants', 'deadline'] as const) {
    const el = document.getElementById(k) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) grant.form[k] = el.value;
  }
}

function nextGrantStep() {
  readGrantInputs();
  const deadline = grant.form.deadline ? Math.floor(new Date(grant.form.deadline).getTime() / 1000) : Number.NaN;
  const d = grantDraft({ ...grant.form, deadline }, nowS());
  if (grant.step < 4) {
    const mine = STEP_FIELDS[grant.step as 1 | 2 | 3];
    const errors = d.ok ? {} : Object.fromEntries(Object.entries(d.errors).filter(([k]) => mine.includes(k as GrantField)));
    grant.errors = errors;
    if (!Object.keys(errors).length) grant.step = (grant.step + 1) as GrantState['step'];
    if (grant.step === 4) grant.draft = d.ok ? d.mandate : undefined;
    if (grant.step === 4 && !d.ok) grant.step = 1; // an earlier answer went stale; start from the first wrong one
  }
  route();
  (document.querySelector('input, textarea') as HTMLElement | null)?.focus();
}

app.addEventListener('click', async (ev) => {
  const btn = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'next') nextGrantStep();
  if (action === 'back') {
    readGrantInputs();
    grant.step = Math.max(1, grant.step - 1) as GrantState['step'];
    grant.errors = {};
    route();
  }
  if (action === 'copy-mandate' && grant.draft) {
    await navigator.clipboard?.writeText(JSON.stringify(grant.draft, null, 1)).catch(() => undefined);
    btn.textContent = 'Copied — save as mandate.json, then npm run grant -- mandate.json';
  }
  if (action === 'stop') (document.getElementById('stop-sheet') as HTMLDialogElement | null)?.showModal();
  if (action === 'reload') load();
});

app.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT' && location.hash.startsWith('#/grant')) nextGrantStep();
  if ((ev.key === 'Enter' || ev.key === ' ') && (ev.target as HTMLElement).matches('label.cta')) document.getElementById('receipts-file')?.click();
});

app.addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  if (input.id !== 'receipts-file' || !input.files?.[0]) return;
  const file = input.files[0];
  try {
    auditOverride = { source: `your file ${file.name} against the recorded chain events`, receipts: parseReceiptsFile(await file.text()).receipts };
  } catch (e) {
    auditOverride = { source: `recorded run on vault ${session?.vault ?? ''}`, error: e instanceof ReceiptsFileError ? `That file isn't a receipts file — ${e.message}` : `Couldn't read that file — ${(e as Error).message}` };
  }
  route();
});

window.addEventListener('hashchange', route);
load();
