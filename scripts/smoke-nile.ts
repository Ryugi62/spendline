// Read-only Nile check: block height, TRX + test-USDT balances of the generated accounts. Prints addresses and numbers only.
import { readFileSync } from 'node:fs';
import { TronWeb } from 'tronweb';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const tw = new TronWeb({ fullHost: env.TRON_FULLHOST });
tw.setAddress(env.OWNER_ADDRESS);
const block = await tw.trx.getCurrentBlock();
console.log('nile block', block.block_header.raw_data.number);
const usdt = await tw.contract().at(env.USDT_NILE);
for (const k of ['OWNER', 'AGENT']) {
  const a = env[`${k}_ADDRESS`];
  const trx = (await tw.trx.getBalance(a)) / 1e6;
  const u = Number(await usdt.balanceOf(a).call()) / 1e6;
  console.log(k.padEnd(6), a, 'TRX', trx, 'USDT', u);
}
