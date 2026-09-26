import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { compile } from '../scripts/compile-contract.mjs';
import { BLOCK_REASONS, CHECK_ORDER } from '../src/domain/mandate';

describe('SpendlineVault.sol ↔ domain parity', () => {
  it('compiles without errors and exposes pay / pause / SpendBlocked / Paid', () => {
    const { abi, bytecode } = compile();
    const names = abi.map((x: { name?: string }) => x.name);
    for (const n of ['pay', 'pause', 'grant', 'check', 'Paid', 'SpendBlocked', 'MandateGranted']) expect(names).toContain(n);
    expect(bytecode.length).toBeGreaterThan(1000);
  });
  it('reason codes and check order are the same as BLOCK_REASONS', () => {
    const src = readFileSync('contracts/SpendlineVault.sol', 'utf8');
    const codes = [...src.matchAll(/uint8 public constant (\w+) = (\d+);/g)].map((m) => [m[1], Number(m[2])]);
    expect(codes).toEqual(BLOCK_REASONS.map((r, i) => [r, i + 1]));
    const checkBody = src.slice(src.indexOf('function check('), src.indexOf('return 0;'));
    const order = [...checkBody.matchAll(/return (\w+);/g)].map((m) => m[1]);
    expect(order).toEqual([...CHECK_ORDER]);
  });
  it('AC-25: pay() marks the receipt hash used before deciding, so a reused hash is always SpendBlocked(DUPLICATE_RECEIPT)', () => {
    const src = readFileSync('contracts/SpendlineVault.sol', 'utf8');
    expect(src).toMatch(/mapping\(bytes32 => bool\) public usedReceipt;/);
    expect(src).toMatch(/function check\(address merchant, uint256 amount, uint256 fee, bytes32 receiptHash\) public view returns \(uint8\) \{\s*if \(usedReceipt\[receiptHash\]\) return DUPLICATE_RECEIPT;/);
    const pay = src.slice(src.indexOf('function pay('), src.indexOf('function merchants('));
    const mark = pay.indexOf('usedReceipt[receiptHash] = true;');
    expect(mark).toBeGreaterThan(pay.indexOf('check(merchant, amount, fee, receiptHash)'));
    expect(mark).toBeLessThan(pay.indexOf('if (reason != 0)'));
    const { abi } = compile();
    expect(abi.map((x: { name?: string }) => x.name)).toContain('usedReceipt');
  });
});
