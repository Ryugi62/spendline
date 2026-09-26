import { fmtUsdt } from '../domain/money';
import { usageLine } from './explain';
import type { PurchaseResult } from './purchase';
import { REASON_TEXT, txUrl } from './views';

/** What `npm run agent -- "<request>"` prints (M0-15): the vault's decision first, then money, proof, and what the thinking cost. */
export function formatPurchase(r: PurchaseResult, labels: Record<string, string> = {}): string {
  const q = r.request;
  const o = r.outcome;
  const seller = labels[q.merchant] ?? q.merchant;
  const verdict = o.kind === 'paid' ? 'PAID' : `STOPPED ${o.reason}`;
  const why = o.kind === 'paid' ? 'Paid inside your line' : REASON_TEXT[o.reason];
  const lines = [
    `#${r.receipt.seq} ${verdict} · ${fmtUsdt(q.amount + q.fee)} USDT to ${seller} (${fmtUsdt(q.amount)} + fee ${fmtUsdt(q.fee)}) · ${why}`,
    `tx ${o.txHash} · ${txUrl(o.txHash)}`,
  ];
  const previewKind = r.preview.kind === 'allow' ? 'paid' : `stopped ${r.preview.reason}`;
  const chainKind = o.kind === 'paid' ? 'paid' : `stopped ${o.reason}`;
  if (previewKind !== chainKind) lines.push(`note: the preview said ${previewKind}; the vault's decision is what counts`);
  lines.push(...r.receipt.flows.map(usageLine));
  return lines.join('\n');
}
