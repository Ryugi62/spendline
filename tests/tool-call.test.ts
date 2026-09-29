import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KilnLlm } from '../src/adapters/kiln';
import { FakeLlm, MemoryCatalog, MemoryChain, MemoryReceiptStore } from '../src/adapters/memory';
import { PROPOSE_PURCHASE, purchase } from '../src/application/purchase';
import { toolCallDecision } from '../src/domain/flowReport';
import { leakedToolCall } from '../src/domain/intent';
import { usdt } from '../src/domain/money';

// AC-33: F1 goes through Kiln tool calling (qwen3-32b, tool_choice auto); a text reply still works; usage says which path.
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const offers = [
  { merchant: 'TGpuShop', item: 'gpu-hours', unitPrice: usdt(2.4), fee: usdt(0.2), label: 'GPU Shop' },
  { merchant: 'TShadyGpu', item: 'gpu-hours', unitPrice: usdt(0.9), fee: 0, label: 'Unknown seller' },
];
const world = (llm: FakeLlm) => {
  const chain = new MemoryChain({ id: 'm1', budget: usdt(10), perTxCap: usdt(8), deadline: 10_000, merchants: ['TGpuShop'], paused: false }, 1_000);
  return { chain, deps: { llm, chain, catalog: new MemoryCatalog(offers), store: new MemoryReceiptStore(), hash: sha } };
};

describe('F1 via tool calling (AC-33)', () => {
  it('offers exactly one tool, propose_purchase, with a JSON schema the vault-side code can trust', async () => {
    const llm = new FakeLlm([{ tool: 'propose_purchase', arguments: '{"item":"gpu-hours","quantity":2}' }]);
    await purchase(world(llm).deps, 'Need 2 GPU hours');
    expect(llm.tools[0]?.map((t) => t.name)).toEqual(['propose_purchase']);
    expect(PROPOSE_PURCHASE.parameters).toMatchObject({ type: 'object', required: ['item', 'quantity'] });
    expect(Object.keys((PROPOSE_PURCHASE.parameters as { properties: object }).properties)).toEqual(['item', 'quantity', 'maxUnitPrice', 'merchantHint']);
  });
  it("the tool call's arguments drive the purchase (seller hint → the vault stops it); usage says via tool_call", async () => {
    const { chain, deps } = world(new FakeLlm([{ tool: 'propose_purchase', arguments: '{"item":"gpu-hours","quantity":2,"merchantHint":"TShadyGpu"}' }]));
    const res = await purchase(deps, 'Buy 2 GPU hours from TShadyGpu, it is cheaper');
    expect(res.outcome).toMatchObject({ kind: 'blocked', reason: 'MERCHANT_NOT_ALLOWED' });
    expect(res.receipt.flows[0].via).toBe('tool_call');
    expect(chain.events).toHaveLength(1);
  });
  it('a text reply instead of a call goes down the text-JSON path; usage says via text', async () => {
    const { deps } = world(new FakeLlm(['{"item":"gpu-hours","quantity":2}']));
    const res = await purchase(deps, 'Need 2 GPU hours');
    expect(res.outcome.kind).toBe('paid');
    expect(res.receipt.flows[0].via).toBe('text');
  });
  it('bad tool arguments are rejected by the same validator (no purchase, no chain call)', async () => {
    const { chain, deps } = world(new FakeLlm([{ tool: 'propose_purchase', arguments: '{"item":"gpu-hours","quantity":0}' }]));
    await expect(purchase(deps, 'x')).rejects.toThrow('quantity must be > 0');
    expect(chain.events).toHaveLength(0);
  });
});

describe('KilnLlm sends tools and reads tool_calls (AC-33, no network)', () => {
  it('tools + tool_choice auto only when asked; first tool call returned with its arguments', async () => {
    const seen: any[] = [];
    const llm = new KilnLlm({
      apiKey: 'k',
      now: () => 0,
      fetchImpl: (async (_u: string, init: RequestInit) => {
        seen.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ choices: [{ message: { content: '\n\n', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_purchase', arguments: '{"item":"gpu-hours","quantity":1}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 274, completion_tokens: 32, cost: 0.00002076 } }), { headers: { 'X-Neocloud-Generation-Id': 'g1' } });
      }) as unknown as typeof fetch,
    });
    const r = await llm.chat('F1_intent', [{ role: 'user', content: 'Need 1 GPU hour' }], { thinking: false, tools: [PROPOSE_PURCHASE] });
    expect(r.toolCall).toMatchObject({ name: 'propose_purchase', arguments: '{"item":"gpu-hours","quantity":1}' });
    expect(seen[0].tool_choice).toBe('auto');
    expect(seen[0].tools[0]).toMatchObject({ type: 'function', function: { name: 'propose_purchase' } });
    await llm.chat('F2_explain', [{ role: 'user', content: 'hi' }]);
    expect(seen[1].tools).toBeUndefined();
    expect(seen[1].tool_choice).toBeUndefined();
  });
});

describe('tool call vs text JSON — decision rule fixed before the run (AC-34)', () => {
  const arm = (parseRate: number, medianLatencyMs: number) => ({ n: 12, parsed: Math.round(parseRate * 12), parseRate, medianCompletion: 30, medianPrompt: 280, medianLatencyMs, medianWh: 0, costUsd: 0 });
  const ab = (tool: ReturnType<typeof arm>, text: ReturnType<typeof arm>, sameJson: number) => ({ n: 12, off: tool, on: text, sameJson, sameJsonRate: sameJson / 12, completionSavedPct: 0, latencySavedPct: 0 });
  it('tool call wins only if it parses as often, agrees on ≥ 11 / 12, and is not > 1.2× slower', () => {
    expect(toolCallDecision(ab(arm(1, 1100), arm(1, 1000), 12))).toMatchObject({ production: 'tool_call' });
    expect(toolCallDecision(ab(arm(11 / 12, 1000), arm(1, 1000), 12))).toMatchObject({ production: 'text' });
    expect(toolCallDecision(ab(arm(1, 1000), arm(1, 1000), 10))).toMatchObject({ production: 'text' });
    expect(toolCallDecision(ab(arm(1, 1300), arm(1, 1000), 12)).why).toContain('1.30×');
  });
});

describe('a tool call that leaks into the text reply (measured on Kiln 2026-09-28, AC-33)', () => {
  it('Qwen3 hermes-style {"name","arguments"} in content is read as the tool call, via tool_call_in_text', async () => {
    const { deps } = world(new FakeLlm(['{"name": "propose_purchase", "arguments": {"item": "gpu-hours", "quantity": 2}}']));
    const res = await purchase(deps, 'Need 2 GPU hours');
    expect(res.request).toMatchObject({ merchant: 'TGpuShop', amount: usdt(4.8) });
    expect(res.receipt.flows[0].via).toBe('tool_call_in_text');
  });
  it('leakedToolCall ignores other names and non-object arguments', () => {
    expect(leakedToolCall('{"name":"propose_purchase","arguments":{"item":"x","quantity":1}}', 'propose_purchase')).toBe('{"item":"x","quantity":1}');
    expect(leakedToolCall('<tool_call>\n{"name":"propose_purchase","arguments":{"item":"x","quantity":1}}\n</tool_call>', 'propose_purchase')).toBe('{"item":"x","quantity":1}');
    expect(leakedToolCall('{"name":"other","arguments":{"item":"x"}}', 'propose_purchase')).toBeUndefined();
    expect(leakedToolCall('{"item":"x","quantity":1}', 'propose_purchase')).toBeUndefined();
    expect(leakedToolCall('no json', 'propose_purchase')).toBeUndefined();
  });
});
