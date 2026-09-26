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
    const c = await this.c();
    const txHash: string = await c.pay(call.merchant, call.amount, call.fee, hex32(call.receiptHash)).send({ feeLimit: FEE_LIMIT });
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
    return (await this.c(this.owner)).pause().send({ feeLimit: FEE_LIMIT });
  }

  async grant(m: Mandate): Promise<string> {
    if (!this.owner) throw new Error('owner key required for grant');
    const txHash: string = await (await this.c(this.owner)).grant(hex32(m.id), m.budget, m.perTxCap, m.deadline, m.merchants).send({ feeLimit: FEE_LIMIT });
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

  private async waitInfo(txHash: string, tries = 30): Promise<TxInfo> {
    for (let i = 0; i < tries; i++) {
      const info = (await this.agent.trx.getTransactionInfo(txHash)) as TxInfo;
      if (info && info.blockTimeStamp) return info;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`tx ${txHash} not confirmed in ${tries * 2}s`);
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
