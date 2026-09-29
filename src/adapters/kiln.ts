import type { ChatMessage, ChatOptions, LlmPort, ToolCall } from '../application/ports';
import type { Flow, UsageRecord } from '../domain/tokenLedger';
import type { KilnGeneration } from '../domain/attest';

/**
 * Kiln (Bricksum) — OpenAI-compatible chat/completions on FuriosaAI NPUs.
 * Verified facts (docs 2026-09-24): no response_format; qwen3-32b tool calling auto only; `usage.cost` in USD;
 * `X-Neocloud-Generation-Id` header per metered response; 429 carries `x-ratelimit-reset` (requests/tokens) or nothing (concurrency).
 * Qwen3 thinking is switched per request with the official soft switch (`/no_think` or `/think` appended to the last user turn).
 */
export type KilnConfig = { apiKey: string; baseUrl?: string; model?: string; fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> };

export class KilnLlm implements LlmPort {
  readonly records: UsageRecord[] = [];
  private base: string;
  private model: string;
  private f: typeof fetch;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  constructor(private cfg: KilnConfig) {
    this.base = (cfg.baseUrl ?? 'https://api.bricksum.com/v1').replace(/\/$/, '');
    this.model = cfg.model ?? 'qwen3-32b';
    this.f = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? (() => performance.now());
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async chat(flow: Flow, messages: ChatMessage[], opts: ChatOptions = {}) {
    const msgs = messages.map((m) => ({ ...m }));
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (lastUser && opts.thinking !== undefined && !/\/(no_)?think\b/.test(lastUser.content)) lastUser.content += opts.thinking ? ' /think' : ' /no_think';
    const tools = opts.tools?.length ? { tools: opts.tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' } : {};
    const body = JSON.stringify({ model: this.model, messages: msgs, max_tokens: opts.maxTokens ?? 512, stream: false, ...tools });
    for (let attempt = 0; ; attempt++) {
      const t0 = this.now();
      const res = await this.f(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
        body,
      });
      const latencyMs = this.now() - t0;
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        await this.sleep(Number.isFinite(reset) && reset > 0 ? reset * 1000 : Math.min(2 ** attempt, 30) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`Kiln ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as {
        choices: { message: { content: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      const text = stripThink(j.choices?.[0]?.message?.content ?? '');
      const usage: UsageRecord = {
        flow,
        promptTokens: j.usage?.prompt_tokens ?? 0,
        completionTokens: j.usage?.completion_tokens ?? 0,
        costUsd: j.usage?.cost ?? 0,
        latencyMs: Math.round(latencyMs),
        generationId: res.headers.get('x-neocloud-generation-id') ?? '',
      };
      const server = Number(res.headers.get('x-envoy-upstream-service-time'));
      if (res.headers.has('x-envoy-upstream-service-time') && Number.isFinite(server)) usage.serverMs = server;
      this.records.push(usage);
      const calls: ToolCall[] = (j.choices?.[0]?.message?.tool_calls ?? []).flatMap((c) => (c.function?.name ? [{ name: c.function.name, arguments: c.function.arguments ?? '{}' }] : []));
      const out: { text: string; usage: UsageRecord; toolCall?: ToolCall; toolCalls?: ToolCall[] } = { text, usage };
      if (calls.length) out.toolCall = calls[0];
      if (calls.length > 1) out.toolCalls = calls;
      return out;
    }
  }
}

/** Qwen3 may emit an (empty) <think>…</think> block even with /no_think — never feed it to the parser. */
export const stripThink = (s: string): string => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

// AC-40 — Kiln's own record of a generation: GET /v1/generations/{id} (measured 2026-09-29: 200 with
// {id, model, total_cost, tokens_prompt, tokens_completion, cached_tokens, latency_ms, status_code, created_at}; unknown id → 404).

type RawGeneration = { id: string; model: string; total_cost: number; tokens_prompt: number; tokens_completion: number; latency_ms?: number; created_at: string; [k: string]: unknown };
export function parseKilnGeneration(j: RawGeneration): KilnGeneration {
  return {
    id: j.id, model: j.model, totalCost: j.total_cost, promptTokens: j.tokens_prompt, completionTokens: j.tokens_completion,
    createdAt: Date.parse(j.created_at) / 1000,
    ...(j.latency_ms !== undefined ? { latencyMs: j.latency_ms } : {}),
    ...(typeof j.cached_tokens === 'number' ? { cachedTokens: j.cached_tokens } : {}),
  };
}

export class KilnGenerations {
  private base: string;
  private f: typeof fetch;
  constructor(private cfg: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.base = (cfg.baseUrl ?? 'https://api.bricksum.com/v1').replace(/\/$/, '');
    this.f = cfg.fetchImpl ?? fetch;
  }
  /** Kiln's raw answer (kept verbatim for the saved file), or null when Kiln does not show this id. */
  async raw(id: string): Promise<RawGeneration | null> {
    const res = await this.f(`${this.base}/generations/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${this.cfg.apiKey}` } });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Kiln generations ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as RawGeneration;
  }
}
