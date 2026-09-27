// M1 review: what each vault decision cost on TRON Nile — fee (TRX) and energy per Paid / SpendBlocked tx of the live record.
// Keyless: public full-node API (gettransactioninfobyid). → docs/chain-cost-2026-09-28.json
import { readFileSync, writeFileSync } from 'node:fs';
import type { Session } from '../src/application/views';
import { chainCostSummary, txCostOf, type TxCost } from '../src/domain/chainCost';

const s = JSON.parse(readFileSync('web/public/session.json', 'utf8')) as Session;
const costs: TxCost[] = [];
for (const e of s.events) {
  if (e.kind !== 'paid' && e.kind !== 'blocked') continue;
  const res = await fetch('https://nile.trongrid.io/wallet/gettransactioninfobyid', { method: 'POST', body: JSON.stringify({ value: e.txHash }) });
  costs.push(txCostOf(await res.json(), e.kind === 'paid' ? 'paid' : 'stopped'));
  await new Promise((r) => setTimeout(r, 300));
}
const summary = chainCostSummary(costs);
writeFileSync('docs/chain-cost-2026-09-28.json', JSON.stringify({ source: 'https://nile.trongrid.io/wallet/gettransactioninfobyid (public, no key)', vault: s.vault, note: 'TRON Nile, energy burned from TRX (no staking); mainnet energy price differs', costs, summary }, null, 1) + '\n');
console.log(JSON.stringify(summary));
