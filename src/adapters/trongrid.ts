import { TronWeb } from 'tronweb';
import type { EventSource } from '../application/ports';
import type { ChainEvent } from '../domain/audit';
import { reasonFromCode } from '../domain/mandate';

/**
 * Public vault events from TronGrid's REST API — no key, no signer, plain GET (anyone can repeat it).
 * Shapes measured on Nile 2026-09-26: bytes32 come WITHOUT 0x, addresses as 0x + 40 hex, and an address[] field
 * (MandateGranted.merchants) as ONE newline-joined string. Pages continue while `meta.fingerprint` is present.
 */
export type TronGridConfig = { host?: string; fetchImpl?: typeof fetch; pageSize?: number; retries?: number; sleep?: (ms: number) => Promise<void> };

type RawEvent = { event_name: string; block_timestamp: number; transaction_id: string; result: Record<string, string> };
type Page = { data?: RawEvent[]; meta?: { fingerprint?: string } };

const bytes32 = (h: string) => '0x' + h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const base58 = (hex: string) => TronWeb.address.fromHex(hex.trim());

export function decodeEvent(e: RawEvent): ChainEvent | undefined {
  const at = Math.floor(e.block_timestamp / 1000);
  const txHash = e.transaction_id;
  const r = e.result;
  switch (e.event_name) {
    case 'MandateGranted':
      return {
        kind: 'granted',
        at,
        txHash,
        mandate: {
          id: bytes32(r.mandateId),
          budget: Number(r.budget),
          perTxCap: Number(r.perTxCap),
          deadline: Number(r.deadline),
          merchants: String(r.merchants ?? '').split(/[\n,]/).filter((x) => x.trim()).map(base58),
          paused: false,
        },
      };
    case 'Paid':
    case 'SpendBlocked': {
      const base = { receiptHash: r.receiptHash.replace(/^0x/, '').toLowerCase(), merchant: base58(r.merchant), amount: Number(r.amount), fee: Number(r.fee), at, txHash };
      return e.event_name === 'Paid' ? { kind: 'paid', ...base } : { kind: 'blocked', ...base, reason: reasonFromCode(Number(r.reason)) };
    }
    case 'Paused':
      return { kind: 'paused', at, txHash };
    case 'Resumed':
      return { kind: 'resumed', at, txHash };
    default:
      return undefined;
  }
}

export class TronGridEvents implements EventSource {
  private host: string;
  private f: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  constructor(private cfg: TronGridConfig = {}) {
    this.host = (cfg.host ?? 'https://nile.trongrid.io').replace(/\/$/, '');
    this.f = cfg.fetchImpl ?? fetch;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async events(vault: string): Promise<ChainEvent[]> {
    const out: ChainEvent[] = [];
    const first = `${this.host}/v1/contracts/${vault}/events?limit=${this.cfg.pageSize ?? 200}&order_by=block_timestamp,asc`;
    let url: string | undefined = first;
    for (let pages = 0; url && pages < 100; pages++) {
      const page = await this.get(url);
      for (const e of page.data ?? []) {
        const d = decodeEvent(e);
        if (d) out.push(d);
      }
      url = page.meta?.fingerprint ? `${first}&fingerprint=${encodeURIComponent(page.meta.fingerprint)}` : undefined;
    }
    return out;
  }

  private async get(url: string): Promise<Page> {
    const retries = this.cfg.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const res = await this.f(url, { headers: { Accept: 'application/json' } });
      if (res.ok) return (await res.json()) as Page;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`TronGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}
