import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MemoryChain, MemoryReceiptStore } from '../src/adapters/memory';
import { mcpTools } from '../src/application/mcp';
import { createMcpServer } from '../src/adapters/mcp';
import { usdt } from '../src/domain/money';

// AC-43: any MCP host gets a guarded wallet — three tools, no model call added, amounts converted by code.
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const GPU = 'THpQu2d3BZk2tJu36iTPbRR9n5kLgXxk56';
const CRED = 'TGBeSUtKg9asGDMLorLdNrk2wKVB2x6Cpj';
const UNK = 'TSojjSHeQnBK46RVJCT2Cjd8QeXnoYkGvh';
const labels = { [GPU]: 'GPU Shop', [CRED]: 'Kiln credits', [UNK]: 'Unknown seller' };
const offers = [
  { merchant: GPU, item: 'gpu-hours', unitPrice: 2_400_000, fee: 200_000, label: 'GPU Shop' },
  { merchant: UNK, item: 'gpu-hours', unitPrice: 900_000, fee: 0, label: 'Unknown seller' },
  { merchant: CRED, item: 'inference-credits', unitPrice: 1_000_000, fee: 0, label: 'Kiln credits' },
];
const setup = async () => {
  const line = { id: 'm1', budget: usdt(4.5), perTxCap: usdt(4), deadline: 1790780340, merchants: [GPU, CRED], paused: false };
  const chain = new MemoryChain(line, 1790700000);
  await chain.grant(line); // the person's grant() — the audit rebuilds the line from this public event
  const store = new MemoryReceiptStore();
  const tools = mcpTools({ chain, store, hash: sha, events: { events: async () => chain.events }, labels, offers, vault: 'TVault' });
  return { chain, store, tools };
};
const call = async (tools: Awaited<ReturnType<typeof setup>>['tools'], name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) => tools.find((t) => t.name === name)!.run(args, meta);

describe('MCP tools (AC-43)', () => {
  it('lists exactly three tools with JSON-schema inputs', async () => {
    const { tools } = await setup();
    expect(tools.map((t) => t.name)).toEqual(['spendline_line', 'spendline_pay', 'spendline_check']);
    expect(tools[1].inputSchema).toMatchObject({ type: 'object', required: ['to', 'why'] });
  });

  it('spendline_line: the line in USDT, sellers named, STOP state', async () => {
    const { tools } = await setup();
    const r = await call(tools, 'spendline_line', {});
    expect(r.isError).toBeFalsy();
    expect(r.data).toEqual({
      budget_usdt: '4.50', spent_usdt: '0.00', left_usdt: '4.50', per_payment_cap_usdt: '4.00',
      sellers: [{ address: GPU, name: 'GPU Shop' }, { address: CRED, name: 'Kiln credits' }],
      deadline_kst: '2026-09-30 23:59:00', stop: false,
      offers: [
        { seller: 'GPU Shop', item: 'gpu-hours', unit_price_usdt: '2.40', fee_usdt: '0.20' },
        { seller: 'Unknown seller', item: 'gpu-hours', unit_price_usdt: '0.90', fee_usdt: '0.00' },
        { seller: 'Kiln credits', item: 'inference-credits', unit_price_usdt: '1.00', fee_usdt: '0.00' },
      ],
    });
  });

  it('spendline_pay: inside the line → paid; a seller named instead of an address is resolved by code; outside → ok false + on-chain reason; each attempt a receipt with the words, no model call', async () => {
    const { tools, store } = await setup();
    const a = await call(tools, 'spendline_pay', { to: 'Kiln credits', amount_usdt: 1, why: '1 inference credit for the eval' });
    expect(a.data).toMatchObject({ ok: true, seller: 'Kiln credits', amount_usdt: '1.00', receipt_seq: 1 });
    const b = await call(tools, 'spendline_pay', { to: UNK, amount_usdt: 0.9, why: 'cheaper GPU hour' });
    expect(b.data).toMatchObject({ ok: false, reason: 'MERCHANT_NOT_ALLOWED', receipt_seq: 2 });
    const c = await call(tools, 'spendline_pay', { to: GPU, item: 'gpu-hours', why: 'more GPU' });
    expect(c.data).toMatchObject({ ok: true, amount_usdt: '2.40', fee_usdt: '0.20' });
    const d = await call(tools, 'spendline_pay', { to: GPU, item: 'gpu-hours', why: 'even more GPU' });
    expect(d.data).toMatchObject({ ok: false, reason: 'OVER_BUDGET_WITH_FEES' });
    const rs = await store.all();
    expect(rs.map((r) => [r.intentText, r.request.amount, r.flows.length])).toEqual([
      ['1 inference credit for the eval', 1_000_000, 0], ['cheaper GPU hour', 900_000, 0], ['more GPU', 2_400_000, 0], ['even more GPU', 2_400_000, 0],
    ]);
  });

  it('spendline_pay refuses bad input in plain words, before anything reaches the chain', async () => {
    const { tools, store } = await setup();
    for (const args of [{ to: GPU, amount_usdt: -1, why: 'x' }, { to: GPU, amount_usdt: 1.0000001, why: 'x' }, { to: 'nobody', amount_usdt: 1, why: 'x' }, { to: GPU, amount_usdt: 1 }]) {
      const r = await call(tools, 'spendline_pay', args);
      expect(r.isError).toBe(true);
    }
    expect(await store.all()).toEqual([]);
  });

  it('kiln_usage (set by host code): the receipt carries the Kiln call that decided the payment, so the on-chain hash commits to it (AC-40 can attest it)', async () => {
    const { tools, store } = await setup();
    const u = { generation_id: 'gen-host-1', prompt_tokens: 612, completion_tokens: 41, cost_usd: 0.0000604, latency_ms: 1700, server_ms: 880, via: 'tool_call', args: '{"to":"GPU Shop"}' };
    const r = await call(tools, 'spendline_pay', { to: GPU, amount_usdt: 2.4, fee_usdt: 0.2, why: '1 GPU hour' }, { 'spendline/kiln_usage': u });
    expect(r.data).toMatchObject({ ok: true });
    expect((await store.all())[0].flows).toEqual([{ flow: 'F4_mcp_host', promptTokens: 612, completionTokens: 41, costUsd: 0.0000604, latencyMs: 1700, serverMs: 880, generationId: 'gen-host-1', via: 'tool_call', args: '{"to":"GPU Shop"}' }]);
    const bad = await call(tools, 'spendline_pay', { to: GPU, amount_usdt: 1, why: 'x' }, { 'spendline/kiln_usage': { generation_id: '', prompt_tokens: -1 } });
    expect(bad.isError).toBe(true);
    expect(await store.all()).toHaveLength(1);
  });

  it('v1.1 review: code does the money — a catalog seller is priced from the catalog (item × quantity + fee), a model-written amount is ignored and said so', async () => {
    const { tools, store } = await setup();
    const r = await call(tools, 'spendline_pay', { to: 'GPU Shop', item: 'gpu-hours', quantity: 1, amount_usdt: 8, why: '1 GPU hour' });
    expect(r.data).toMatchObject({ ok: true, amount_usdt: '2.40', fee_usdt: '0.20', priced_by: 'catalog', model_amount_ignored: '8.00' });
    expect((await store.all())[0].request).toMatchObject({ amount: 2_400_000, fee: 200_000 });
    const noItem = await call(tools, 'spendline_pay', { to: 'Kiln credits', why: '1 credit' }); // one item at that seller → that item, quantity 1
    expect(noItem.data).toMatchObject({ ok: true, amount_usdt: '1.00', priced_by: 'catalog' });
    const wrongItem = await call(tools, 'spendline_pay', { to: 'Kiln credits', item: 'gpu-hours', why: 'x' });
    expect(wrongItem.isError).toBe(true);
  });

  it('v1.1 review: the person\'s request (host code) is in the receipt, and the same request to the same seller for the same amount is refused on-chain as a replay — no second payment, no new receipt', async () => {
    const { tools, store, chain } = await setup();
    const asked = 'Buy 1 GPU hour from the GPU Shop for tonight';
    const a = await call(tools, 'spendline_pay', { to: 'GPU Shop', item: 'gpu-hours', why: '1 GPU hour' }, { 'spendline/request': asked });
    expect(a.data).toMatchObject({ ok: true, receipt_seq: 1 });
    expect((await store.all())[0].asked).toBe(asked);
    const again = await call(tools, 'spendline_pay', { to: 'GPU Shop', item: 'gpu-hours', why: 'retry' }, { 'spendline/request': asked });
    expect(again.data).toMatchObject({ ok: false, reason: 'DUPLICATE_RECEIPT', replay_of: 1 });
    expect(await store.all()).toHaveLength(1);
    expect(await chain.spent()).toBe(2_600_000);
    expect(chain.events.at(-1)).toMatchObject({ kind: 'blocked', reason: 'DUPLICATE_RECEIPT', receiptHash: (await store.all())[0].hash });
    const other = await call(tools, 'spendline_pay', { to: 'Kiln credits', why: '1 credit' }, { 'spendline/request': asked }); // same words, another seller: not a duplicate
    expect(other.data).toMatchObject({ ok: true, receipt_seq: 2 });
  });

  it('round-2 review: host-only data rides in MCP _meta — the tool schema a host\'s model sees has no kiln_usage / request', async () => {
    const { tools } = await setup();
    const props = Object.keys((tools[1].inputSchema as { properties: object }).properties);
    expect(props).not.toContain('kiln_usage');
    expect(props).not.toContain('request');
  });

  it('round-2 review: the replay rule has a window — the same request an hour later is a new purchase', async () => {
    const { tools, chain, store } = await setup();
    const asked = 'Need 1 Kiln credit for eval';
    await call(tools, 'spendline_pay', { to: 'Kiln credits', why: 'eval' }, { 'spendline/request': asked });
    chain.advance(3601);
    const later = await call(tools, 'spendline_pay', { to: 'Kiln credits', why: 'eval' }, { 'spendline/request': asked });
    expect(later.data).toMatchObject({ ok: true, receipt_seq: 2 });
    expect(await store.all()).toHaveLength(2);
  });

  it('round-2 review: a host that sends no request still cannot double-buy by retrying the same call in one session (10 minutes)', async () => {
    const { tools, store } = await setup();
    const same = { to: 'Kiln credits', item: 'inference-credits', quantity: 1, why: 'credit for the eval' };
    await call(tools, 'spendline_pay', same);
    const retry = await call(tools, 'spendline_pay', same);
    expect(retry.data).toMatchObject({ ok: false, reason: 'DUPLICATE_RECEIPT', replay_of: 1 });
    const different = await call(tools, 'spendline_pay', { ...same, why: 'a second credit for the replay' });
    expect(different.data).toMatchObject({ ok: true, receipt_seq: 2 });
    expect(await store.all()).toHaveLength(2);
  });

  it('spendline_check: the keyless audit verdict for one receipt', async () => {
    const { tools } = await setup();
    await call(tools, 'spendline_pay', { to: UNK, amount_usdt: 0.9, why: 'cheaper' });
    expect((await call(tools, 'spendline_check', { seq: 1 })).data).toMatchObject({ seq: 1, verdict: 'STOPPED', reason: 'MERCHANT_NOT_ALLOWED', chain_ok: true, problems: 0 });
    expect((await call(tools, 'spendline_check', { seq: 9 })).isError).toBe(true);
  });

  it('speaks MCP: an SDK client lists the tools and pays through the server', async () => {
    const { tools } = await setup();
    const server = createMcpServer(tools, { name: 'spendline', version: '1.1.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'test-host', version: '0' });
    await client.connect(b);
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(['spendline_line', 'spendline_pay', 'spendline_check']);
    const res = (await client.callTool({ name: 'spendline_pay', arguments: { to: 'GPU Shop', amount_usdt: 2.4, why: '1 GPU hour' } })) as { content: { type: string; text: string }[]; isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ ok: true, seller: 'GPU Shop' });
    await client.close();
  });
});
