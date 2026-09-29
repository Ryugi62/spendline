import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deckSlides, slideText } from '../src/adapters/web/deck';
import { checkScript, estimateSeconds, strayInCopy, type PitchFacts, type Scene } from '../src/application/pitch';
import { recordFacts } from '../src/infrastructure/record-facts';

// AC-31 / AC-32: the video, the pitch, the deck and the Q&A say only what the record says.
const f: PitchFacts = {
  vault: 'TVault', receipts: 8, paid: 4, stopped: 4, replays: 1, problems: 0, paidUsdt: '13.60', merchantStopSeq: 2,
  kilnCalls: 26, tokens: '18,490', usd: '0.0014723', wh: '3.33', whPerPurchase: '0.10', callsPerPurchase: '1.00', flows: 3,
  ab: { n: 12, offTokens: 36, onTokens: 223, offSeconds: '0.95', onSeconds: '3.50', sameJson: 12, tokensSavedPct: 84, latencySavedPct: 73 },
  tests: 120, txHashes: ['819478c7aa', 'e67cc9b8bb'], stops: [{ seq: 2, reason: 'MERCHANT_NOT_ALLOWED', tx: '819478c7aa' }], paidTx: ['e67cc9b8bb'],
  stated: ['180 W — RNGD TDP'],
};
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

describe('checkScript (AC-31)', () => {
  it('a script that opens on the seller-not-listed stop and quotes only record numbers passes', () => {
    const s: Scene[] = [
      { id: 's1', url: 'ui:#/receipt/2', en: 'The agent tried a seller not on the list; the vault stopped it on-chain, tx 819478c7.' },
      { id: 's2', url: 'ui:#/audit', en: '8 receipts, 4 paid, 4 stopped, 0 problems, 18,490 tokens, 180 W assumed.' },
    ];
    expect(checkScript(s, f, { maxSeconds: 180, firstStopBy: 20 })).toEqual([]);
  });
  it('flags a number that is not in the record (we copy numbers, we do not make them up)', () => {
    expect(checkScript([{ id: 's1', url: 'ui:#/receipt/2', en: 'We saved 91% of tokens.' }], f, { maxSeconds: 180 })).toEqual(['s1: number not in the record: 91']);
  });
  it('flags a tx prefix that is not in the record', () => {
    expect(checkScript([{ id: 's1', url: 'ui:#/receipt/2', en: 'See tx deadbe3f.' }], f, { maxSeconds: 180 })[0]).toContain('deadbe3f is not a tx');
  });
  it('flags the demo when the stop is not on screen before 0:20', () => {
    const late: Scene[] = [{ id: 's0', url: 'stage#title', en: words(60) }, { id: 's1', url: 'ui:#/receipt/2', en: 'stopped' }];
    expect(checkScript(late, f, { maxSeconds: 180, firstStopBy: 20 })[0]).toContain('before 0:20');
  });
  it('flags a script longer than the limit (estimate errs long)', () => {
    expect(estimateSeconds(words(26))).toBeCloseTo(10.9, 1);
    expect(checkScript([{ id: 's1', url: 'ui:#/receipt/2', en: words(500) }], f, { maxSeconds: 180 })[0]).toMatch(/^estimated \d+ s > 180 s/);
  });
});

describe('the real record (offline: session.json + answers log + A/B file)', () => {
  const real = recordFacts();
  it('facts come from the audit: 21 receipts (13 live during the window), 0 problems, the seller-not-listed stop is #2', () => {
    expect(real).toMatchObject({ receipts: 21, paid: 13, stopped: 8, replays: 1, problems: 0, paidUsdt: '30.00', merchantStopSeq: 2, kilnCalls: 41, callsPerPurchase: '1.00', flows: 3 });
    expect(real.attest).toEqual({ match: 15, shown: 15, otherAccount: 30, f1Before: 9, f1: 9, leadMin: 2, leadMax: 5 });
    expect(real.mcp).toEqual({ tools: 3, runs: 3, calls: 10, attempts: 6, perAttempt: '1.67' });
    expect(real.kept).toEqual({ usdt: '18.20', stops: 8 });
    expect(real.ab).toMatchObject({ n: 12, offTokens: 36, onTokens: 223, sameJson: 12 });
    expect(real.stopTx && real.grantTx && real.replayTx).toBeTruthy();
  });

  it('deck (AC-32): 8–10 slides (organizer: presentation PDF ≤ 10 pages), slide 1 = the README declared function, value + limits slides, no number outside the record', () => {
    const declared = readFileSync('README.md', 'utf8').match(/\*\*Declared function \(one sentence\):\*\* (.+)/)![1];
    const slides = deckSlides(real, declared);
    expect(slides.length).toBeGreaterThanOrEqual(8);
    expect(slides.length).toBeLessThanOrEqual(10);
    expect(slides[0].html).toContain(declared.slice(0, 60));
    expect(slides.map((s) => s.id)).toEqual(expect.arrayContaining(['boundaries', 'kiln', 'chain', 'evidence', 'value', 'limits']));
    for (const s of slides) expect([s.id, strayInCopy(slideText(s), real)]).toEqual([s.id, []]);
  });

  it('docs/qa.md: 10 judge questions, answers under the same number rule', () => {
    const qa = readFileSync('docs/qa.md', 'utf8');
    expect(qa.match(/^### Q\d+/gm)?.length).toBe(10);
    expect(strayInCopy(qa.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']'), real)).toEqual([]);
  });

  it('demo narration: ≤ 180 s, the stop on screen before 0:20, numbers and tx from the record', () => {
    const scenes = JSON.parse(readFileSync('docs/video/scenes-demo.json', 'utf8')) as Scene[];
    expect(checkScript(scenes, real, { maxSeconds: 180, firstStopBy: 20 })).toEqual([]);
  });

  it('pitch narration: ≤ 300 s, numbers and tx from the record', () => {
    const scenes = JSON.parse(readFileSync('docs/video/scenes-pitch.json', 'utf8')) as Scene[];
    expect(checkScript(scenes, real, { maxSeconds: 300 })).toEqual([]);
  });
});

describe('cost of one guarded decision in the facts (M1 review)', () => {
  it('Kiln F1 USD per purchase and median TRX per paid / stopped pay() come from the record files', () => {
    const c = recordFacts().cost!;
    expect(c).toEqual({ f1Usd: '0.0000348', paidTrx: '7.01', stopTrx: '2.80' });
  });
});
