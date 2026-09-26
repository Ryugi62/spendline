// UC-1 / UC-3 composition root — the PERSON signs, on their own machine, with the owner key from .env (M0-14):
//   npm run grant -- mandate.json [--vault T…] [--json]     (mandate.json = what the Grant screen's "Copy the mandate" gives)
//   npm run stop [-- --vault T…] [--json]
// Prints tx hashes and public numbers only. The key never leaves .env.
import { readFileSync } from 'node:fs';
import { TronChain } from '../adapters/tron';
import { formatOwnerResult, grantLine, parseMandateJson, stopAgent } from '../application/owner';
import { flag, need, positionals, readEnv, sha256, vaultOf } from './runtime';
// @ts-expect-error plain ESM script without types
import { compile } from '../../scripts/compile-contract.mjs';

const USAGE = 'usage: npm run grant -- mandate.json [--vault T…]  |  npm run stop [-- --vault T…]';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(args: string[]): Promise<number> {
  const [cmd, file] = positionals(args, ['--json']);
  if (cmd !== 'grant' && cmd !== 'stop') return console.error(USAGE), 2;
  if (cmd === 'grant' && !file) return console.error(USAGE), 2;
  const env = readEnv();
  need(env, 'OWNER_PRIVATE_KEY', 'TRON_FULLHOST');
  const vault = vaultOf(env, flag(args, '--vault'));
  if (!vault) throw new Error('no vault: pass --vault T…');
  const chain = new TronChain({ fullHost: env.TRON_FULLHOST, ownerKey: env.OWNER_PRIVATE_KEY, vault, abi: compile().abi });
  const json = args.includes('--json');

  if (cmd === 'grant') {
    const now = await chain.now();
    const p = parseMandateJson(readFileSync(file, 'utf8'), now);
    if (!p.ok) {
      console.error(`${file} was not signed:\n- ${p.errors.join('\n- ')}`);
      return 1;
    }
    const g = await grantLine(chain, p.draft, now, sha256);
    for (let i = 0; i < 20 && (await chain.mandate()).id.toLowerCase() !== g.mandate.id; i++) await sleep(3000); // the line is in force
    console.log(json ? JSON.stringify({ kind: 'grant', vault, txHash: g.txHash, mandate: g.mandate }) : formatOwnerResult('grant', g.txHash, g.mandate));
    return 0;
  }
  const tx = await stopAgent(chain);
  for (let i = 0; i < 20 && !(await chain.mandate()).paused; i++) await sleep(3000); // STOP is in force
  console.log(json ? JSON.stringify({ kind: 'stop', vault, txHash: tx }) : formatOwnerResult('stop', tx));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  },
);
