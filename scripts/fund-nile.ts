// The owner tops up the live vault with test USDT and the agent with test TRX for gas (TRON Nile testnet; keys from .env, never printed).
// usage: npm run fund -- [--usdt 20] [--agent-trx 100] [--vault T…]   → tx ids (public)
import { TronWeb } from 'tronweb';
import { usdt } from '../src/domain/money';
import { flag, need, readEnv, vaultOf } from '../src/infrastructure/runtime';

const args = process.argv.slice(2);
const env = readEnv();
need(env, 'OWNER_PRIVATE_KEY', 'AGENT_PRIVATE_KEY', 'TRON_FULLHOST', 'USDT_NILE');
const vault = vaultOf(env, flag(args, '--vault'))!;
const owner = new TronWeb({ fullHost: env.TRON_FULLHOST, privateKey: env.OWNER_PRIVATE_KEY });
const agent = TronWeb.address.fromPrivateKey(env.AGENT_PRIVATE_KEY) as string;
const out: Record<string, string> = {};
const u = Number(flag(args, '--usdt') ?? 0);
if (u > 0) {
  const c = await owner.contract().at(env.USDT_NILE);
  out.vaultUsdt = await c.transfer(vault, usdt(u)).send({ feeLimit: 100_000_000 });
}
const t = Number(flag(args, '--agent-trx') ?? 0);
if (t > 0) out.agentTrx = (await owner.trx.sendTransaction(agent, Math.round(t * 1e6))).txid;
console.log(JSON.stringify({ vault, agent, ...out }));
