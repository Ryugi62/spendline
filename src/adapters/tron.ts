import { TronWeb } from 'tronweb';
import type { ChainEvent } from '../domain/audit';
import { reasonFromCode, type Mandate } from '../domain/mandate';
import type { ChainPort, PayCall, PayOutcome } from '../application/ports';

/** TRON Nile adapter for SpendlineVault. The agent key signs pay(); the owner key (optional) signs grant/pause. */
export type TronConfig = { fullHost: string; agentKey: string; ownerKey?: string; vault: string; abi: unknown[] };
const FEE_LIMIT = 150_000_000; // 150 TRX max burn per call on Nile

const hex32 = (h: string) => '0x' + h.replace(/^0x/, '').padStart(64, '0');

export class TronChain implements ChainPort {
  private agent: TronWeb;
  private owner?: TronWeb;
  constructor(private cfg: TronConfig) {
    this.agent = new TronWeb({ fullHost: cfg.fullHost, privateKey: cfg.agentKey });
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
    const c = await this.c();
    const txHash: string = await c.pay(call.merchant, call.amount, call.fee, hex32(call.receiptHash)).send({ feeLimit: FEE_LIMIT });
    const info = await this.waitInfo(txHash);
    if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`pay tx ${txHash} failed: ${info.receipt.result}`);
    const at = Math.floor(Number(info.blockTimeStamp) / 1000);
    const evs = await this.eventsOfTx(txHash);
    const blocked = evs.find((e) => e.event_name === 'SpendBlocked');
    if (blocked) return { kind: 'blocked', reason: reasonFromCode(Number(blocked.result.reason)), txHash, at };
    if (evs.find((e) => e.event_name === 'Paid')) return { kind: 'paid', txHash, at };
    throw new Error(`pay tx ${txHash}: no Paid/SpendBlocked event`);
  }

  async pause(): Promise<string> {
    if (!this.owner) throw new Error('owner key required for pause');
    return (await this.c(this.owner)).pause().send({ feeLimit: FEE_LIMIT });
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

  private async waitInfo(txHash: string, tries = 30): Promise<{ blockTimeStamp?: number; receipt?: { result?: string } }> {
    for (let i = 0; i < tries; i++) {
      const info = (await this.agent.trx.getTransactionInfo(txHash)) as { blockTimeStamp?: number; receipt?: { result?: string } };
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
