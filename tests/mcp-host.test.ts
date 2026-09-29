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

async function world() {
  const line = { id: 'm4', budget: usdt(9.9), perTxCap: usdt(8), deadline: 1790780340, merchants: [GPU, CRED], paused: false };
  const chain = new MemoryChain(line, 1790700000);
  await chain.grant(line);
  const store = new MemoryReceiptStore();
  const tools = mcpTools({ chain, store, hash: sha, events: { events: async () => chain.events }, labels, vault: 'TVault' });
  const mcp = {
    list: async () => tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    call: async (name: string, args: Record<string, unknown>) => { const r = await tools.find((t) => t.name === name)!.run(args); return { text: r.text, isError: !!r.isError }; },
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

  it('stops after maxSteps tool calls and says so', async () => {
    const { mcp } = await world();
    const llm = new FakeLlm(Array.from({ length: 10 }, () => ({ tool: 'spendline_line', arguments: '{}' })));
    const run = await runHost({ llm, mcp, maxSteps: 3 }, 'Loop forever');
    expect(run.steps).toHaveLength(3);
    expect(run.answer).toBe('(stopped after 3 tool calls)');
  });
});
