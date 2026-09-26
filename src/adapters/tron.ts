import { TronWeb } from 'tronweb';
import type { ChainEvent } from '../domain/audit';
import { reasonFromCode, type BlockReason, type Mandate } from '../domain/mandate';
import type { ChainPort, PayCall, PayOutcome } from '../application/ports';

/** TRON Nile adapter for SpendlineVault. The agent key signs pay(); the owner key (optional) signs grant/pause. */
/** agentKey signs pay(); ownerKey signs grant/pause. Either may be absent: the owner's machine needs no agent key and vice versa. */
export type TronConfig = { fullHost: string; agentKey?: string; ownerKey?: string; vault: string; abi: unknown[] };
const FEE_LIMIT = 150_000_000; // 150 TRX max burn per call on Nile

const hex32 = (h: string) => '0x' + h.replace(/^0x/, '').padStart(64, '0');

/** keccak256 of the event signatures (= topic 0 in a TRON tx info log, without 0x). */
export const PAID_TOPIC = '072cc6c51a329c05c701e430a01313a6bfb7168972415a0ba6603204f5562f5d'; // Paid(bytes32,bytes32,address,uint256,uint256,uint256)
export const BLOCKED_TOPIC = '0b595aceec0a4e9ecf0dc0cb28a49734fd303f18271afa4899ad0c80dfdea6d7'; // SpendBlocked(bytes32,bytes32,address,uint256,uint256,uint8)
type TxLog = { address: string; topics: string[]; data: string };
export type TxInfo = { blockTimeStamp?: number; receipt?: { result?: string }; log?: TxLog[] };

const NETWORK = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|timeout|status code (429|5\d\d)/i;
export const isNetworkError = (e: unknown) => NETWORK.test(`${(e as { code?: string })?.code ?? ''} ${(e as Error)?.message ?? e}`);
const hexText = (h?: string) => (h && /^[0-9a-f]+$/i.test(h) ? Buffer.from(h, 'hex').toString('utf8') : (h ?? ''));

export type SendSteps<T, S extends { txID: string }> = {
  build: () => Promise<T>;
  sign: (tx: T) => Promise<S>;
  broadcast: (signed: S) => Promise<{ result?: boolean; code?: string; message?: string }>;
  sleep?: (ms: number) => Promise<void>;
  tries?: number;
};
/**
 * Build → sign → broadcast, safe to retry: a failed BUILD sent nothing, so it is rebuilt; after a network error on
 * BROADCAST the SAME signed tx is sent again (TRON answers DUP_TRANSACTION_ERROR if the first one landed). A node's
 * refusal is thrown, not retried. (For pay() a re-send can never pay twice anyway: the vault decides a receipt hash once.)
 */
export async function sendWithRetry<T, S extends { txID: string }>(d: SendSteps<T, S>): Promise<string> {
  const tries = d.tries ?? 4;
  const sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const retry = async <R>(f: () => Promise<R>): Promise<R> => {
    for (let a = 1; ; a++) {
      try {
        return await f();
      } catch (e) {
        if (!isNetworkError(e) || a >= tries) throw e;
        await sleep(1000 * 2 ** a);
      }
    }
  };
  const signed = await d.sign(await retry(d.build));
  const res = await retry(() => d.broadcast(signed));
  if (res.result || res.code === 'DUP_TRANSACTION_ERROR') return signed.txID;
  throw new Error(`broadcast refused — ${res.code ?? 'unknown'}: ${hexText(res.message)}`);
}

export async function waitForInfo(fetchInfo: () => Promise<TxInfo>, o: { tries?: number; sleep?: (ms: number) => Promise<void>; txHash?: string } = {}): Promise<TxInfo> {
  const tries = o.tries ?? 60;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < tries; i++) {
    let info: TxInfo | undefined;
    try {
      info = await fetchInfo();
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
    if (info?.blockTimeStamp) return info;
    if (i < tries - 1) await sleep(2000);
  }
  throw new Error(`tx ${o.txHash ?? '?'} not in a block after ${tries} tries`);
}

/** The vault's decision straight from the tx info (available as soon as the block is), instead of the event API (≈50 s lag). */
export function decodePayLog(info: TxInfo, vaultHex: string): { kind: 'paid'; receiptHash: string; at: number } | { kind: 'blocked'; reason: BlockReason; receiptHash: string; at: number } | undefined {
  const vault = vaultHex.toLowerCase().replace(/^0x/, '').replace(/^41/, '');
  const at = Math.floor(Number(info.blockTimeStamp) / 1000);
  for (const l of info.log ?? []) {
    if (l.address.toLowerCase() !== vault) continue;
    const [topic, receiptHash] = l.topics;
    if (topic === PAID_TOPIC) return { kind: 'paid', receiptHash, at };
    if (topic === BLOCKED_TOPIC) return { kind: 'blocked', reason: reasonFromCode(parseInt(l.data.slice(-64), 16)), receiptHash, at };
  }
  return undefined;
}

export class TronChain implements ChainPort {
  private agent: TronWeb;
  private owner?: TronWeb;
  constructor(private cfg: TronConfig) {
    const reader = cfg.agentKey ?? cfg.ownerKey;
    if (!reader) throw new Error('TronChain needs the agent key or the owner key');
    this.agent = new TronWeb({ fullHost: cfg.fullHost, privateKey: reader }); // signs pay() when it is the agent key; otherwise reads only
    if (cfg.ownerKey) this.owner = new TronWeb({ fullHost: cfg.fullHost, privateKey: cfg.ownerKey });
  }
  private async c(tw: TronWeb = this.agent) {
    return tw.contract(this.cfg.abi as never, this.cfg.vault);
  }
  async mandate(): Promise<Mandate> {
    const c = await this.c();
    const [id, budget, cap, deadline, paused, merchants] = await Promise.all([
      c.mandateId().call(), c.budget().call(), c.perTxCap().call(), c.deadline().call(), c.paused().call(), c.merchants().call(),
    ]);
    return {
      id: String(id),
      budget: Number(budget),
      perTxCap: Number(cap),
      deadline: Number(deadline),
      paused: Boolean(paused),
      merchants: (merchants as string[]).map((a) => TronWeb.address.fromHex(a)),
    };
  }
  async spent() { return Number(await (await this.c()).spent().call()); }
  async now() { return Number(await (await this.c()).nowTs().call()); }

  async pay(call: PayCall): Promise<PayOutcome> {
    if (!this.cfg.agentKey) throw new Error('agent key required for pay');
    const txHash = await this.invoke(this.agent, 'pay(address,uint256,uint256,bytes32)', [
      { type: 'address', value: call.merchant },
      { type: 'uint256', value: call.amount },
      { type: 'uint256', value: call.fee },
      { type: 'bytes32', value: hex32(call.receiptHash) },
    ]);
    const info = await this.waitInfo(txHash);
    if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`pay tx ${txHash} failed: ${info.receipt.result}`);
    const at = Math.floor(Number(info.blockTimeStamp) / 1000);
    const fromLog = decodePayLog(info, TronWeb.address.toHex(this.cfg.vault));
    if (fromLog?.kind === 'paid') return { kind: 'paid', txHash, at };
    if (fromLog?.kind === 'blocked') return { kind: 'blocked', reason: fromLog.reason, txHash, at };
    const evs = await this.eventsOfTx(txHash); // fallback: event API
    const blocked = evs.find((e) => e.event_name === 'SpendBlocked');
    if (blocked) return { kind: 'blocked', reason: reasonFromCode(Number(blocked.result.reason)), txHash, at };
    if (evs.find((e) => e.event_name === 'Paid')) return { kind: 'paid', txHash, at };
    throw new Error(`pay tx ${txHash}: no Paid/SpendBlocked event`);
  }

  async pause(): Promise<string> {
    if (!this.owner) throw new Error('owner key required for pause');
    return this.invoke(this.owner, 'pause()', []);
  }

  async grant(m: Mandate): Promise<string> {
    if (!this.owner) throw new Error('owner key required for grant');
    const txHash = await this.invoke(this.owner, 'grant(bytes32,uint256,uint256,uint256,address[])', [
      { type: 'bytes32', value: hex32(m.id) },
      { type: 'uint256', value: m.budget },
      { type: 'uint256', value: m.perTxCap },
      { type: 'uint256', value: m.deadline },
      { type: 'address[]', value: m.merchants },
    ]);
    const info = await this.waitInfo(txHash);
    if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`grant tx ${txHash} failed: ${info.receipt.result}`);
    return txHash;
  }

  /** Public events for the auditor — needs no key at all in principle; any TronWeb instance works. */
  async events(): Promise<ChainEvent[]> {
    const out: ChainEvent[] = [];
    for (const name of ['Paid', 'SpendBlocked']) {
      const res = await this.agent.event.getEventsByContractAddress(this.cfg.vault, { eventName: name, limit: 200, onlyConfirmed: false } as never);
      for (const e of (res as { data?: { transaction_id: string; block_timestamp: number; result: Record<string, string> }[] }).data ?? []) {
        const base = {
          receiptHash: String(e.result.receiptHash).replace(/^0x/, ''),
          merchant: TronWeb.address.fromHex(e.result.merchant),
          amount: Number(e.result.amount),
          fee: Number(e.result.fee),
          at: Math.floor(e.block_timestamp / 1000),
          txHash: e.transaction_id,
        };
        out.push(name === 'Paid' ? { kind: 'paid', ...base } : { kind: 'blocked', ...base, reason: reasonFromCode(Number(e.result.reason)) });
      }
    }
    for (const name of ['Paused', 'Resumed']) {
      const res = await this.agent.event.getEventsByContractAddress(this.cfg.vault, { eventName: name, limit: 200, onlyConfirmed: false } as never);
      for (const e of (res as { data?: { transaction_id: string; block_timestamp: number }[] }).data ?? [])
        out.push({ kind: name === 'Paused' ? 'paused' : 'resumed', at: Math.floor(e.block_timestamp / 1000), txHash: e.transaction_id });
    }
    return out;
  }

  /** Same steps as TronWeb's contract method send(), split so a network blip can be retried safely (sendWithRetry). */
  private invoke(tw: TronWeb, selector: string, parameters: { type: string; value: unknown }[]): Promise<string> {
    type Built = Awaited<ReturnType<TronWeb['transactionBuilder']['triggerSmartContract']>>['transaction'];
    return sendWithRetry({
      build: async () => {
        const r = await tw.transactionBuilder.triggerSmartContract(this.cfg.vault, selector, { feeLimit: FEE_LIMIT, callValue: 0 }, parameters as never, tw.defaultAddress.hex as string);
        if (!r.result?.result) throw new Error(`${selector}: node did not build the tx: ${JSON.stringify(r).slice(0, 200)}`);
        return r.transaction as Built;
      },
      sign: (tx) => tw.trx.sign(tx) as Promise<Built & { txID: string }>,
      broadcast: (signed) => tw.trx.sendRawTransaction(signed as never) as Promise<{ result?: boolean; code?: string; message?: string }>,
    });
  }
  /** Block-included info from the full node (the solidified one lags ~19 blocks ≈ 60 s per call, measured 2026-09-26). */
  private waitInfo(txHash: string): Promise<TxInfo> {
    return waitForInfo(() => this.agent.trx.getUnconfirmedTransactionInfo(txHash) as Promise<TxInfo>, { txHash });
  }
  private async eventsOfTx(txHash: string): Promise<{ event_name: string; result: Record<string, string> }[]> {
    for (let i = 0; i < 10; i++) {
      const r = (await this.agent.event.getEventsByTransactionID(txHash)) as { data?: { event_name: string; result: Record<string, string> }[] };
      if (r.data?.length) return r.data;
      await new Promise((res) => setTimeout(res, 2000));
    }
    return [];
  }
}
