import type { ChainEvent } from '../domain/audit';
import { evaluate, type Mandate } from '../domain/mandate';
import type { Receipt } from '../domain/receipt';
import { STAND_IN_PREFIX, type Flow } from '../domain/tokenLedger';
import type { AnswerLog, AnswerRecord, CatalogPort, ChainPort, ChatMessage, LlmPort, Offer, PayCall, PayOutcome, ReceiptStore } from '../application/ports';

/** Test doubles. MemoryChain mirrors SpendlineVault.sol: same evaluate(), stops are events, not reverts. */
export class FakeLlm implements LlmPort {
  private i = 0;
  /** every prompt it was sent, in order (tests read what the model would have seen) */
  readonly seen: ChatMessage[][] = [];
  constructor(private replies: string[]) {}
  async chat(flow: Flow, messages: ChatMessage[]) {
    this.seen.push(messages.map((m) => ({ ...m })));
    const text = this.replies[this.i++] ?? '{}';
    const promptTokens = messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
    return { text, usage: { flow, promptTokens, completionTokens: Math.ceil(text.length / 4), costUsd: 0, latencyMs: 0, generationId: `${STAND_IN_PREFIX}${this.i}` } };
  }
}

export class MemoryChain implements ChainPort {
  events: ChainEvent[] = [];
  private spentMicro = 0;
  private tx = 0;
  constructor(private m: Mandate, private clock: number) {}
  mandateSnapshot(): Mandate { return { ...this.m, paused: false }; }
  async mandate() { return { ...this.m }; }
  async spent() { return this.spentMicro; }
  async now() { return this.clock; }
  async pause() { this.m.paused = true; const txHash = `pause-${++this.tx}`; this.events.push({ kind: 'paused', at: this.clock, txHash }); return txHash; }
  /** Same effects as SpendlineVault.grant: new line, spent = 0, paused = false, one public event. */
  async grant(m: Mandate) {
    this.m = { ...m, paused: false };
    this.spentMicro = 0;
    const txHash = `grant-${++this.tx}`;
    this.events.push({ kind: 'granted', mandate: { ...this.m }, at: this.clock, txHash });
    return txHash;
  }
  advance(seconds: number) { this.clock += seconds; }
  private used = new Set<string>();
  async pay(c: PayCall): Promise<PayOutcome> {
    const txHash = `mem-${++this.tx}`;
    const d = evaluate(this.m, this.spentMicro, { merchant: c.merchant, amount: c.amount, fee: c.fee, at: this.clock }, this.used.has(c.receiptHash));
    this.used.add(c.receiptHash);
    if (d.kind === 'allow') {
      this.spentMicro += c.amount + c.fee;
      this.events.push({ kind: 'paid', receiptHash: c.receiptHash, merchant: c.merchant, amount: c.amount, fee: c.fee, at: this.clock, txHash });
      return { kind: 'paid', txHash, at: this.clock };
    }
    this.events.push({ kind: 'blocked', receiptHash: c.receiptHash, merchant: c.merchant, amount: c.amount, fee: c.fee, at: this.clock, reason: d.reason, txHash });
    return { kind: 'blocked', reason: d.reason, txHash, at: this.clock };
  }
}

export class MemoryCatalog implements CatalogPort {
  constructor(private list: Offer[]) {}
  async offers(item: string) { return this.list.filter((o) => o.item === item); }
}

export class MemoryReceiptStore implements ReceiptStore {
  private rs: Receipt[] = [];
  async all() { return [...this.rs]; }
  async append(r: Receipt) { this.rs.push(r); }
}

export class MemoryAnswerLog implements AnswerLog {
  private rs: AnswerRecord[] = [];
  async find(key: string) { return [...this.rs].reverse().find((r) => r.key === key); }
  async append(a: AnswerRecord) { this.rs.push(a); }
  async all() { return [...this.rs]; }
}
