// AC-44 — an MCP host whose planner is Qwen3-32B on Kiln. The model reads the request and picks Spendline's tools one at a time;
// the host code (not the model) attaches the Kiln call's usage to each spendline_pay, so the receipt — and its on-chain hash —
// commits to the model call that decided the payment (AC-40 attests it against Kiln's own record).
import { balancedObjects, leakedToolCall } from '../domain/intent';
import type { UsageRecord } from '../domain/tokenLedger';
import type { ChatMessage, LlmPort, ToolSpec } from './ports';

export type McpClientPort = {
  list(): Promise<{ name: string; description?: string; inputSchema: Record<string, unknown> }[]>;
  /** `meta` travels as the MCP request's `_meta` — host-code data the model never sees */
  call(name: string, args: Record<string, unknown>, meta?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
};
export type HostStep = { tool: string; args: Record<string, unknown>; via: 'tool_call' | 'tool_call_in_text'; generationId: string; text: string; isError: boolean };
export type HostRun = { request: string; steps: HostStep[]; answer: string; calls: UsageRecord[] };

export const HOST_SYSTEM = [
  'You are the purchasing agent of a three-person AI team. You can pay only through the spendline tools.',
  'Call one tool at a time. For a seller in the offers below give the item and quantity — the code prices it; never compute amounts.',
  'Handle every item the request asks for, even one you expect to be refused: the vault decides, not you.',
  'When every item is handled, answer in one short sentence per item: paid, or stopped and the reason the tool returned.',
].join('\n');
const HOST_ONLY = ['kiln_usage', 'request']; // older servers listed these in the schema; never let the model fill them

function withoutHostOnly(schema: Record<string, unknown>): Record<string, unknown> {
  const props = { ...((schema.properties as Record<string, unknown>) ?? {}) };
  for (const k of HOST_ONLY) delete props[k];
  return { ...schema, properties: props };
}

type Picked = { name: string; argsText: string; via: HostStep['via']; id?: string };
function picks(r: { text: string; toolCall?: { name: string; arguments: string; id?: string }; toolCalls?: { name: string; arguments: string; id?: string }[] }, names: string[]): Picked[] {
  const proper = (r.toolCalls ?? (r.toolCall ? [r.toolCall] : [])).filter((c) => names.includes(c.name));
  if (proper.length) return proper.map((c) => ({ name: c.name, argsText: c.arguments, via: 'tool_call' as const, ...(c.id ? { id: c.id } : {}) }));
  // every call written into the text (hermes JSON blocks, <tool_call> tags or name({...})), in order — round-2 review: not just the first
  const found: Picked[] = [];
  for (const block of balancedObjects(r.text)) for (const n of names) { const a = leakedToolCall(block, n); if (a) found.push({ name: n, argsText: a, via: 'tool_call_in_text' }); }
  if (found.length) return found;
  for (const n of names) {
    const leaked = leakedToolCall(r.text, n);
    if (leaked) return [{ name: n, argsText: leaked, via: 'tool_call_in_text' }];
  }
  return [];
}

export async function runHost(d: { llm: LlmPort; mcp: McpClientPort; maxSteps?: number }, request: string): Promise<HostRun> {
  const max = d.maxSteps ?? 8;
  const listed = await d.mcp.list();
  const tools: ToolSpec[] = listed.map((t) => ({ name: t.name, description: t.description ?? '', parameters: withoutHostOnly(t.inputSchema) }));
  const names = listed.map((t) => t.name);
  // the host code reads the line once (no model call) so the model knows the sellers and items without spending a turn on it
  const line = names.includes('spendline_line') ? (await d.mcp.call('spendline_line', {})).text : '';
  const messages: ChatMessage[] = [{ role: 'system', content: HOST_SYSTEM + (line ? `\nThe line and the offers (read by the host): ${line}` : '') }, { role: 'user', content: request }];
  const steps: HostStep[] = [];
  const calls: UsageRecord[] = [];
  const seenItems = new Map<string, number>(); // identical pay calls within this request: occurrence 0, 1, …
  for (;;) {
    if (steps.length >= max) return { request, steps, answer: `(stopped after ${max} tool calls)`, calls };
    const r = await d.llm.chat('F4_mcp_host', messages, { tools, thinking: false, maxTokens: 300 });
    const picked = picks(r, names);
    const usage: UsageRecord = picked.length ? { ...r.usage, via: picked[0].via } : r.usage;
    calls.push(usage);
    if (!picked.length) return { request, steps, answer: r.text.trim(), calls };
    const native = picked.every((p) => p.id);
    if (native) messages.push({ role: 'assistant', content: r.text ?? '', tool_calls: picked.map((p) => ({ id: p.id!, type: 'function' as const, function: { name: p.name, arguments: p.argsText } })) });
    for (const p of picked) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(p.argsText) as Record<string, unknown>; } catch { /* the tool refuses empty input in plain words */ }
      for (const k of HOST_ONLY) delete args[k];
      const item = `${String(args.to ?? '').toLowerCase()}|${String(args.item ?? '')}|${String(args.quantity ?? 1)}`;
      const occurrence = seenItems.get(item) ?? 0;
      if (p.name === 'spendline_pay') seenItems.set(item, occurrence + 1);
      const meta = p.name === 'spendline_pay'
        ? { 'spendline/request': request, 'spendline/occurrence': occurrence, 'spendline/kiln_usage': { generation_id: usage.generationId, prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cost_usd: usage.costUsd, latency_ms: usage.latencyMs, ...(usage.serverMs !== undefined ? { server_ms: usage.serverMs } : {}), via: p.via, args: p.argsText } }
        : undefined;
      const res = await d.mcp.call(p.name, args, meta);
      steps.push({ tool: p.name, args, via: p.via, generationId: usage.generationId, text: res.text, isError: res.isError });
      if (native) messages.push({ role: 'tool', tool_call_id: p.id!, content: res.text });
      else messages.push({ role: 'assistant', content: JSON.stringify({ name: p.name, arguments: args }) }, { role: 'user', content: `Result of ${p.name}: ${res.text}` });
    }
  }
}
