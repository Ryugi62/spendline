import type { VerdictKind } from '../domain/answers';
import type { ChainEvent } from '../domain/audit';
import type { BlockReason, Mandate } from '../domain/mandate';
import type { Receipt } from '../domain/receipt';
import type { Flow, UsageRecord } from '../domain/tokenLedger';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
/** A function the model may call (OpenAI-compatible `tools`; qwen3-32b on Kiln: tool_choice auto only). */
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { name: string; arguments: string };
export type ChatOptions = { maxTokens?: number; thinking?: boolean; tools?: ToolSpec[] };
export interface LlmPort {
  chat(flow: Flow, messages: ChatMessage[], opts?: ChatOptions): Promise<{ text: string; usage: UsageRecord; toolCall?: ToolCall; /** every tool call in the reply (Kiln documents no parallel calls for qwen3-32b; handled anyway) */ toolCalls?: ToolCall[] }>;
}

export type PayCall = { merchant: string; amount: number; fee: number; receiptHash: string };
export type PayOutcome =
  | { kind: 'paid'; txHash: string; at: number }
  | { kind: 'blocked'; reason: BlockReason; txHash: string; at: number };
export interface ChainPort {
  mandate(): Promise<Mandate>;
  spent(): Promise<number>;
  now(): Promise<number>;
  pay(call: PayCall): Promise<PayOutcome>;
  pause(): Promise<string>;
  /** UC-1. Owner only. Replaces the line, resets spent, unpauses (SpendlineVault.grant). */
  grant(m: Mandate): Promise<string>;
}

export type Offer = { merchant: string; item: string; unitPrice: number; fee: number; label: string };
export interface CatalogPort {
  offers(item: string): Promise<Offer[]>;
}

export interface ReceiptStore {
  all(): Promise<Receipt[]>;
  append(r: Receipt): Promise<void>;
}

/** Public chain events for one vault. Keyless by contract: an auditor must never need a key to read the record. */
export interface EventSource {
  events(vault: string): Promise<ChainEvent[]>;
}

/** An F2 / F3 answer. `text` is the model's words only when it echoed the audit (grounded); otherwise the code's template. */
export type Answer = {
  flow: 'F2_explain' | 'F3_dispute';
  seq: number | null;
  question?: string;
  verdict?: VerdictKind;
  reason?: BlockReason;
  text: string;
  grounded: boolean;
  /** why the model's reply was not shown */
  rejected?: string;
  txHash?: string;
  /** the Kiln call that produced it — absent when answered from the log */
  usage?: UsageRecord;
  cached: boolean;
};
export type AnswerRecord = Omit<Answer, 'cached'> & { key: string };
/** Append-only answers log; doubles as the cache (UC-5 "on demand only, cached"). */
export interface AnswerLog {
  find(key: string): Promise<AnswerRecord | undefined>;
  append(a: AnswerRecord): Promise<void>;
  all(): Promise<AnswerRecord[]>;
}
