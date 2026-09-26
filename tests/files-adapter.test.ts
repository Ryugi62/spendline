import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonCatalog, JsonlAnswerLog } from '../src/adapters/files';
import type { AnswerRecord } from '../src/application/ports';

const dir = () => mkdtempSync(join(tmpdir(), 'spendline-'));
const rec = (key: string, text: string): AnswerRecord => ({ key, flow: 'F2_explain', seq: 1, verdict: 'PAID_INSIDE', text, grounded: true });

describe('file adapters', () => {
  it('JsonlAnswerLog: append-only lines; find returns the newest entry for a key; a missing file is an empty log', async () => {
    const path = join(dir(), 'answers.jsonl');
    const log = new JsonlAnswerLog(path);
    expect(await log.all()).toEqual([]);
    expect(await log.find('F2:a')).toBeUndefined();
    await log.append(rec('F2:a', 'first'));
    await log.append(rec('F2:b', 'other'));
    await log.append(rec('F2:a', 'second'));
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(3);
    expect((await new JsonlAnswerLog(path).find('F2:a'))?.text).toBe('second');
  });
  it('JsonlAnswerLog: a broken line is a typed error naming the line', async () => {
    const path = join(dir(), 'answers.jsonl');
    writeFileSync(path, JSON.stringify(rec('k', 'x')) + '\nnot json\n');
    await expect(new JsonlAnswerLog(path).all()).rejects.toThrow(/line 2/);
  });
  it('JsonCatalog: the committed Nile catalog gives offers per item and seller labels; a bad offer is refused', async () => {
    const c = JsonCatalog.fromFile('data/catalog.nile.json');
    const gpu = await c.offers('gpu-hours');
    expect(gpu.map((o) => o.label)).toEqual(['GPU Shop', 'Unknown seller']);
    expect(gpu.every((o) => Number.isInteger(o.unitPrice) && Number.isInteger(o.fee))).toBe(true);
    expect(Object.values(c.labels())).toEqual(['GPU Shop', 'Unknown seller', 'Kiln credits']);
    expect(() => new JsonCatalog({ offers: [{ merchant: 'T1', item: 'gpu-hours', unitPrice: -1, fee: 0, label: 'x' }] })).toThrow(/offer 1/);
  });
});
