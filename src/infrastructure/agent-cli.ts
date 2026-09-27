// UC-2 composition root — one request line → one receipt (M0-15):
//   npm run agent -- "<request words>" [--receipts docs/receipts-nile-live.jsonl] [--vault T…] [--no-ui] [--json]
// F1 runs on live Kiln (qwen3-32b) — there is no stand-in: if Kiln fails, the run fails and nothing is paid or written.
// The receipt is appended to the receipts file (continuing its hash chain), the vault decides on Nile, and the UI record
// (web/public/session.json) is rebuilt from public data unless --no-ui.
import { JsonCatalog, JsonlReceiptStore } from '../adapters/files';
import { TronChain } from '../adapters/tron';
import { formatPurchase } from '../application/agent';
import { purchase } from '../application/purchase';
import { CATALOG, flag, kilnFrom, LIVE_ANSWERS, LIVE_RECEIPTS, need, positionals, readEnv, sha256, vaultOf } from './runtime';
import { writeSessionFile } from './session-file';
// @ts-expect-error plain ESM script without types
import { compile } from '../../scripts/compile-contract.mjs';

const USAGE = 'usage: npm run agent -- "<request words>" [--receipts file.jsonl] [--vault T…] [--no-ui] [--json]';

async function main(args: string[]): Promise<number> {
  const [text] = positionals(args, ['--no-ui', '--json']);
  if (!text?.trim()) return console.error(USAGE), 2;
  const env = readEnv();
  need(env, 'AGENT_PRIVATE_KEY', 'TRON_FULLHOST');
  const vault = vaultOf(env, flag(args, '--vault'));
  if (!vault) throw new Error('no vault: pass --vault T…');
  const receipts = flag(args, '--receipts') ?? LIVE_RECEIPTS;
  const catalog = JsonCatalog.fromFile(CATALOG);
  const deps = {
    llm: kilnFrom(env),
    chain: new TronChain({ fullHost: env.TRON_FULLHOST, agentKey: env.AGENT_PRIVATE_KEY, vault, abi: compile().abi }),
    catalog,
    store: new JsonlReceiptStore(receipts),
    hash: sha256,
  };
  const r = await purchase(deps, text);
  if (args.includes('--json')) console.log(JSON.stringify({ vault, request: r.request, preview: r.preview, outcome: r.outcome, receipt: r.receipt }));
  else console.log(formatPurchase(r, catalog.labels()));
  if (!args.includes('--no-ui')) {
    const s = await writeSessionFile(receipts, vault, { waitForReceipt: r.receipt.hash, answers: receipts === LIVE_RECEIPTS ? LIVE_ANSWERS : undefined });
    console.error(`${s.out}: ${s.receipts} receipts, ${s.events} events${s.indexed ? '' : ' (TronGrid had not indexed this receipt yet — run npm run ui:data again)'}`);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  },
);
