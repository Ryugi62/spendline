import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditExitCode, auditRecords, formatAuditReport, parseReceiptsFile, ReceiptsFileError } from '../src/application/auditRecords';
import type { ChainEvent } from '../src/domain/audit';
import type { Mandate } from '../src/domain/mandate';
import { usdt } from '../src/domain/money';
import { GENESIS, sealReceipt, type Receipt } from '../src/domain/receipt';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const m: Mandate = { id: '0xaa', budget: usdt(10), perTxCap: usdt(8), deadline: 1_000, merchants: ['TGpuShop'], paused: false };

function twoReceipts(): Receipt[] {
  const r1 = sealReceipt(GENESIS, { seq: 1, mandateId: m.id, request: { merchant: 'TGpuShop', amount: usdt(4.8), fee: usdt(0.2), at: 100 }, intentText: '2 GPU hours', flows: [] }, sha);
  const r2 = sealReceipt(r1.hash, { seq: 2, mandateId: m.id, request: { merchant: 'TShady', amount: usdt(1.8), fee: 0, at: 200 }, intentText: 'cheap seller', flows: [] }, sha);
  return [r1, r2];
}
function eventsFor(rs: Receipt[]): ChainEvent[] {
  return [
    { kind: 'granted', mandate: m, at: 50, txHash: 'g1' },
    { kind: 'paid', receiptHash: rs[0].hash, merchant: 'TGpuShop', amount: usdt(4.8), fee: usdt(0.2), at: 100, txHash: 'tx1' },
    { kind: 'blocked', receiptHash: rs[1].hash, merchant: 'TShady', amount: usdt(1.8), fee: 0, at: 200, reason: 'MERCHANT_NOT_ALLOWED', txHash: 'tx2' },
  ];
}

describe('receipts file (AC-12)', () => {
  it('reads .jsonl (one receipt per line, blank lines ignored) and a run JSON {vault, receipts}', () => {
    const rs = twoReceipts();
    expect(parseReceiptsFile(rs.map((r) => JSON.stringify(r)).join('\n') + '\n\n').receipts).toEqual(rs);
    const run = parseReceiptsFile(JSON.stringify({ vault: 'TVault', receipts: rs, other: 1 }));
    expect(run.vault).toBe('TVault');
    expect(run.receipts).toHaveLength(2);
  });
  it('names the line of a broken record', () => {
    const rs = twoReceipts();
    const text = [JSON.stringify(rs[0]), '{"seq": 2, "oops"', JSON.stringify(rs[1])].join('\n');
    expect(() => parseReceiptsFile(text)).toThrow(ReceiptsFileError);
    try {
      parseReceiptsFile(text);
    } catch (e) {
      expect((e as ReceiptsFileError).line).toBe(2);
    }
    expect(() => parseReceiptsFile('{"seq":1}')).toThrow(/line 1/);
  });
});

describe('audit report (AC-13)', () => {
  it('one line per receipt + summary; exit 0 only when every receipt is inside or stopped and the chain is intact', async () => {
    const rs = twoReceipts();
    const res = await auditRecords({ events: { events: async () => eventsFor(rs) }, hash: sha }, { vault: 'TVault', receipts: rs });
    const text = formatAuditReport(res, { vault: 'TVault', source: 'test' });
    const lines = text.split('\n');
    expect(lines.filter((l) => /^#\d+ /.test(l))).toHaveLength(2);
    expect(text).toMatch(/#1 PAID_INSIDE .*tx1/);
    expect(text).toMatch(/#2 STOPPED MERCHANT_NOT_ALLOWED .*tx2/);
    expect(text).toMatch(/1 paid inside · 1 stopped · 0 mismatch · 0 without chain event/);
    expect(auditExitCode(res)).toBe(0);

    const missing = await auditRecords({ events: { events: async () => eventsFor(rs).slice(0, 2) }, hash: sha }, { vault: 'TVault', receipts: rs });
    expect(auditExitCode(missing)).toBe(1);
    const tampered = await auditRecords({ events: { events: async () => eventsFor(rs) }, hash: sha }, { vault: 'TVault', receipts: [rs[0], { ...rs[1], intentText: 'edited' }] });
    expect(tampered.chain).toEqual({ ok: false, brokenAt: 2 });
    expect(auditExitCode(tampered)).toBe(1);
  });
});

describe('keyless CLI (AC-15)', () => {
  it('runs in a directory with no .env and no key, from saved public events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spendline-audit-'));
    expect(existsSync(join(dir, '.env'))).toBe(false);
    const rs = twoReceipts();
    writeFileSync(join(dir, 'receipts.jsonl'), rs.map((r) => JSON.stringify(r)).join('\n'));
    writeFileSync(join(dir, 'events.json'), JSON.stringify(eventsFor(rs)));
    const cli = resolve('src/infrastructure/audit-cli.ts');
    const tsx = resolve('node_modules/.bin/tsx');
    const out = spawnSync(tsx, [cli, 'receipts.jsonl', '--vault', 'TVault', '--events', 'events.json'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/2 receipts/);
    expect(out.stdout).toMatch(/→ OK/);
  }, 30_000);
});
