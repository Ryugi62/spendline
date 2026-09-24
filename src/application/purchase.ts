import { evaluate, type Decision, type SpendRequest } from '../domain/mandate';
import { parseIntent } from '../domain/intent';
import { usdt } from '../domain/money';
import { GENESIS, sealReceipt, type Hasher, type Receipt } from '../domain/receipt';
import type { CatalogPort, ChainPort, LlmPort, PayOutcome, ReceiptStore } from './ports';

export type PurchaseDeps = { llm: LlmPort; chain: ChainPort; catalog: CatalogPort; store: ReceiptStore; hash: Hasher };
export type PurchaseResult = { request: SpendRequest; preview: Decision; receipt: Receipt; outcome: PayOutcome };

export const INTENT_SYSTEM = [
  'You turn a purchase request into JSON. Reply with ONE JSON object and nothing else.',
  'Keys: item (one of: gpu-hours, inference-credits, dataset), quantity (number > 0),',
  'maxUnitPrice (USDT, optional), merchantHint (TRON address if the request names a seller, optional), note (short, optional).',
  '/no_think',
].join('\n');

/** UC-2. The LLM only reads language (F1). Offer choice and money math stay in code. The vault is always called, so stops are on-chain. */
export async function purchase(d: PurchaseDeps, requestText: string): Promise<PurchaseResult> {
  const { text, usage } = await d.llm.chat('F1_intent', [
    { role: 'system', content: INTENT_SYSTEM },
    { role: 'user', content: requestText },
  ], { maxTokens: 200, thinking: false });
  const intent = parseIntent(text);

  const [mandate, spent, at, offers] = await Promise.all([d.chain.mandate(), d.chain.spent(), d.chain.now(), d.catalog.offers(intent.item)]);
  const affordable = offers.filter((o) => intent.maxUnitPrice === undefined || o.unitPrice <= usdt(intent.maxUnitPrice));
  const pick =
    (intent.merchantHint && offers.find((o) => o.merchant === intent.merchantHint)) ||
    [...affordable].filter((o) => mandate.merchants.includes(o.merchant)).sort((a, b) => a.unitPrice + a.fee - (b.unitPrice + b.fee))[0] ||
    affordable[0] ||
    offers[0];
  if (!pick) throw new Error(`no offer for ${intent.item}`);

  const request: SpendRequest = { merchant: pick.merchant, amount: pick.unitPrice * intent.quantity, fee: pick.fee, at };
  const preview = evaluate(mandate, spent, request);
  const prior = await d.store.all();
  const prev = prior.length ? prior[prior.length - 1] : undefined;
  const receipt = sealReceipt(prev?.hash ?? GENESIS, { seq: (prev?.seq ?? 0) + 1, mandateId: mandate.id, request, intentText: requestText, flows: [usage] }, d.hash);
  await d.store.append(receipt);
  const outcome = await d.chain.pay({ merchant: request.merchant, amount: request.amount, fee: request.fee, receiptHash: receipt.hash });
  return { request, preview, receipt, outcome };
}
