// AC-36 — the demo's terminal scene: live `npm run agent` transcripts, shown verbatim, each tied to its receipt in the record.
// The same rule as AC-31 for our own copy: a transcript that names a receipt, tx or generation id the record does not have is refused.
import type { Receipt } from '../domain/receipt';
import { VIA_TEXT } from './explain';

export type TerminalRow = { seq: number; transcript: string; via: string; serverS: string; latencyS: string };

const seqOf = (t: string) => Number(t.match(/^#(\d+) (?:PAID|STOPPED)/m)?.[1] ?? NaN);

export function checkTranscript(transcript: string, receipts: Receipt[], txs: string[]): string[] {
  const seq = seqOf(transcript);
  const r = receipts.find((x) => x.seq === seq);
  if (!r) return [`receipt #${Number.isNaN(seq) ? '?' : seq} is not in the record`];
  const out: string[] = [];
  for (const tx of transcript.match(/^tx ([0-9a-f]+)/gm)?.map((l) => l.slice(3)) ?? []) if (!txs.includes(tx)) out.push(`tx ${tx} is not in the record`);
  const gens = new Set(r.flows.map((f) => f.generationId));
  for (const g of transcript.match(/gen ([\w-]+)/g)?.map((m) => m.slice(4)) ?? []) if (!gens.has(g)) out.push(`generation ${g} is not on receipt #${seq}`);
  return out;
}

export function terminalScene(transcripts: string[], receipts: Receipt[]): TerminalRow[] {
  return transcripts.map((transcript) => {
    const seq = seqOf(transcript);
    const f1 = receipts.find((x) => x.seq === seq)?.flows.find((f) => f.flow === 'F1_intent');
    return {
      seq,
      transcript,
      via: f1?.via ? VIA_TEXT[f1.via] : 'not recorded',
      serverS: typeof f1?.serverMs === 'number' ? (f1.serverMs / 1000).toFixed(2) : '-',
      latencyS: f1 ? (f1.latencyMs / 1000).toFixed(2) : '-',
    };
  });
}
