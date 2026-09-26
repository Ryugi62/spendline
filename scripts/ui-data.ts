// Builds web/public/session.json for the UI from PUBLIC data only: the receipts file + the vault's events on TronGrid (no key).
// usage: npm run ui:data [-- docs/receipts-nile-live.jsonl --vault T…]   (vault: --vault, else the file's, else the address in .env)
import { existsSync, readFileSync } from 'node:fs';
import { parseReceiptsFile } from '../src/application/auditRecords';
import { LIVE_RECEIPTS, positionals, flag, readEnv, vaultOf } from '../src/infrastructure/runtime';
import { writeSessionFile } from '../src/infrastructure/session-file';

const args = process.argv.slice(2);
const file = positionals(args)[0] ?? (existsSync(LIVE_RECEIPTS) ? LIVE_RECEIPTS : 'docs/receipts-nile.jsonl');
const vault = flag(args, '--vault') ?? parseReceiptsFile(readFileSync(file, 'utf8')).vault ?? vaultOf(readEnv());
if (!vault) throw new Error('no vault: pass --vault T…');
const s = await writeSessionFile(file, vault);
console.log(`${s.out}: ${s.receipts} receipts, ${s.events} events, vault ${vault}`);
