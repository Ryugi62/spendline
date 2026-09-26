import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderAudit, renderFeed, renderGrant, renderReceipt, renderLoadError, type Fmt } from '../src/adapters/web/render';
import { auditView, feedView, receiptView, type Session } from '../src/application/views';
import { audit, type ChainEvent } from '../src/domain/audit';
import type { Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';
import { GENESIS, sealReceipt } from '../src/domain/receipt';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const fmt: Fmt = { time: (t) => `t${t}` };
const GPU = 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56';
const m: Mandate = { id: '0xaa', budget: usdt(9.9), perTxCap: usdt(8), deadline: 1_000, merchants: [GPU], paused: false };
const r1 = sealReceipt(GENESIS, { seq: 1, mandateId: m.id, request: { merchant: GPU, amount: usdt(4.8), fee: usdt(0.2), at: 100 }, intentText: '<script>alert(1)</script> 2 GPU hours', flows: [] }, sha);
const events: ChainEvent[] = [
  { kind: 'granted', mandate: m, at: 50, txHash: 'g1' },
  { kind: 'paid', receiptHash: r1.hash, merchant: GPU, amount: usdt(4.8), fee: usdt(0.2), at: 100, txHash: 'tx1' },
];
const s: Session = { vault: 'TVault', network: 'nile', receipts: [r1], events, generatedAt: 300 };

const screens = {
  grant1: renderGrant({ step: 1, form: { budget: '', perTxCap: '', merchants: '', deadline: '' }, errors: {} }, fmt),
  grant4: renderGrant({ step: 4, form: { budget: '9.9', perTxCap: '8', merchants: GPU, deadline: '2026-09-27T21:00' }, errors: {}, draft: { budget: usdt(9.9), perTxCap: usdt(8), merchants: [GPU], deadline: 2_000, paused: false } }, fmt),
  feed: renderFeed(feedView(s, sha, 150), fmt),
  feedEmpty: renderFeed(feedView({ ...s, receipts: [] }, sha, 150), fmt),
  receipt: renderReceipt(receiptView(s, 1, sha), fmt),
  receiptMissing: renderReceipt(receiptView(s, 7, sha), fmt),
  audit: renderAudit(auditView(audit({ mandates: [], receipts: s.receipts, events, hash: sha })), fmt, { source: 'recorded Nile run' }),
  loadError: renderLoadError('404'),
};
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('rendered screens (AC-20)', () => {
  it('each screen has exactly one primary bottom CTA', () => {
    for (const [name, html] of Object.entries(screens)) expect([name, count(html, /class="cta[ "]/g)]).toEqual([name, 1]);
  });
  it('proofs are folded: every <details> starts closed', () => {
    for (const html of Object.values(screens)) expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(screens.receipt).toMatch(/<details/);
    expect(screens.audit).toMatch(/<details/);
  });
  it('the number comes before the verdict line', () => {
    for (const name of ['feed', 'receipt', 'audit', 'grant4'] as const) {
      const html = screens[name];
      expect([name, html.indexOf('class="big"') >= 0 && html.indexOf('class="big"') < html.indexOf('class="verdict')]).toEqual([name, true]);
    }
  });
  it('user words are escaped', () => {
    expect(screens.feed).not.toMatch(/<script>/);
    expect(screens.feed).toMatch(/&lt;script&gt;/);
    expect(screens.receipt).toMatch(/&lt;script&gt;/);
  });
  it('empty, missing and load-error states say what to do next', () => {
    expect(screens.feedEmpty).toMatch(/No payments yet/);
    expect(screens.receiptMissing).toMatch(/#7/);
    expect(screens.loadError).toMatch(/npm run ui:data/);
  });
  it('grant is a step form with ≤ 2 questions per step and a progress label', () => {
    expect(screens.grant1).toMatch(/Step 1 of 4/);
    expect(count(screens.grant1, /<(input|textarea)\b/g)).toBeLessThanOrEqual(2);
  });
});

describe('index.html and styles (AC-20, Toss checklist 1 · 3 · 5 · 10)', () => {
  const html = readFileSync('web/index.html', 'utf8');
  const css = readFileSync('web/styles.css', 'utf8');
  it('viewport meta, no external font / CDN', () => {
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1"/);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(css).not.toMatch(/@import|url\(\s*['"]?https?:/);
  });
  it('type scale, radius, fixed CTA height and brand colour are in the stylesheet', () => {
    expect(css).toMatch(/--title:\s*22px/);
    expect(css).toMatch(/--big:\s*(2[89]|3\d)px/);
    expect(css).toMatch(/--radius:\s*(1[6-9]|2\d)px/);
    expect(css).toMatch(/min-height:\s*(5[2-9]|6\d)px/);
    expect(css).toMatch(/#3182f6/i);
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
  });
});
