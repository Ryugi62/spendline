export type Flow = 'F1_intent' | 'F2_explain' | 'F3_dispute';

/** One Kiln call, straight from the response `usage` + `X-Neocloud-Generation-Id` header + measured wall time. */
export type UsageRecord = {
  flow: Flow;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  generationId: string;
  /** F1 only (AC-33): the intent came from a Kiln tool call, a tool call leaked into the text, or JSON in the text reply */
  via?: 'tool_call' | 'tool_call_in_text' | 'text';
  /** Kiln's `x-envoy-upstream-service-time` (ms): time spent behind Kiln's edge — excludes the network, still ≥ NPU busy time */
  serverMs?: number;
};

/** Scripted test double (FakeLlm) marks its usage with this generation-id prefix. It is never a Kiln call. */
export const STAND_IN_PREFIX = 'fake-';
/** A Kiln call is usage that carries a real `X-Neocloud-Generation-Id` (Kiln sends one per metered response). */
export const isKilnCall = (u: UsageRecord): boolean => u.generationId !== '' && !u.generationId.startsWith(STAND_IN_PREFIX);

export type FlowTotals = { calls: number; promptTokens: number; completionTokens: number; costUsd: number; latencyMs: number };
const zero = (): FlowTotals => ({ calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0 });

export function summarize(records: UsageRecord[]): { byFlow: Record<string, FlowTotals>; total: FlowTotals } {
  const byFlow: Record<string, FlowTotals> = {};
  const total = zero();
  for (const r of records) {
    const f = (byFlow[r.flow] ??= zero());
    for (const t of [f, total]) {
      t.calls += 1;
      t.promptTokens += r.promptTokens;
      t.completionTokens += r.completionTokens;
      t.costUsd += r.costUsd;
      t.latencyMs += r.latencyMs;
    }
  }
  return { byFlow, total };
}
