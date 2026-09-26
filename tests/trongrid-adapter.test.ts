import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TronGridEvents } from '../src/adapters/trongrid';

/** Contract test against payloads measured on Nile 2026-09-26 (public events of the v0.1 vault, 2 pages of 3). */
const fixture = JSON.parse(readFileSync('tests/fixtures/trongrid-events-2026-09-26.json', 'utf8')) as { pages: unknown[] };

describe('TronGridEvents (AC-14) — keyless, no network in tests', () => {
  it('follows meta.fingerprint and decodes grant / paid / blocked / paused as measured', async () => {
    const urls: string[] = [];
    const seenHeaders: HeadersInit[] = [];
    let i = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      seenHeaders.push(init?.headers ?? {});
      return new Response(JSON.stringify(fixture.pages[i++]), { status: 200 });
    }) as unknown as typeof fetch;
    const ev = await new TronGridEvents({ host: 'https://nile.trongrid.io', fetchImpl, pageSize: 3 }).events('TNw1jzJ8NXHmhvwNhLRjLTiBzosu3GXAqF');

    expect(urls).toHaveLength(2);
    expect(urls[1]).toMatch(/fingerprint=/);
    expect(JSON.stringify(seenHeaders)).not.toMatch(/key|authorization/i);
    expect(ev.map((e) => e.kind)).toEqual(['granted', 'paid', 'blocked', 'blocked', 'paused', 'blocked']);

    const g = ev[0];
    if (g.kind !== 'granted') throw new Error('first event must be the grant');
    expect(g.mandate).toEqual({
      id: '0x1a13ae1a67e6e5e953416c741814132e509a83c2dc80804b7d5a126281f162aa',
      budget: 9_900_000,
      perTxCap: 8_000_000,
      deadline: 1_790_233_632,
      merchants: ['THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56', expect.stringMatching(/^T[1-9A-HJ-NP-Za-km-z]{33}$/)],
      paused: false,
    });
    expect(g.at).toBe(1_790_230_035);

    const paid = ev[1];
    expect(paid).toMatchObject({ kind: 'paid', receiptHash: 'a3979caaf684ed2e4ea4b257e4cf409c9382d3c1c0394326a869e0985fa2496b', merchant: 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56', amount: 4_800_000, fee: 200_000, at: 1_790_230_041 });
    expect(ev.filter((e) => e.kind === 'blocked').map((e) => (e.kind === 'blocked' ? e.reason : ''))).toEqual(['MERCHANT_NOT_ALLOWED', 'OVER_BUDGET_WITH_FEES', 'PAUSED']);
  });

  it('a non-200 answer is an error, not an empty history', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 503 })) as unknown as typeof fetch;
    await expect(new TronGridEvents({ fetchImpl, retries: 0 }).events('TVault')).rejects.toThrow(/503/);
  });
});
