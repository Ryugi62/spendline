// AC-41 / AC-42 composition root — the lead's weekly loop, keyless (receipts file + the vault's public events):
//   npm run statement [-- --from-seq N] [--title "..."]      → docs/statement.md + docs/statement.csv (verdicts from the audit)
//   npm run tune -- <mandate.json> [--from-seq N]             → what that line would have done to the same requests
import { readFileSync, writeFileSync } from 'node:fs';
import { JsonCatalog } from '../adapters/files';
import { TronGridEvents } from '../adapters/trongrid';
import { auditRecords, parseReceiptsFile } from '../application/auditRecords';
import { formatStatementCsv, formatStatementMd, formatTune } from '../application/statement';
import { buildStatement, parseCandidate, tune } from '../domain/statement';
import { CATALOG, flag, LIVE_RECEIPTS, positionals, sha256 } from './runtime';

const LIVE_VAULT = 'TVP538YMfA3tzrTwUyBUpaqrJvc9bMEpCu';
const USAGE = 'usage: npm run statement [-- --from-seq N --title "..."] | npm run tune -- <mandate.json> [--from-seq N]';

async function main(args: string[]): Promise<number> {
  const [cmd, arg] = positionals(args);
  if (cmd !== 'statement' && !(cmd === 'tune' && arg)) {
    console.error(USAGE);
    return 2;
  }
  const file = parseReceiptsFile(readFileSync(flag(args, '--receipts') ?? LIVE_RECEIPTS, 'utf8'));
  const vault = flag(args, '--vault') ?? file.vault ?? LIVE_VAULT;
  const res = await auditRecords({ events: new TronGridEvents(), hash: sha256 }, { ...file, vault });
  const from = Number(flag(args, '--from-seq') ?? 1);
  const receipts = file.receipts.filter((r) => r.seq >= from);
  const labels = JsonCatalog.fromFile(CATALOG).labels();
  if (cmd === 'statement') {
    const s = buildStatement({ receipts, verdicts: res.verdicts, labels, offers: JsonCatalog.fromFile(CATALOG).all(), replays: res.replays.filter((x) => x.seq >= from).length });
    const title = flag(args, '--title') ?? `receipts #${receipts[0]?.seq ?? '-'}–#${receipts.at(-1)?.seq ?? '-'}, vault ${vault}`;
    writeFileSync(flag(args, '--md') ?? 'docs/statement.md', formatStatementMd(s, { network: 'nile', title }));
    writeFileSync(flag(args, '--csv') ?? 'docs/statement.csv', formatStatementCsv(s));
    console.log(formatStatementMd(s, { network: 'nile', title }).split('\n').slice(0, 3).join('\n'));
    console.log(`→ docs/statement.md · docs/statement.csv (${s.lines.length} lines)`);
    return s.problems ? 1 : 0;
  }
  const m = parseCandidate(JSON.parse(readFileSync(arg!, 'utf8')) as Record<string, unknown>, labels);
  if (typeof m === 'string') return console.error(`${arg}: ${m}`), 2;
  console.log(formatTune(tune({ receipts, verdicts: res.verdicts, candidate: m }), { labels }));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(2);
  },
);
