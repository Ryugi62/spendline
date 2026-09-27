// Rebuilds web/public/session.json from PUBLIC data only: the receipts file + the vault's events on TronGrid (no key).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readJsonl } from '../adapters/files';
import { TronGridEvents } from '../adapters/trongrid';
import { parseReceiptsFile } from '../application/auditRecords';
import type { AnswerRecord } from '../application/ports';
import { sessionOf } from '../application/views';

/** `answers`: the F2 / F3 answers log of this record (public — it holds the model's words and usage, no key); shown only where it echoes the audit (AC-30). */
export type SessionFileOptions = { out?: string; waitForReceipt?: string; timeoutMs?: number; answers?: string };

/** TronGrid indexes an event some seconds after its block; `waitForReceipt` polls until the newest receipt's event is there. */
export async function writeSessionFile(receiptsPath: string, vault: string, o: SessionFileOptions = {}) {
  const file = parseReceiptsFile(readFileSync(receiptsPath, 'utf8'));
  const source = new TronGridEvents();
  const has = (events: Awaited<ReturnType<TronGridEvents['events']>>) =>
    !o.waitForReceipt || events.some((e) => (e.kind === 'paid' || e.kind === 'blocked') && e.receiptHash === o.waitForReceipt!.replace(/^0x/, '').toLowerCase());
  const t0 = Date.now();
  let events = await source.events(vault);
  while (!has(events) && Date.now() - t0 < (o.timeoutMs ?? 120_000)) {
    await new Promise((r) => setTimeout(r, 5_000));
    events = await source.events(vault);
  }
  const out = o.out ?? 'web/public/session.json';
  mkdirSync(out.slice(0, out.lastIndexOf('/')) || '.', { recursive: true });
  const answers = o.answers && existsSync(o.answers) ? readJsonl<AnswerRecord>(o.answers) : undefined;
  writeFileSync(out, JSON.stringify(sessionOf(file, vault, events, Math.floor(Date.now() / 1000), answers), null, 1) + '\n');
  return { out, receipts: file.receipts.length, events: events.length, answers: answers?.length ?? 0, indexed: has(events) };
}
