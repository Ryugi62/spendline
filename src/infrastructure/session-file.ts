// Rebuilds web/public/session.json from PUBLIC data only: the receipts file + the vault's events on TronGrid (no key).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TronGridEvents } from '../adapters/trongrid';
import { parseReceiptsFile } from '../application/auditRecords';
import { sessionOf } from '../application/views';

export type SessionFileOptions = { out?: string; waitForReceipt?: string; timeoutMs?: number };

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
  writeFileSync(out, JSON.stringify(sessionOf(file, vault, events, Math.floor(Date.now() / 1000)), null, 1) + '\n');
  return { out, receipts: file.receipts.length, events: events.length, indexed: has(events) };
}
