// AC-40 composition root — two witnesses per decision:
//   npm run attest                 asks Kiln (GET /v1/generations/{id}, Kiln key from .env) for every generation id in the record,
//                                  saves Kiln's answers verbatim to docs/kiln-generations.json, compares
//   npm run attest -- --saved      the same comparison, keyless, from docs/kiln-generations.json
// Chain times come from the vault's public events (TronGrid, keyless) or --events saved.json.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JsonlAnswerLog } from '../adapters/files';
import { KilnGenerations, parseKilnGeneration } from '../adapters/kiln';
import { TronGridEvents } from '../adapters/trongrid';
import { attestExitCode, formatAttest } from '../application/attest';
import { parseReceiptsFile } from '../application/auditRecords';
import { attest, type AttestAnswer, type KilnGeneration } from '../domain/attest';
import type { ChainEvent } from '../domain/audit';
import { isKilnCall, type UsageRecord } from '../domain/tokenLedger';
import { flag, LIVE_ANSWERS, LIVE_RECEIPTS, need, readEnv } from './runtime';

export const SAVED = 'docs/kiln-generations.json';
const LIVE_VAULT = 'TVP538YMfA3tzrTwUyBUpaqrJvc9bMEpCu';
/** The live record's split (README "Kiln account"): the organizer-issued account (team32, key made 2026-09-29 12:00 KST) made
 *  receipt #13 onward and the answers from log line 19; everything earlier ran on the builder's personal Kiln key. `--all` = no split. */
const TEAM32 = { fromSeq: 13, fromAnswer: 19 };
const TEAM32_NOTE = "the builder's personal key, before the organizer-issued team32 account: receipts #1-#12, answer lines 1-18 — Kiln shows a generation only to its own account";
type Saved = { source: string; fetchedAt: string; generations: Record<string, Parameters<typeof parseKilnGeneration>[0] | null> };

async function main(args: string[]): Promise<number> {
  const file = parseReceiptsFile(readFileSync(flag(args, '--receipts') ?? LIVE_RECEIPTS, 'utf8'));
  const logged = existsSync(flag(args, '--answers') ?? LIVE_ANSWERS) ? await new JsonlAnswerLog(flag(args, '--answers') ?? LIVE_ANSWERS).all() : [];
  // AC-44 MCP host runs (docs/live/mcp-host-*.json): Kiln calls that decided no payment (the closing answer, a refused call) are rows too
  const inReceipts = new Set(file.receipts.flatMap((r) => r.flows.map((u) => u.generationId)));
  const hostCalls: AttestAnswer[] = flag(args, '--receipts') ? [] : readdirSync('docs/live').filter((n) => /^mcp-host-.*\.json$/.test(n)).sort()
    .flatMap((n) => (JSON.parse(readFileSync(`docs/live/${n}`, 'utf8')) as { calls: UsageRecord[] }).calls)
    .filter((u) => !inReceipts.has(u.generationId))
    .map((u) => ({ flow: 'F1_intent', seq: null, question: 'MCP host call with no payment', usage: u }));
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
  const generations: Record<string, KilnGeneration | null> = Object.fromEntries(Object.entries(saved.generations).map(([id, g]) => [id, g ? parseKilnGeneration(g) : null]));
  const events: ChainEvent[] = flag(args, '--events') ? JSON.parse(readFileSync(flag(args, '--events')!, 'utf8')) : await new TronGridEvents().events(vault);
  const all = args.includes('--all') || flag(args, '--receipts') !== undefined;
  const res = attest({ receipts: file.receipts, answers, events, generations, model: 'qwen3-32b', ...(all ? {} : { scope: TEAM32 }) });
  console.log(formatAttest(res, { source: args.includes('--saved') ? `saved ${flag(args, '--from') ?? SAVED}, fetched ${saved.fetchedAt}` : `Kiln live, ${saved.fetchedAt}`, ...(all ? {} : { scopeNote: TEAM32_NOTE }) }));
  return attestExitCode(res);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(2);
  },
);
