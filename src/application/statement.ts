// AC-41 / AC-42 — formatting for the lead: a statement an accountant can file, and the diff a candidate line would make.
import { fmtUsdt } from '../domain/money';
import type { Statement, TuneResult } from '../domain/statement';

const kst = (unix: number) => new Date((unix + 9 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19);
const cell = (s: string) => s.replace(/\|/g, '\\|');
const micro6 = (n: number) => (n / 1e6).toFixed(6);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function formatStatementMd(s: Statement, o: { network: string; title: string }): string {
  const tx = (h?: string) => (h ? `[${h.slice(0, 8)}…](https://${o.network}.tronscan.org/#/transaction/${h})` : '—');
  let md = `# Spend statement — ${o.title}\n\n`;
  md += `Paid inside the line: ${fmtUsdt(s.totalPaid)} USDT · Kept in the vault by the line: ${fmtUsdt(s.totalKept)} USDT (${plural(s.stopsByReason.reduce((n, x) => n + x.count, 0), 'stop')}) · `;
  md += s.problems ? `**${plural(s.problems, 'problem')}** (the audit could not rebuild ${s.problems === 1 ? 'it' : 'them'} — not counted as paid)` : '0 problems';
  md += ` · Guarding cost: ${plural(s.kilnCalls, 'Kiln call')}, $${s.kilnUsd.toFixed(7)}\n\n`;
  md += `Every verdict below is the keyless audit's (\`npm run audit\`), not this app's claim; every tx is public on TRON ${o.network}.\n\n`;
  md += `| Paid to | Payments | USDT (incl. fee) |\n|---|---:|---:|\n` + s.paidBySeller.map((x) => `| ${cell(x.seller)} | ${x.count} | ${fmtUsdt(x.total)} |`).join('\n') + '\n\n';
  md += `| Stopped on-chain because | Attempts | USDT kept |\n|---|---:|---:|\n` + s.stopsByReason.map((x) => `| ${x.reason} | ${x.count} | ${fmtUsdt(x.kept)} |`).join('\n') + '\n\n';
  md += `| # | Time (KST) | Seller | Request words | USDT | Fee | Verdict | On-chain tx |\n|---:|---|---|---|---:|---:|---|---|\n`;
  md += s.lines.map((l) => `| ${l.seq} | ${kst(l.at)} | ${cell(l.seller)} | ${cell(l.words)} | ${fmtUsdt(l.amount)} | ${fmtUsdt(l.fee)} | ${l.verdict === 'PAID' ? 'paid' : l.verdict === 'STOPPED' ? `stopped · ${l.reason}` : `**problem · ${l.reason}**`} | ${tx(l.txHash)} |`).join('\n') + '\n';
  return md;
}

export function formatStatementCsv(s: Statement): string {
  const q = (t: string) => `"${t.replace(/"/g, '""')}"`;
  const head = 'seq,time_kst,seller,words,amount_usdt,fee_usdt,verdict,reason,tx,receipt_hash';
  return [head, ...s.lines.map((l) => [l.seq, kst(l.at), l.seller.includes(',') ? q(l.seller) : l.seller, q(l.words), micro6(l.amount), micro6(l.fee), l.verdict, l.reason ?? '', l.txHash ?? '', l.receiptHash].join(','))].join('\n') + '\n';
}

export function formatTune(t: TuneResult, o: { labels: Record<string, string> }): string {
  const name = (m: string) => o.labels[m] ?? m;
  const rec = { paid: t.rows.filter((x) => x.recorded === 'PAID').length };
  const out = [
    `Under the candidate line: ${t.candidateTotals.paid} paid · ${t.candidateTotals.stopped} stopped · ${fmtUsdt(t.candidateTotals.spent)} USDT spent (recorded: ${rec.paid} paid)`,
    `${plural(t.changed.length, 'request')} would end differently${t.changed.length ? ':' : '.'}`,
    ...t.changed.map((x) => `  #${x.seq} ${name(x.seller)} ${fmtUsdt(x.amount + x.fee)} USDT: ${x.recorded} → ${x.candidate}`),
    'Same rule and order as the vault (evaluate()); STOP and deadline stops are kept as recorded; nothing is sent to the chain.',
  ];
  return out.join('\n');
}
