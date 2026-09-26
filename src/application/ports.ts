import type { ChainEvent } from '../domain/audit';
import type { BlockReason, Mandate } from '../domain/mandate';
import type { Receipt } from '../domain/receipt';
import type { Flow, UsageRecord } from '../domain/tokenLedger';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatOptions = { maxTokens?: number; thinking?: boolean };
export interface LlmPort {
  chat(flow: Flow, messages: ChatMessage[], opts?: ChatOptions): Promise<{ text: string; usage: UsageRecord }>;
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
