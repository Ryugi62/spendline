// UC-5 / UC-6 composition root (flows F2 / F3 on live Kiln):
//   npm run explain -- <seq>          [--receipts docs/receipts-nile-live.jsonl] [--vault T…] [--answers docs/answers-nile-live.jsonl] [--json]
//   npm run dispute -- "<question>"   [same flags]
// Facts come from the receipts file + the vault's public events (TronGrid, keyless); only the Kiln key is read from .env.
// Answers are appended to the answers log, which is also the cache: asking again makes 0 Kiln calls.
import { readFileSync } from 'node:fs';
import { JsonCatalog, JsonlAnswerLog } from '../adapters/files';
import { TronGridEvents } from '../adapters/trongrid';
import { parseReceiptsFile } from '../application/auditRecords';
import { dispute } from '../application/dispute';
import { explain, formatAnswer } from '../application/explain';
import { CATALOG, flag, kilnFrom, LIVE_ANSWERS, LIVE_RECEIPTS, positionals, readEnv, sha256, vaultOf } from './runtime';

const USAGE = 'usage: npm run explain -- <seq> | npm run dispute -- "<question>"   [--receipts file] [--vault T…] [--answers file] [--json]';

async function main(args: string[]): Promise<number> {
  const [cmd, arg] = positionals(args, ['--json']);
  if ((cmd !== 'explain' && cmd !== 'dispute') || !arg) {
    console.error(USAGE);
    return 2;
  }
  const env = readEnv();
  const file = parseReceiptsFile(readFileSync(flag(args, '--receipts') ?? LIVE_RECEIPTS, 'utf8'));
  const vault = vaultOf(env, flag(args, '--vault')) ?? file.vault;
  if (!vault) throw new Error('no vault: pass --vault T…');
  const rec = { receipts: file.receipts, events: await new TronGridEvents().events(vault) };
  const deps = { llm: kilnFrom(env), log: new JsonlAnswerLog(flag(args, '--answers') ?? LIVE_ANSWERS), hash: sha256, labels: JsonCatalog.fromFile(CATALOG).labels() };
  const a = cmd === 'explain' ? await explain(deps, rec, Number(arg)) : await dispute(deps, rec, arg);
  console.log(args.includes('--json') ? JSON.stringify(a) : formatAnswer(a));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  },
);
