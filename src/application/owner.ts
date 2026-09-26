import type { Mandate } from '../domain/mandate';
import { fmtUsdt } from '../domain/money';
import { canonical, type Hasher } from '../domain/receipt';
import { utc } from './explain';
import type { ChainPort } from './ports';
import { isTronAddress, txUrl } from './views';

/**
 * UC-1 grant and UC-3 stop, signed by the person's owner key on their own machine (M0-14).
 * Input = the JSON the Grant screen copies (`Omit<Mandate,'id'>`, micro-USDT), so the UI and the CLI speak one format.
 */
export type MandateDraft = Omit<Mandate, 'id'>;
export type DraftParse = { ok: true; draft: MandateDraft } | { ok: false; errors: string[] };

const whole = (x: unknown) => typeof x === 'number' && Number.isInteger(x);

export function parseMandateJson(text: string, now: number): DraftParse {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error();
  } catch {
    return { ok: false, errors: ["mandate.json isn't valid JSON"] };
  }
  const errors: string[] = [];
  const { budget, perTxCap, merchants, deadline, paused } = o;
  const micro = (name: string, x: unknown) => {
    if (typeof x === 'number' && x > 0 && !Number.isInteger(x)) errors.push(`${name} must be whole micro-USDT (1 USDT = 1000000) — the Grant screen writes it that way`);
  };
  if (!(typeof budget === 'number' && budget > 0)) errors.push('Enter a budget above 0 USDT');
  else micro('budget', budget);
  if (!(typeof perTxCap === 'number' && perTxCap > 0)) errors.push('Enter a per-payment cap above 0 USDT');
  else if (typeof budget === 'number' && budget > 0 && perTxCap > budget) errors.push("The per-payment cap can't be bigger than the budget");
  else micro('perTxCap', perTxCap);
  const list = Array.isArray(merchants) ? merchants : [];
  const bad = list.find((m) => typeof m !== 'string' || !isTronAddress(m));
  if (!list.length) errors.push('Add at least one seller address');
  else if (bad !== undefined) errors.push(`“${String(bad)}” doesn't look like a TRON address (T + 33 letters or digits)`);
  if (!(whole(deadline) && (deadline as number) > now)) errors.push(`The deadline is not in the future (chain time now ${utc(now)})`);
  if (paused === true) errors.push('paused must be false — to stop the agent, run npm run stop');
  if (errors.length) return { ok: false, errors };
  return { ok: true, draft: { budget: budget as number, perTxCap: perTxCap as number, merchants: list as string[], deadline: deadline as number, paused: false } };
}

/** bytes32: the line itself + the chain time it was granted at, so the same line granted twice gets two ids. */
export const mandateIdOf = (d: MandateDraft, now: number, hash: Hasher) => `0x${hash(`${canonical(d)}|${now}`)}`;

export async function grantLine(chain: ChainPort, draft: MandateDraft, now: number, hash: Hasher): Promise<{ mandate: Mandate; txHash: string }> {
  const mandate: Mandate = { id: mandateIdOf(draft, now, hash), ...draft, paused: false };
  return { mandate, txHash: await chain.grant(mandate) };
}

export const stopAgent = (chain: ChainPort): Promise<string> => chain.pause();

export function formatOwnerResult(kind: 'grant' | 'stop', txHash: string, m?: Mandate): string {
  const tx = `tx ${txHash} · ${txUrl(txHash)}`;
  if (kind === 'stop') return `STOP signed · the vault refuses every payment until a new grant\n${tx}`;
  const n = m!.merchants.length;
  return `granted · mandate ${m!.id} · ${fmtUsdt(m!.budget)} USDT · cap ${fmtUsdt(m!.perTxCap)} · ${n} seller${n === 1 ? '' : 's'} · deadline ${utc(m!.deadline)}\n${tx}`;
}
