import { describe, expect, it } from 'vitest';
import { usageLine } from '../src/application/explain';
import { checkTranscript, terminalScene } from '../src/application/terminal';
import type { Receipt } from '../src/domain/receipt';

const base = { flow: 'F1_intent' as const, promptTokens: 321, completionTokens: 20, costUsd: 0.00001932, latencyMs: 1679, generationId: 'gen-9' };

describe('AC-35 the report line says how F1 got its intent and the server time', () => {
  it('tool call · leaked call · JSON in text, and server seconds, only when the record carries them', () => {
    expect(usageLine({ ...base, via: 'tool_call', serverMs: 433 })).toMatch(/· 1\.68 s · server 0\.43 s · .* · via tool call$/);
    expect(usageLine({ ...base, via: 'tool_call_in_text' })).toMatch(/· via tool call leaked into text$/);
    expect(usageLine({ ...base, via: 'text', serverMs: 433 })).toMatch(/· via JSON in text \(tool offered\)$/);
    expect(usageLine(base)).toBe('Kiln qwen3-32b · F1_intent · 321+20 tokens · 1.68 s · $0.00001932 · gen gen-9 · ≈0.0840 Wh');
  });
});

const receipt = (seq: number, via: 'tool_call' | 'text', serverMs: number, hash: string): Receipt =>
  ({ seq, mandateId: '0xm', request: { merchant: 'TK', amount: 2_000_000, fee: 0, at: 1 }, intentText: 'x', flows: [{ ...base, via, serverMs, generationId: `gen-${seq}` }], prevHash: '0', hash }) as Receipt;
const r9 = receipt(9, 'text', 433, 'fbe73f');
const r10 = receipt(10, 'tool_call', 512, 'aa11bb');
const t9 = '$ npm run agent -- "Top up"\n2026-09-28T12:56:32Z\n#9 PAID · 2.00 USDT to Kiln credits (2.00 + fee 0.00) · Paid inside your line\ntx 6ee1a15f0123 · https://nile.tronscan.org/#/transaction/6ee1a15f0123\nKiln qwen3-32b · F1_intent · gen gen-9';

describe('AC-36 the terminal scene comes only from the transcripts and the record', () => {
  it('a transcript is accepted when its receipt seq, tx and generation id are in the record', () => {
    expect(checkTranscript(t9, [r9, r10], ['6ee1a15f0123'])).toEqual([]);
  });
  it('a transcript naming a receipt, tx or generation id that is not in the record is refused', () => {
    expect(checkTranscript(t9.replace('#9', '#11'), [r9, r10], ['6ee1a15f0123'])).toEqual(['receipt #11 is not in the record']);
    expect(checkTranscript(t9, [r9, r10], ['ffff'])).toEqual(['tx 6ee1a15f0123 is not in the record']);
    expect(checkTranscript(t9.replace('gen gen-9', 'gen gen-x'), [r9, r10], ['6ee1a15f0123'])).toEqual(['generation gen-x is not on receipt #9']);
  });
  it('the scene lists each transcript with its receipt: via and server time read from the record', () => {
    const s = terminalScene([t9], [r9, r10]);
    expect(s).toEqual([{ seq: 9, transcript: t9, via: 'JSON in text (tool offered)', serverS: '0.43', latencyS: '1.68' }]);
  });
});
