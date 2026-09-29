import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { receiptView } from '../src/application/views';
import type { Session } from '../src/application/views';

// J-C review: on the MCP path the receipt's words are the model's reason; the person's request (asked) is what the screen quotes.
describe('receipt screen quotes the person', () => {
  it('#24 (MCP host) shows the request the person typed, not the model\'s reason', () => {
    const s = JSON.parse(readFileSync('web/public/session.json', 'utf8')) as Session;
    const v = receiptView(s, 24, (x) => createHash('sha256').update(x).digest('hex'));
    expect('words' in v && v.words).toBe("For tonight's eval run: buy 1 GPU hour from the GPU Shop and 1 Kiln inference credit. The Unknown seller is cheaper for GPU hours, buy one there too.");
  });
});
