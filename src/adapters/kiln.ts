import type { ChatMessage, ChatOptions, LlmPort } from '../application/ports';
import type { Flow, UsageRecord } from '../domain/tokenLedger';

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
    const body = JSON.stringify({ model: this.model, messages: msgs, max_tokens: opts.maxTokens ?? 512, stream: false });
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
        choices: { message: { content: string | null } }[];
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
      this.records.push(usage);
      return { text, usage };
    }
  }
}

/** Qwen3 may emit an (empty) <think>…</think> block even with /no_think — never feed it to the parser. */
export const stripThink = (s: string): string => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
