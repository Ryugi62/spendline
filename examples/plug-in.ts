// AC-37 — plugging Spendline into an agent loop you already have. The loop below is unchanged; only the wallet is swapped.
//
//   before:  const wallet = myWallet;                                   // pays whatever the planner asks
//   after:   const wallet = spendlineWallet({ chain, store, hash });    // same transfer(to, amount, memo) call
//            // chain = TronChain(vault address, agent key) · store = FileReceiptStore('receipts.jsonl') · hash = sha256
//
// Inside the line → paid (USDT moves in the vault's pay()). Outside → ok: false with the on-chain reason, and the stop is an event.
// Every attempt is a receipt; `npm run audit` rebuilds every verdict with no key. Run the example: `npm test -- plug-in`.

export type TransferResult = { ok: boolean; tx: string; reason?: string };
export type Wallet = { transfer(to: string, amount: number, memo?: string): Promise<TransferResult> };
export type Step = { to: string; amount: number; why: string };

/** An agent's existing pay loop (planner output → wallet). Nothing Spendline-specific in here. */
export async function agentLoop(plan: Step[], wallet: Wallet) {
  const log: { to: string; ok: boolean; tx: string; reason?: string }[] = [];
  for (const step of plan) {
    const r = await wallet.transfer(step.to, step.amount, step.why);
    log.push({ to: step.to, ok: r.ok, tx: r.tx, ...(r.reason ? { reason: r.reason } : {}) });
  }
  return log;
}
