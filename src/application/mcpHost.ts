// AC-44 — an MCP host whose planner is Qwen3-32B on Kiln. The model reads the request and picks Spendline's tools one at a time;
// the host code (not the model) attaches the Kiln call's usage to each spendline_pay, so the receipt — and its on-chain hash —
// commits to the model call that decided the payment (AC-40 attests it against Kiln's own record).
import { leakedToolCall } from '../domain/intent';
import type { UsageRecord } from '../domain/tokenLedger';
import type { ChatMessage, LlmPort, ToolSpec } from './ports';

export type McpClientPort = {
  list(): Promise<{ name: string; description?: string; inputSchema: Record<string, unknown> }[]>;
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
};
export type HostStep = { tool: string; args: Record<string, unknown>; via: 'tool_call' | 'tool_call_in_text'; generationId: string; text: string; isError: boolean };
export type HostRun = { request: string; steps: HostStep[]; answer: string; calls: UsageRecord[] };

export const HOST_SYSTEM = [
  'You are the purchasing agent of a three-person AI team. You can pay only through the spendline tools.',
  'Call one tool at a time. Use the seller names and prices given in the request; amounts are USDT.',
  'Handle every item the request asks for, even one you expect to be refused: the vault decides, not you.',
  'When every item is handled, answer in one short sentence per item: paid, or stopped and the reason the tool returned.',
].join('\n');
const HOST_ONLY = 'kiln_usage';

function withoutHostOnly(schema: Record<string, unknown>): Record<string, unknown> {
  const props = { ...((schema.properties as Record<string, unknown>) ?? {}) };
  delete props[HOST_ONLY];
  return { ...schema, properties: props };
}

export async function runHost(d: { llm: LlmPort; mcp: McpClientPort; maxSteps?: number }, request: string): Promise<HostRun> {
  const max = d.maxSteps ?? 8;
  const listed = await d.mcp.list();
  const tools: ToolSpec[] = listed.map((t) => ({ name: t.name, description: t.description ?? '', parameters: withoutHostOnly(t.inputSchema) }));
  const names = listed.map((t) => t.name);
  const messages: ChatMessage[] = [{ role: 'system', content: HOST_SYSTEM }, { role: 'user', content: request }];
  const steps: HostStep[] = [];
  const calls: UsageRecord[] = [];
  for (;;) {
    if (steps.length >= max) return { request, steps, answer: `(stopped after ${max} tool calls)`, calls };
    const r = await d.llm.chat('F1_intent', messages, { tools, thinking: false, maxTokens: 300 });
    let picked: { name: string; argsText: string; via: HostStep['via'] } | undefined;
    if (r.toolCall && names.includes(r.toolCall.name)) picked = { name: r.toolCall.name, argsText: r.toolCall.arguments, via: 'tool_call' };
    else for (const n of names) {
      const leaked = leakedToolCall(r.text, n);
      if (leaked) { picked = { name: n, argsText: leaked, via: 'tool_call_in_text' }; break; }
    }
    const usage: UsageRecord = picked ? { ...r.usage, via: picked.via } : r.usage;
    calls.push(usage);
    if (!picked) return { request, steps, answer: r.text.trim(), calls };
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(picked.argsText) as Record<string, unknown>; } catch { /* the tool refuses empty input in plain words */ }
    delete args[HOST_ONLY];
    const sent = picked.name === 'spendline_pay'
      ? { ...args, [HOST_ONLY]: { generation_id: usage.generationId, prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_usd: usage.costUsd, latency_ms: usage.latencyMs, via: picked.via } }
      : args;
    const res = await d.mcp.call(picked.name, sent);
    steps.push({ tool: picked.name, args, via: picked.via, generationId: usage.generationId, text: res.text, isError: res.isError });
    messages.push({ role: 'assistant', content: JSON.stringify({ name: picked.name, arguments: args }) }, { role: 'user', content: `Result of ${picked.name}: ${res.text}` });
  }
}
