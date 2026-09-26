import { describe, expect, it } from 'vitest';
import { decodePayLog } from '../src/adapters/tron';

// Real Nile tx infos (public, /wallet/gettransactioninfobyid, 2026-09-26) of the v0.1 vault TNw1jz… (hex 8e2f676e…).
const VAULT_HEX = '418e2f676e82cd7f690915a84109ce223c7886defb';
const blocked = {
  blockTimeStamp: 1790230098000,
  receipt: { result: 'SUCCESS' },
  log: [
    {
      address: '8e2f676e82cd7f690915a84109ce223c7886defb',
      topics: ['0b595aceec0a4e9ecf0dc0cb28a49734fd303f18271afa4899ad0c80dfdea6d7', '06a3710106484ea63c9279a3adfc5992087c292d31c11467e7bb6e6f33eed766', '1a13ae1a67e6e5e953416c741814132e509a83c2dc80804b7d5a126281f162aa'],
      data: '000000000000000000000000b8afa1a0f96e208d0f8e699b2aa63a28a370cfda00000000000000000000000000000000000000000000000000000000001b774000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003',
    },
  ],
};
const paid = {
  blockTimeStamp: 1790230041000,
  receipt: { result: 'SUCCESS' },
  log: [
    { address: 'eca9bc828a3005b9a3b909f2cc5c2a54794de05f', topics: ['ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'], data: '00' }, // USDT Transfer
    {
      address: '8e2f676e82cd7f690915a84109ce223c7886defb',
      topics: ['072cc6c51a329c05c701e430a01313a6bfb7168972415a0ba6603204f5562f5d', 'a3979caaf684ed2e4ea4b257e4cf409c9382d3c1c0394326a869e0985fa2496b', '1a13ae1a67e6e5e953416c741814132e509a83c2dc80804b7d5a126281f162aa'],
      data: '0000000000000000000000005617316339fc5b5938a22952c3c75de9871a812d0000000000000000000000000000000000000000000000000000000000493e000000000000000000000000000000000000000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000004c4b40',
    },
  ],
};

describe('pay() outcome from the tx info log (no wait on the event API, ≈50 s lag measured 2026-09-24)', () => {
  it('SpendBlocked → blocked with the reason code in the last data word; receipt hash from topic 1', () => {
    expect(decodePayLog(blocked, VAULT_HEX)).toEqual({ kind: 'blocked', reason: 'MERCHANT_NOT_ALLOWED', receiptHash: '06a3710106484ea63c9279a3adfc5992087c292d31c11467e7bb6e6f33eed766', at: 1790230098 });
  });
  it('Paid → paid (a USDT Transfer log from another contract is ignored)', () => {
    expect(decodePayLog(paid, VAULT_HEX)).toEqual({ kind: 'paid', receiptHash: 'a3979caaf684ed2e4ea4b257e4cf409c9382d3c1c0394326a869e0985fa2496b', at: 1790230041 });
  });
  it('a log from another address, or no vault log, → undefined (caller falls back to the event API)', () => {
    expect(decodePayLog(blocked, '41' + '0'.repeat(40))).toBeUndefined();
    expect(decodePayLog({ blockTimeStamp: 1, log: [] }, VAULT_HEX)).toBeUndefined();
  });
});
