// UC-4 from public data only: receipts file + Nile events. No key is used for reading (address is set for TronWeb's API only).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TronChain } from '../src/adapters/tron';
import { audit } from '../src/domain/audit';
const file = process.argv[2] ?? 'docs/nile-smoke-2026-09-24.json';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const rec = JSON.parse(readFileSync(file, 'utf8'));
const { abi } = JSON.parse(readFileSync('dist/SpendlineVault.json', 'utf8'));
const chain = new TronChain({ fullHost: env.TRON_FULLHOST, agentKey: env.AGENT_PRIVATE_KEY, vault: rec.vault, abi });
const m = await chain.mandate();
const res = audit({ mandates: [{ ...m, paused: false }], receipts: rec.receipts, events: await chain.events(), hash: (s) => createHash('sha256').update(s).digest('hex') });
console.log(JSON.stringify({ vault: rec.vault, chain: res.chain, verdicts: res.verdicts.map((v) => `${v.seq}:${v.verdict}${v.reason ? '(' + v.reason + ')' : ''} ${v.txHash ?? ''}`), totalPaid: res.totalPaid }, null, 1));
