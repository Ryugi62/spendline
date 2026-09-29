// AC-40 composition root — two witnesses per decision:
//   npm run attest                 asks Kiln (GET /v1/generations/{id}, Kiln key from .env) for every generation id in the record,
//                                  saves Kiln's answers verbatim to docs/kiln-generations.json, compares
//   npm run attest -- --saved      the same comparison, keyless, from docs/kiln-generations.json
// Chain times come from the vault's public events (TronGrid, keyless) or --events saved.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { JsonCatalog, JsonlAnswerLog } from '../adapters/files';
import { withHostFlows } from './host-runs';
import { KilnGenerations } from '../adapters/kiln';
import { TronGridEvents } from '../adapters/trongrid';
import { attestExitCode, formatAttest } from '../application/attest';
import { parseReceiptsFile } from '../application/auditRecords';
import { attest, type AttestAnswer } from '../domain/attest';
import type { ChainEvent } from '../domain/audit';
import { isKilnCall } from '../domain/tokenLedger';
import { generationsOf, hostCallsOf, publishedJournal, SAVED, TEAM32, TEAM32_NOTE, type Saved } from './attest-record';
import { CATALOG, flag, LIVE_ANSWERS, LIVE_RECEIPTS, need, readEnv } from './runtime';

const LIVE_VAULT = 'TVP538YMfA3tzrTwUyBUpaqrJvc9bMEpCu';

async function main(args: string[]): Promise<number> {
  const file = parseReceiptsFile(readFileSync(flag(args, '--receipts') ?? LIVE_RECEIPTS, 'utf8'));
  const logged = existsSync(flag(args, '--answers') ?? LIVE_ANSWERS) ? await new JsonlAnswerLog(flag(args, '--answers') ?? LIVE_ANSWERS).all() : [];
  const hostCalls: AttestAnswer[] = flag(args, '--receipts') ? [] : hostCallsOf(file.receipts);
  const answers: AttestAnswer[] = [...logged, ...hostCalls];
  const vault = flag(args, '--vault') ?? file.vault ?? LIVE_VAULT;
  const ids = [...new Set([...file.receipts.flatMap((r) => r.flows), ...answers.flatMap((a) => (a.usage ? [a.usage] : []))].filter(isKilnCall).map((u) => u.generationId))];

  let saved: Saved;
  if (args.includes('--saved')) {
    saved = JSON.parse(readFileSync(flag(args, '--from') ?? SAVED, 'utf8')) as Saved;
  } else {
    const env = readEnv();
    need(env, 'KILN_API_KEY');
    const kiln = new KilnGenerations({ apiKey: env.KILN_API_KEY, baseUrl: env.KILN_BASE_URL });
    const generations: Saved['generations'] = {};
    for (const id of ids) {
      generations[id] = await kiln.raw(id);
      await new Promise((r) => setTimeout(r, 1100)); // Kiln: 60 requests per minute per org
    }
    saved = { source: `GET ${env.KILN_BASE_URL ?? 'https://api.bricksum.com/v1'}/generations/{id}`, fetchedAt: new Date().toISOString(), generations };
    writeFileSync(flag(args, '--out') ?? SAVED, JSON.stringify(saved, null, 1) + '\n');
  }
  const generations = generationsOf(saved);
  const events: ChainEvent[] = flag(args, '--events') ? JSON.parse(readFileSync(flag(args, '--events')!, 'utf8')) : await new TronGridEvents().events(vault);
  const all = args.includes('--all') || flag(args, '--receipts') !== undefined;
  const res = attest({ receipts: withHostFlows(file.receipts), answers, events, generations, model: 'qwen3-32b', offers: JsonCatalog.fromFile(CATALOG).all(), ...(all ? {} : { scope: TEAM32 }) });
  console.log(formatAttest(res, { journal: publishedJournal(file.receipts), source: args.includes('--saved') ? `saved ${flag(args, '--from') ?? SAVED}, fetched ${saved.fetchedAt}` : `Kiln live, ${saved.fetchedAt}`, ...(all ? {} : { scopeNote: TEAM32_NOTE }) }));
  return attestExitCode(res);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(2);
  },
);
