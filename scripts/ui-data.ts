// Builds web/public/session.json for the UI from PUBLIC data only: the receipts file + the vault's events on TronGrid (no key).
// usage: npm run ui:data [-- docs/receipts-nile.jsonl --vault T…]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TronGridEvents } from '../src/adapters/trongrid';
import { parseReceiptsFile } from '../src/application/auditRecords';
import type { Session } from '../src/application/views';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'docs/receipts-nile.jsonl';
const vaultFlag = args.indexOf('--vault');
const parsed = parseReceiptsFile(readFileSync(file, 'utf8'));
const vault = (vaultFlag >= 0 ? args[vaultFlag + 1] : undefined) ?? parsed.vault ?? 'TNw1jzJ8NXHmhvwNhLRjLTiBzosu3GXAqF';
const events = await new TronGridEvents().events(vault);
const session: Session = { vault, network: 'nile', receipts: parsed.receipts, events, generatedAt: Math.floor(Date.now() / 1000) };
mkdirSync('web/public', { recursive: true });
writeFileSync('web/public/session.json', JSON.stringify(session, null, 1) + '\n');
console.log(`web/public/session.json: ${session.receipts.length} receipts, ${events.length} events, vault ${vault}`);
