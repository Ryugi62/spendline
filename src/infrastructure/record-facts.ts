// Facts of the public record for the deck, the pitch and the video (AC-31 / AC-32). Keyless and offline:
// web/public/session.json (receipts + the vault's public events, fetched by `npm run ui:data`) + the answers log + the A/B file.
import { readdirSync, readFileSync } from 'node:fs';
import { readJsonl } from '../adapters/files';
import type { AnswerRecord } from '../application/ports';
import { pitchFacts, type PitchFacts } from '../application/pitch';
import type { Session } from '../application/views';
import { audit } from '../domain/audit';
import { abSummary, flowReport, type AbPair } from '../domain/flowReport';
import { LIVE_ANSWERS, sha256 } from './runtime';

/** Numbers our copy may state that are not in the record — each with where it comes from. */
export const STATED = [
  '180 W — FuriosaAI RNGD card TDP ("180W TDP", furiosa.ai/rngd, checked 2026-09-26)',
  'a 3-person AI startup (the user scene in the README)',
  'design limit: 2 LLM calls per purchase (SPEC §1)',
  'the audit exits 1 on any problem, 0 when all check out',
  'Apache-2.0 license',
  'video limit 3:00 · pitch limit 5:00 · the 48 h event window',
  'receipt hash to event: 1 : 1',
];

/** Test cases in tests/*.ts (same count vitest reports: one `it(` per case, no `.each`). */
export function countTests(dir = 'tests'): number {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .reduce((n, f) => n + (readFileSync(`${dir}/${f}`, 'utf8').match(/^\s*it\(/gm) ?? []).length, 0);
}

export function recordFacts(o: { session?: string; answers?: string; ab?: string } = {}): PitchFacts {
  const s = JSON.parse(readFileSync(o.session ?? 'web/public/session.json', 'utf8')) as Session;
  const answers = readJsonl<AnswerRecord>(o.answers ?? LIVE_ANSWERS);
  const ab = JSON.parse(readFileSync(o.ab ?? 'docs/ab-no-think-2026-09-26.json', 'utf8')) as { pairs: AbPair[] };
  const res = audit({ mandates: [], receipts: s.receipts, events: s.events, hash: sha256 });
  const usage = [...s.receipts.flatMap((r) => r.flows), ...answers.flatMap((a) => (a.usage ? [a.usage] : []))];
  const report = flowReport(usage, { purchases: s.receipts.length });
  const grants = s.events.filter((e) => e.kind === 'granted');
  return pitchFacts(res, report, abSummary(ab.pairs), {
    vault: s.vault,
    tests: countTests(),
    stated: STATED,
    extraTx: s.events.map((e) => e.txHash),
    stopTx: s.events.find((e) => e.kind === 'paused')?.txHash,
    grantTx: grants[0]?.txHash,
  });
}
