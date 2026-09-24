// Creates Nile test accounts once and appends them to .env (gitignored). Prints addresses only.
import { appendFileSync, readFileSync } from 'node:fs';
import { TronWeb } from 'tronweb';
const env = readFileSync('.env', 'utf8');
if (/OWNER_PRIVATE_KEY=\w/.test(env)) { console.log('wallets already exist'); process.exit(0); }
const names = ['OWNER', 'AGENT', 'MERCHANT_GPU', 'MERCHANT_KILN', 'MERCHANT_SHADY', 'FEE'];
let out = '';
for (const n of names) {
  const a = await TronWeb.createAccount();
  out += `${n}_ADDRESS=${a.address.base58}\n`;
  if (n === 'OWNER' || n === 'AGENT') out += `${n}_PRIVATE_KEY=${a.privateKey}\n`;
  console.log(n.padEnd(15), a.address.base58);
}
appendFileSync('.env', out);
