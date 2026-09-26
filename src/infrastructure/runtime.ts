// Shared composition helpers for the CLIs. Reads `.env` (gitignored) — values are never printed.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { KilnLlm } from '../adapters/kiln';

export type Env = Record<string, string>;
export const LIVE_RECEIPTS = 'docs/receipts-nile-live.jsonl';
export const LIVE_ANSWERS = 'docs/answers-nile-live.jsonl';
export const CATALOG = 'data/catalog.nile.json';

export function readEnv(path = '.env'): Env {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The live vault (v0.6, refuses a reused receipt hash) if deployed, else the v0.1 vault. */
export const vaultOf = (env: Env, flag?: string) => flag ?? env.VAULT_V2_ADDRESS ?? env.VAULT_ADDRESS;

export function need(env: Env, ...keys: string[]) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing in .env: ${missing.join(', ')} (see .env.example)`);
}

export function kilnFrom(env: Env): KilnLlm {
  need(env, 'KILN_API_KEY');
  return new KilnLlm({ apiKey: env.KILN_API_KEY, baseUrl: env.KILN_BASE_URL, model: env.KILN_MODEL });
}

export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
/** Positional arguments (not a flag, not a flag's value). Boolean flags listed in `bools` take no value. */
export function positionals(args: string[], bools: string[] = []): string[] {
  return args.filter((a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') && !bools.includes(args[i - 1])));
}
