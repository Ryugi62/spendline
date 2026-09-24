import { describe, expect, it } from 'vitest';
import { KilnLlm, stripThink } from '../src/adapters/kiln';

function fakeFetch(responses: { status: number; body?: unknown; headers?: Record<string, string> }[], seen: unknown[] = []) {
  let i = 0;
  return (async (_url: string, init: RequestInit) => {
    seen.push(JSON.parse(String(init.body)));
    const r = responses[i++];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
}

describe('KilnLlm adapter (contract test, no network)', () => {
  it('records usage, cost and generation id; appends /no_think; strips <think>', async () => {
    const seen: any[] = [];
    let t = 0;
    const llm = new KilnLlm({
      apiKey: 'sk-bk-test',
      now: () => (t += 250),
      fetchImpl: fakeFetch([{ status: 200, headers: { 'X-Neocloud-Generation-Id': 'gen-1' }, body: { choices: [{ message: { content: '<think>\n\n</think>\n{"item":"x","quantity":1}' } }], usage: { prompt_tokens: 50, completion_tokens: 12, cost: 0.0000074 } } }], seen),
    });
    const r = await llm.chat('F1_intent', [{ role: 'user', content: 'buy x' }], { thinking: false });
    expect(r.text).toBe('{"item":"x","quantity":1}');
    expect(r.usage).toMatchObject({ flow: 'F1_intent', promptTokens: 50, completionTokens: 12, costUsd: 0.0000074, generationId: 'gen-1', latencyMs: 250 });
    expect(seen[0].messages[0].content).toBe('buy x /no_think');
    expect(seen[0].model).toBe('qwen3-32b');
  });
  it('retries 429 using x-ratelimit-reset, not a guess', async () => {
    const waits: number[] = [];
    const llm = new KilnLlm({
      apiKey: 'k',
      sleep: async (ms) => void waits.push(ms),
      fetchImpl: fakeFetch([{ status: 429, headers: { 'x-ratelimit-reset': '3' } }, { status: 200, body: { choices: [{ message: { content: 'ok' } }], usage: {} } }]),
    });
    const r = await llm.chat('F2_explain', [{ role: 'user', content: 'hi' }]);
    expect(r.text).toBe('ok');
    expect(waits).toEqual([3000]);
  });
  it('stripThink removes reasoning blocks', () => {
    expect(stripThink('<think>a\nb</think> hello')).toBe('hello');
  });
});
