import type { Decision, SpendRequest } from '../domain/mandate';
import { leakedToolCall, parseIntent } from '../domain/intent';
import { usdt } from '../domain/money';
import type { Hasher, Receipt } from '../domain/receipt';
import { guardedPay } from './plugIn';
import type { CatalogPort, ChainPort, LlmPort, PayOutcome, ReceiptStore, ToolSpec } from './ports';

/** `f1`: how F1 asks Kiln (AC-33/34) — a `propose_purchase` tool call (default, chosen by docs/ab-tool-call-*.json) or JSON in the text reply. */
export type PurchaseDeps = { llm: LlmPort; chain: ChainPort; catalog: CatalogPort; store: ReceiptStore; hash: Hasher; f1?: 'tool_call' | 'text' };
export type PurchaseResult = { request: SpendRequest; preview: Decision; receipt: Receipt; outcome: PayOutcome };

export const INTENT_SYSTEM = [
  'You turn a purchase request into JSON. Reply with ONE JSON object and nothing else.',
  'Keys: item (one of: gpu-hours, inference-credits, dataset), quantity (number > 0),',
  'maxUnitPrice (USDT, optional), merchantHint (TRON address if the request names a seller, optional), note (short, optional).',
  '/no_think',
].join('\n');

/** AC-33: the one tool F1 offers. The model fills it; code validates it (parseIntent), picks the offer and does the money math. */
export const PROPOSE_PURCHASE: ToolSpec = {
  name: 'propose_purchase',
  description: 'Propose one purchase from the request. Code prices it and the vault decides whether it is paid.',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', enum: ['gpu-hours', 'inference-credits', 'dataset'] },
      quantity: { type: 'number', description: 'units, > 0' },
      maxUnitPrice: { type: 'number', description: 'USDT per unit — only if the request states a price cap' },
      merchantHint: { type: 'string', description: 'TRON address — only if the request names a seller' },
    },
    required: ['item', 'quantity'],
  },
};
export const TOOL_SYSTEM = [
  'Call propose_purchase once for the request.',
  'Fill maxUnitPrice only if the request states a price cap, and merchantHint only if it names a seller address.',
  'If you cannot call it, reply with the same fields as ONE JSON object and nothing else.',
].join('\n');

/** Where the intent JSON is: the tool call, a tool call leaked into the text, or the text itself. */
export function f1Arguments(r: { text: string; toolCall?: { name: string; arguments: string } }): { args: string; via: 'tool_call' | 'tool_call_in_text' | 'text' } {
  if (r.toolCall?.name === PROPOSE_PURCHASE.name) return { args: r.toolCall.arguments, via: 'tool_call' };
  const leaked = leakedToolCall(r.text, PROPOSE_PURCHASE.name);
  return leaked ? { args: leaked, via: 'tool_call_in_text' } : { args: r.text, via: 'text' };
}

/** UC-2. The LLM only reads language (F1). Offer choice and money math stay in code. The vault is always called, so stops are on-chain. */
export async function purchase(d: PurchaseDeps, requestText: string): Promise<PurchaseResult> {
  const viaTool = (d.f1 ?? 'tool_call') === 'tool_call';
  const r = await d.llm.chat('F1_intent', [
    { role: 'system', content: viaTool ? TOOL_SYSTEM : INTENT_SYSTEM },
    { role: 'user', content: requestText },
  ], viaTool ? { maxTokens: 200, thinking: false, tools: [PROPOSE_PURCHASE] } : { maxTokens: 200, thinking: false });
  const { args, via } = f1Arguments(r);
  const intent = parseIntent(args);
  const usage = { ...r.usage, via };

  const [mandate, offers] = await Promise.all([d.chain.mandate(), d.catalog.offers(intent.item)]);
  const affordable = offers.filter((o) => intent.maxUnitPrice === undefined || o.unitPrice <= usdt(intent.maxUnitPrice));
  const pick =
    (intent.merchantHint && offers.find((o) => o.merchant === intent.merchantHint)) ||
    [...affordable].filter((o) => mandate.merchants.includes(o.merchant)).sort((a, b) => a.unitPrice + a.fee - (b.unitPrice + b.fee))[0] ||
    affordable[0] ||
    offers[0];
  if (!pick) throw new Error(`no offer for ${intent.item}`);

  return guardedPay(d, { merchant: pick.merchant, amount: pick.unitPrice * intent.quantity, fee: pick.fee, why: requestText, flows: [usage] });
}
