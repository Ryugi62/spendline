// AC-40 — shared by `npm run attest` and the record facts (deck / video): the saved Kiln answers, the account split, the MCP host calls.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseKilnGeneration } from '../adapters/kiln';
import { JsonCatalog } from '../adapters/files';
import { withHostFlows } from './host-runs';
import { CATALOG } from './runtime';
import type { AnswerRecord } from '../application/ports';
import { attest, type AccountScope, type AttestAnswer, type AttestResult, type KilnGeneration } from '../domain/attest';
import type { ChainEvent } from '../domain/audit';
import type { Receipt } from '../domain/receipt';
import type { UsageRecord } from '../domain/tokenLedger';

export const SAVED = 'docs/kiln-generations.json';
/** The live record's split (README "Kiln account"): the organizer-issued account (team32, key made 2026-09-29 12:00 KST) made
 *  receipt #13 onward and the answers from log line 19; everything earlier ran on the builder's personal Kiln key. */
export const TEAM32: AccountScope = { fromSeq: 13, fromAnswer: 19 };
export const TEAM32_NOTE = "the builder's personal key, before the organizer-issued team32 account: receipts #1-#12, answer lines 1-18 — Kiln shows a generation only to its own account";
export type Saved = { source: string; fetchedAt: string; generations: Record<string, Parameters<typeof parseKilnGeneration>[0] | null> };

/** AC-44 MCP host runs (docs/live/mcp-host-*.json): the Kiln calls that decided no payment (a closing answer, a refused call). */
export function hostCallsOf(receipts: Receipt[], dir = 'docs/live'): AttestAnswer[] {
  const inReceipts = new Set(receipts.flatMap((r) => r.flows.map((u) => u.generationId)));
  return readdirSync(dir).filter((n) => /^mcp-host-.*\.json$/.test(n)).sort()
    .flatMap((n) => (JSON.parse(readFileSync(`${dir}/${n}`, 'utf8')) as { calls: UsageRecord[] }).calls)
    .filter((u) => !inReceipts.has(u.generationId))
    .map((u) => ({ flow: 'F4_mcp_host' as const, seq: null, question: 'MCP host call with no payment', usage: { ...u, flow: 'F4_mcp_host' as const } }));
}

export const generationsOf = (saved: Saved): Record<string, KilnGeneration | null> =>
  Object.fromEntries(Object.entries(saved.generations).map(([id, g]) => [id, g ? parseKilnGeneration(g) : null]));

/** Keyless: the comparison from the saved Kiln answers (undefined when the file is missing). */
export function savedAttest(o: { receipts: Receipt[]; answers: AnswerRecord[]; events: ChainEvent[]; file?: string }): AttestResult | undefined {
  const file = o.file ?? SAVED;
  if (!existsSync(file)) return undefined;
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Saved;
  return attest({ receipts: withHostFlows(o.receipts), answers: [...o.answers, ...hostCallsOf(o.receipts)], events: o.events, generations: generationsOf(saved), model: 'qwen3-32b', scope: TEAM32, offers: JsonCatalog.fromFile(CATALOG).all() });
}
