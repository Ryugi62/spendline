import { describe, expect, it } from 'vitest';
import { MemoryChain } from '../src/adapters/memory';
import { renderFeed, renderGrant } from '../src/adapters/web/render';
import { formatOwnerResult, grantLine, mandateIdOf, parseMandateJson, stopAgent } from '../src/application/owner';
import { feedView, grantDraft } from '../src/application/views';
import { usdt } from '../src/domain/money';
import { GPU, sha, threeReceipts } from './answers-fixture';

const now = 1_000;
const fmt = { time: (t: number) => `t${t}` };

describe('AC-28 the person signs grant and STOP on their machine (M0-14)', () => {
  it('the JSON the Grant screen copies is exactly what `npm run grant -- mandate.json` reads', () => {
    const d = grantDraft({ budget: '9.9', perTxCap: '8', merchants: GPU, deadline: 5_000 }, now);
    if (!d.ok) throw new Error('fixture');
    const copied = JSON.stringify(d.mandate, null, 1); // web main.ts: copy-mandate
    expect(parseMandateJson(copied, now)).toEqual({ ok: true, draft: d.mandate });
  });

  it('refuses a bad file in plain words, one line per problem', () => {
    expect(parseMandateJson('{budget:', now)).toEqual({ ok: false, errors: ["mandate.json isn't valid JSON"] });
    const bad = parseMandateJson(JSON.stringify({ budget: 0, perTxCap: usdt(20), merchants: ['0xabc'], deadline: 10, paused: false }), now);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join('\n')).toMatch(/budget above 0/);
    expect(bad.errors.join('\n')).toMatch(/“0xabc” doesn't look like a TRON address/);
    expect(bad.errors.join('\n')).toMatch(/deadline is not in the future/);
    const cap = parseMandateJson(JSON.stringify({ budget: usdt(5), perTxCap: usdt(6), merchants: [GPU], deadline: 5_000 }), now);
    expect(cap.ok ? [] : cap.errors).toEqual(["The per-payment cap can't be bigger than the budget"]);
    const frac = parseMandateJson(JSON.stringify({ budget: 9.9, perTxCap: 8, merchants: [GPU], deadline: 5_000 }), now);
    expect(frac.ok ? [] : frac.errors.join('\n')).toMatch(/whole micro-USDT/);
  });

  it('mandate id is bytes32 hex, derived from the line and the moment it is granted', () => {
    const d = { budget: usdt(9.9), perTxCap: usdt(8), merchants: [GPU], deadline: 5_000, paused: false };
    expect(mandateIdOf(d, now, sha)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(mandateIdOf(d, now, sha)).toBe(mandateIdOf(d, now, sha));
    expect(mandateIdOf(d, now + 1, sha)).not.toBe(mandateIdOf(d, now, sha));
  });

  it('grant → MandateGranted with that id and spent reset; stop → Paused, after which pay() is stopped PAUSED', async () => {
    const chain = new MemoryChain({ id: '0xold', budget: 1, perTxCap: 1, deadline: 1, merchants: [], paused: true }, now);
    const draft = { budget: usdt(9.9), perTxCap: usdt(8), merchants: [GPU], deadline: 5_000, paused: false };
    const g = await grantLine(chain, draft, now, sha);
    expect(chain.events.at(-1)).toMatchObject({ kind: 'granted', txHash: g.txHash, mandate: { id: g.mandate.id, budget: usdt(9.9), paused: false } });
    expect(formatOwnerResult('grant', g.txHash, g.mandate)).toMatch(/^granted · mandate 0x[0-9a-f]{64} · 9\.90 USDT · cap 8\.00 · 1 seller · deadline 1970-01-01 01:23 UTC\ntx grant-\d+ · https:\/\/nile\.tronscan\.org\/#\/transaction\/grant-\d+$/);
    expect((await chain.pay({ merchant: GPU, amount: usdt(1), fee: 0, receiptHash: 'a' })).kind).toBe('paid');
    const stopTx = await stopAgent(chain);
    expect(formatOwnerResult('stop', stopTx)).toMatch(/^STOP signed · the vault refuses every payment until a new grant\ntx pause-\d+ ·/);
    expect(await chain.pay({ merchant: GPU, amount: usdt(1), fee: 0, receiptHash: 'b' })).toMatchObject({ kind: 'blocked', reason: 'PAUSED' });
  });

  it('the UI names the commands: Grant step 4 → `npm run grant -- mandate.json`, STOP sheet → `npm run stop`; no "not wired" copy left', async () => {
    const g4 = renderGrant({ step: 4, form: { budget: '9.9', perTxCap: '8', merchants: GPU, deadline: '' }, errors: {}, draft: { budget: usdt(9.9), perTxCap: usdt(8), merchants: [GPU], deadline: 2_000, paused: false } }, fmt);
    expect(g4).toContain('npm run grant -- mandate.json');
    const rec = await threeReceipts();
    const feed = renderFeed(feedView({ vault: 'TV', network: 'nile', ...rec, generatedAt: 0 }, sha, 1_500), fmt);
    expect(feed).toContain('npm run stop');
    expect(feed).not.toMatch(/isn't wired to a signer/);
  });
});
