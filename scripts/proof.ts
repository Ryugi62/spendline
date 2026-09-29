// AC-38: README "Proof of API usage — per flow" (organizer's required item 4) from the public record. Keyless, offline.
// usage: npm run proof [-- --check]   (--check exits 1 if README is not up to date)
import { readFileSync, writeFileSync } from 'node:fs';
import { readJsonl } from '../src/adapters/files';
import type { AnswerRecord } from '../src/application/ports';
import { formatProof, proofByFlow } from '../src/application/proof';
import type { Session } from '../src/application/views';
import { LIVE_ANSWERS } from '../src/infrastructure/runtime';
import { hostCallsOutsideReceipts, hostLogs, withHostFlows } from '../src/infrastructure/host-runs';

const s = JSON.parse(readFileSync('web/public/session.json', 'utf8')) as Session;
const answers = readJsonl<AnswerRecord>(LIVE_ANSWERS);
const requestOf = new Map(hostLogs().flatMap((l) => (l.request ? l.calls.map((c) => [c.generationId, l.request!] as [string, string]) : [])));
const p = proofByFlow({ receipts: withHostFlows(s.receipts), events: s.events, answers, hostCalls: hostCallsOutsideReceipts(s.receipts), requestOf });
const body = formatProof(p, { network: s.network });
const START = '<!-- proof:start -->';
const END = '<!-- proof:end -->';
const readme = readFileSync('README.md', 'utf8');
const a = readme.indexOf(START);
const b = readme.indexOf(END);
if (a < 0 || b < a) throw new Error('README has no proof markers');
const next = readme.slice(0, a + START.length) + '\n' + body + readme.slice(b);
if (process.argv.includes('--check')) {
  if (next !== readme) { console.error('README proof section is stale — run `npm run proof`'); process.exit(1); }
  console.log('README proof section up to date');
} else {
  writeFileSync('README.md', next);
  console.log(`README proof: F1 ${p.f1.length} · F2 ${p.f2.length} · F3 ${p.f3.length} · F4 ${p.f4.length} + ${p.f4Other.length} Kiln calls · findings ${p.findings.length}`);
}
if (p.findings.length) process.exit(1);
