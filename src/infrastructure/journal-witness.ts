// AC-45 — the MCP server's side of the witness: read the pass-through journal, bind a pay call to the Kiln reply with the same arguments.
import { existsSync, readFileSync } from 'node:fs';
import type { ReceiptStore } from '../application/ports';
import { findWitness, type JournalEntry } from '../domain/kilnJournal';
import type { UsageRecord } from '../domain/tokenLedger';

export function journalWitness(path: string, store: ReceiptStore, now: () => number = () => Date.now()) {
  const used = new Set<string>();
  return async (args: Record<string, unknown>): Promise<(UsageRecord & { asked?: string; occurrence?: number }) | undefined> => {
    if (!existsSync(path)) return undefined;
    const entries = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalEntry);
    // a (generation, arguments) already sealed into a receipt is used
    for (const r of await store.all()) for (const u of r.flows) {
      const e = entries.find((x) => x.generationId === u.generationId);
      e?.toolCalls.forEach((tc, i) => { if (tc.arguments === u.args) used.add(`${e.generationId}#${i}`); });
    }
    const w = findWitness(entries, { name: 'spendline_pay', args }, { now: now(), used });
    if (!w) return undefined;
    used.add(w.key);
    const { key: _k, conversation: _c, ...usage } = w;
    return usage;
  };
}
