/** Kiln/qwen3-32b has no response_format — ask for JSON in the prompt, then extract and validate here. */
export type Intent = { item: string; quantity: number; maxUnitPrice?: number; merchantHint?: string; note?: string };
export class IntentError extends Error {}

/**
 * Kiln 2026-09-28: with tools offered, qwen3-32b sometimes answers with the hermes-style call as plain content
 * (`{"name": "propose_purchase", "arguments": {...}}`) instead of `tool_calls`. Returns that call's arguments as JSON text.
 */
export function leakedToolCall(text: string, name: string): string | undefined {
  // live 2026-09-29 (MCP host run 1): the call can also come back as `name({...})` in the text
  const called = text.match(new RegExp(`\\b${name}\\s*\\(\\s*(\\{[\\s\\S]*\\})\\s*\\)`));
  if (called) {
    try {
      const args = JSON.parse(called[1]) as unknown;
      if (args && typeof args === 'object' && !Array.isArray(args)) return JSON.stringify(args);
    } catch { /* fall through to the hermes form */ }
  }
  for (const candidate of [wholeSpan(text), ...balancedObjects(text)]) {
    if (!candidate) continue;
    try {
      const o = JSON.parse(candidate) as Record<string, unknown>;
      const args = o.arguments;
      if (o.name === name && args && typeof args === 'object' && !Array.isArray(args)) return JSON.stringify(args);
    } catch { /* next candidate */ }
  }
  return undefined;
}

const wholeSpan = (text: string): string | undefined => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start < 0 || end <= start ? undefined : text.slice(start, end + 1);
};

/** Top-level `{...}` spans with balanced braces (strings and escapes respected) — live run 2 ended a call with stray `"}`. */
export function balancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0 && --depth === 0) out.push(text.slice(start, i + 1));
  }
  return out;
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

/**
 * AC-39: the seller a request names by its catalog name (the label before " — "), whole words, any case.
 * Exactly one distinct seller named → its address; none or several → undefined (code then picks as before).
 */
export function sellerNamedIn(text: string, sellers: { merchant: string; label: string }[]): string | undefined {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new Set(
    sellers
      .filter((s) => {
        const name = s.label.split(' — ')[0].trim();
        return name.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${esc(name)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
      })
      .map((s) => s.merchant),
  );
  return named.size === 1 ? [...named][0] : undefined;
}
