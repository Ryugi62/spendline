import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeLlm, MemoryChain, MemoryReceiptStore } from '../src/adapters/memory';
import { mcpTools } from '../src/application/mcp';
import { runHost } from '../src/application/mcpHost';
import { usdt } from '../src/domain/money';

// AC-44: an MCP host whose planner runs on Kiln — the model picks the tools, the host code adds the Kiln call's usage to each pay.
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

async function world() {
  const line = { id: 'm4', budget: usdt(9.9), perTxCap: usdt(8), deadline: 1790780340, merchants: [GPU, CRED], paused: false };
  const chain = new MemoryChain(line, 1790700000);
  await chain.grant(line);
  const store = new MemoryReceiptStore();
  const tools = mcpTools({ chain, store, hash: sha, events: { events: async () => chain.events }, labels, offers, vault: 'TVault' });
  const mcp = {
    list: async () => tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    call: async (name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) => { const r = await tools.find((t) => t.name === name)!.run(args, meta); return { text: r.text, isError: !!r.isError }; },
  };
  return { store, mcp };
}

describe('runHost (AC-44)', () => {
  it('follows tool calls (proper or leaked into text) until a plain answer; each pay carries the Kiln call that decided it', async () => {
    const { store, mcp } = await world();
    const llm = new FakeLlm([
      { tool: 'spendline_pay', arguments: JSON.stringify({ to: 'GPU Shop', amount_usdt: 2.4, fee_usdt: 0.2, why: '1 GPU hour for the eval' }) },
      `{"name": "spendline_pay", "arguments": {"to": "Unknown seller", "amount_usdt": 0.9, "why": "cheaper GPU hour"}}`,
      'Paid the GPU Shop 2.60 USDT; the Unknown seller was stopped on-chain (not on the list).',
    ]);
    const run = await runHost({ llm, mcp }, 'Buy 1 GPU hour from the GPU Shop, and one from the Unknown seller too.');
    expect(run.steps.map((s) => [s.tool, s.via, s.isError])).toEqual([['spendline_pay', 'tool_call', false], ['spendline_pay', 'tool_call_in_text', false]]);
    expect(run.answer).toContain('stopped on-chain');
    expect(run.calls).toHaveLength(3);
    const rs = await store.all();
    expect(rs.map((r) => [r.intentText, r.flows[0]?.generationId, r.flows[0]?.via])).toEqual([
      ['1 GPU hour for the eval', 'fake-1', 'tool_call'],
      ['cheaper GPU hour', 'fake-2', 'tool_call_in_text'],
    ]);
  });

  it('the model never sees kiln_usage (the host fills it); a model-written kiln_usage is replaced', async () => {
    const { store, mcp } = await world();
    const llm = new FakeLlm([
      { tool: 'spendline_pay', arguments: JSON.stringify({ to: 'Kiln credits', amount_usdt: 1, why: '1 credit', kiln_usage: { generation_id: 'made-up', prompt_tokens: 1, completion_tokens: 1, cost_usd: 0 } }) },
      'Done.',
    ]);
    await runHost({ llm, mcp }, 'One Kiln credit.');
    const offered = llm.tools[0].find((t) => t.name === 'spendline_pay')!;
    expect(Object.keys((offered.parameters as { properties: object }).properties)).not.toContain('kiln_usage');
    expect((await store.all())[0].flows[0].generationId).toBe('fake-1');
  });

  it('live 2026-09-29 run 1: a retry written as `name({...})` in the text is a tool call too, and the history is kept in the JSON call form', async () => {
    const { store, mcp } = await world();
    const llm = new FakeLlm([
      { tool: 'spendline_pay', arguments: JSON.stringify({ to: 'Kiln', amount_usdt: 1, why: '1 credit' }) },
      'spendline_pay({"amount_usdt":1,"fee_usdt":0,"to":"Kiln credits","why":"buy 1 Kiln inference credit for eval run"})',
      'Paid 1.00 USDT to Kiln credits.',
    ]);
    const run = await runHost({ llm, mcp }, 'One Kiln credit.');
    expect(run.steps.map((s) => [s.via, s.isError])).toEqual([['tool_call', true], ['tool_call_in_text', false]]);
    expect((await store.all()).map((r) => r.intentText)).toEqual(['buy 1 Kiln inference credit for eval run']);
    expect(llm.seen[1].find((m) => m.role === 'assistant')!.content).toBe('{"name":"spendline_pay","arguments":{"to":"Kiln","amount_usdt":1,"why":"1 credit"}}');
  });

  it('live 2026-09-29 run 2: a hermes call with trailing junk (`{...}}"}`) is still the call', async () => {
    const { store, mcp } = await world();
    const llm = new FakeLlm([
      '{"name":"spendline_pay","arguments":{"amount_usdt":0.9,"fee_usdt":0,"to":"Unknown seller","why":"1 GPU hour for eval run"}}"}',
      'The Unknown seller was stopped: not on the list.',
    ]);
    const run = await runHost({ llm, mcp }, 'One GPU hour from the Unknown seller.');
    expect(run.steps.map((s) => [s.tool, s.via])).toEqual([['spendline_pay', 'tool_call_in_text']]);
    expect(JSON.parse(run.steps[0].text)).toMatchObject({ ok: false, reason: 'MERCHANT_NOT_ALLOWED' });
    expect(await store.all()).toHaveLength(1);
  });

  it('the pay tool tells the model the seller names it may use', async () => {
    const { mcp } = await world();
    const pay = (await mcp.list()).find((t) => t.name === 'spendline_pay')!;
    expect(JSON.stringify(pay.inputSchema)).toContain('GPU Shop, Kiln credits, Unknown seller');
  });

  it('v1.1 review: the host reads the line (code, no model call) into the prompt, sends the person\'s words as `request`, the raw call arguments and flow F4 with each pay; several calls in one reply are all executed', async () => {
    const { store, mcp } = await world();
    const llm = new FakeLlm([
      { calls: [
        { tool: 'spendline_pay', arguments: '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"GPU hour"}' },
        { tool: 'spendline_pay', arguments: '{"to":"Kiln credits","item":"inference-credits","why":"credit"}' },
      ] },
      'Paid both.',
    ]);
    const request = 'Buy 1 GPU hour and 1 Kiln credit for the eval';
    const run = await runHost({ llm, mcp }, request);
    expect(llm.seen[0][0].content).toContain('"offers"');
    expect(run.steps.map((s) => s.tool)).toEqual(['spendline_pay', 'spendline_pay']);
    const rs = await store.all();
    expect(rs.map((r) => [r.asked, r.flows[0].flow, r.flows[0].args])).toEqual([
      [request, 'F4_mcp_host', '{"to":"GPU Shop","item":"gpu-hours","quantity":1,"why":"GPU hour"}'],
      [request, 'F4_mcp_host', '{"to":"Kiln credits","item":"inference-credits","why":"credit"}'],
    ]);
    expect(run.calls.map((c) => c.flow)).toEqual(['F4_mcp_host', 'F4_mcp_host']);
  });

  it('v1.1 review: running the same request twice buys once — the repeat is refused on-chain as a replay', async () => {
    const { store, mcp } = await world();
    const reply = () => ({ tool: 'spendline_pay', arguments: '{"to":"GPU Shop","item":"gpu-hours","why":"GPU hour"}' });
    const request = 'Buy 1 GPU hour from the GPU Shop';
    await runHost({ llm: new FakeLlm([reply(), 'done']), mcp }, request);
    const again = await runHost({ llm: new FakeLlm([reply(), 'done']), mcp }, request);
    expect(JSON.parse(again.steps[0].text)).toMatchObject({ ok: false, reason: 'DUPLICATE_RECEIPT', replay_of: 1 });
    expect(await store.all()).toHaveLength(1);
  });

  it('round-3 review: proper tool calls go back in the native protocol (assistant tool_calls + role:tool with the call id), and identical items carry their occurrence', async () => {
    const { store, mcp } = await world();
    const sent: Record<string, unknown>[] = [];
    const spy = { ...mcp, call: async (n: string, a: Record<string, unknown>, m?: Record<string, unknown>) => { if (m) sent.push(m); return mcp.call(n, a, m); } };
    const llm = new FakeLlm([
      { calls: [
        { tool: 'spendline_pay', arguments: '{"to":"Kiln credits","why":"eval"}', id: 'call_a' },
        { tool: 'spendline_pay', arguments: '{"to":"Kiln credits","why":"eval"}', id: 'call_b' },
      ] },
      'Paid twice.',
    ]);
    await runHost({ llm, mcp: spy }, 'One credit for the eval and another one for the replay');
    const second = llm.seen[1];
    expect(second.find((m) => m.role === 'assistant')).toMatchObject({ tool_calls: [{ id: 'call_a', type: 'function' }, { id: 'call_b', type: 'function' }] });
    expect(second.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['call_a', 'call_b']);
    expect(sent.map((m) => m['spendline/occurrence'])).toEqual([0, 1]);
    expect(await store.all()).toHaveLength(2);
  });

  it('stops after maxSteps tool calls and says so', async () => {
    const { mcp } = await world();
    const llm = new FakeLlm(Array.from({ length: 10 }, () => ({ tool: 'spendline_line', arguments: '{}' })));
    const run = await runHost({ llm, mcp, maxSteps: 3 }, 'Loop forever');
    expect(run.steps).toHaveLength(3);
    expect(run.answer).toBe('(stopped after 3 tool calls)');
  });
});
