/** Kiln/qwen3-32b has no response_format — ask for JSON in the prompt, then extract and validate here. */
export type Intent = { item: string; quantity: number; maxUnitPrice?: number; merchantHint?: string; note?: string };
export class IntentError extends Error {}

/**
 * Kiln 2026-09-28: with tools offered, qwen3-32b sometimes answers with the hermes-style call as plain content
 * (`{"name": "propose_purchase", "arguments": {...}}`) instead of `tool_calls`. Returns that call's arguments as JSON text.
 */
export function leakedToolCall(text: string, name: string): string | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const args = o.arguments;
    return o.name === name && args && typeof args === 'object' && !Array.isArray(args) ? JSON.stringify(args) : undefined;
  } catch {
    return undefined;
  }
}

export function parseIntent(text: string): Intent {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new IntentError('no JSON object in model output');
  let o: unknown;
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new IntentError('model output is not valid JSON');
  }
  const r = o as Record<string, unknown>;
  if (typeof r.item !== 'string' || !r.item.trim()) throw new IntentError('item missing');
  if (typeof r.quantity !== 'number' || !(r.quantity > 0)) throw new IntentError('quantity must be > 0');
  if (r.maxUnitPrice !== undefined && (typeof r.maxUnitPrice !== 'number' || !(r.maxUnitPrice > 0))) throw new IntentError('maxUnitPrice must be > 0');
  const out: Intent = { item: r.item, quantity: r.quantity };
  if (r.maxUnitPrice !== undefined) out.maxUnitPrice = r.maxUnitPrice as number;
  if (typeof r.merchantHint === 'string' && r.merchantHint.trim()) out.merchantHint = r.merchantHint.trim();
  if (typeof r.note === 'string') out.note = r.note;
  return out;
}
