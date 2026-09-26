// UC-4 composition root: `npm run audit -- <receipts file> [--vault T…] [--events saved.json] [--host https://nile.trongrid.io]`
// Reads no .env and uses no key: receipts come from the file, events from TronGrid's public API (or a saved JSON of them).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TronGridEvents } from '../adapters/trongrid';
import { auditExitCode, auditRecords, formatAuditReport, parseReceiptsFile, ReceiptsFileError } from '../application/auditRecords';
import type { EventSource } from '../application/ports';
import type { ChainEvent } from '../domain/audit';

const USAGE = 'usage: npm run audit -- <receipts.jsonl | run.json> [--vault T…] [--events events.json] [--host https://nile.trongrid.io]';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args: string[]): Promise<number> {
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!file) {
    console.error(USAGE);
    return 2;
  }
  const parsed = parseReceiptsFile(readFileSync(file, 'utf8'));
  const vault = flag(args, '--vault') ?? parsed.vault;
  if (!vault) {
    console.error(`no vault address: this file does not name one, pass --vault T…\n${USAGE}`);
    return 2;
  }
  const saved = flag(args, '--events');
  const host = flag(args, '--host') ?? 'https://nile.trongrid.io';
  const source: EventSource = saved
    ? { events: async () => JSON.parse(readFileSync(saved, 'utf8')) as ChainEvent[] }
    : new TronGridEvents({ host });
  const res = await auditRecords({ events: source, hash: (s) => createHash('sha256').update(s).digest('hex') }, { ...parsed, vault });
  console.log(formatAuditReport(res, { vault, source: saved ? `saved file ${saved}` : `${host} (public, no key)` }));
  return auditExitCode(res);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof ReceiptsFileError ? `receipts file: ${e.message}` : String(e instanceof Error ? e.message : e));
    process.exit(2);
  },
);
