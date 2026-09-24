import type { SpendRequest } from './mandate';
import type { UsageRecord } from './tokenLedger';

export type Hasher = (s: string) => string;
export const GENESIS = '0'.repeat(64);

/** What is known before the chain answers: the request, the words that produced it, and what the thinking cost. */
export type ReceiptBody = {
  seq: number;
  mandateId: string;
  request: SpendRequest;
  intentText: string;
  flows: UsageRecord[];
};
export type Receipt = ReceiptBody & { prevHash: string; hash: string };

/** Canonical JSON (sorted keys) so a verifier in any language gets the same bytes. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function sealReceipt(prevHash: string, body: ReceiptBody, hash: Hasher): Receipt {
  return { ...body, prevHash, hash: hash(prevHash + canonical(body)) };
}

export function bodyOf(r: Receipt): ReceiptBody {
  const { prevHash: _p, hash: _h, ...body } = r;
  return body;
}
