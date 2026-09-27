# Spendline — ten questions a judge will ask (with the answer and where to check it)

Every number here comes from the public record (`npm run audit`, `docs/tokens-by-flow.md`) or is a stated assumption; `tests/pitch.test.ts` fails the build if one does not.

### Q1 (Kiln) Is Kiln doing real work, or is it decoration?
Every purchase starts with one Kiln call (flow F1): the request words become `{item, quantity, maxUnitPrice?, merchantHint?}`, and that JSON decides which seller and how much. The seller hint is how "buy from that cheap seller" reached the vault and was stopped (receipt #2). F2 explains a receipt and F3 settles a teammate's question. 26 live calls in 3 flows, each with its Kiln generation id in [docs/tokens-by-flow.md](tokens-by-flow.md).

### Q2 (Kiln) Why only one call per purchase — wouldn't a planning loop be smarter?
The decision that matters (pay or not) is a rule, so it is code and chain, not a model: the offer choice, the micro-USDT math and the receipt cost 0 calls. 1.00 LLM call per purchase against a design limit of 2. Every call not made is energy not spent.

### Q3 (FuriosaAI) How honest is the energy number?
It is an estimate and says so everywhere: Wh = 180 W (RNGD card TDP, furiosa.ai/rngd) × wall time measured at the client, which includes network time — an upper bound. Kiln exposes no power telemetry, so we do not claim a measurement. Total 3.33 Wh for 26 calls; 0.10 Wh per purchase.

### Q4 (FuriosaAI) Did you measure what `/no_think` saves?
Yes, n = 12 paired runs of the same request: median 36 vs 223 output tokens, 0.95 vs 3.50 s, same JSON in 12 of 12 pairs — 84% fewer output tokens. Raw calls with generation ids: `docs/ab-no-think-2026-09-26.json`.

### Q5 (Bricksum) What stops the model from making things up in F2 / F3?
The audit computes the facts; the model only phrases them. Its reply must repeat the audit's verdict and reason, and may contain no number that is not in the facts — otherwise the code's template is shown and the reply is marked rejected. The UI shows the model's words only under the audit's verdict, labelled as Kiln's.

### Q6 (Web3) Where exactly is the line enforced — the app could just skip the check?
On-chain, in `SpendlineVault.pay()` → `check()`. The agent key can only call `pay()`; only the owner key can grant, STOP, resume or withdraw. A refusal is not a revert: it emits `SpendBlocked` with the reason, so 4 stops (seller not listed, over budget with fees, STOP, deadline) plus 1 replayed receipt are in the vault's public history.

### Q7 (Web3) Why should I trust your receipts file?
You don't have to. `npm run audit` needs no key and no `.env`: it re-hashes the chain of 8 receipts, matches each to the vault's public event by receipt hash (1 : 1), and re-runs the rule with the line in force at that moment. Editing a receipt breaks the hash chain; dropping one leaves a vault event with no receipt — both exit 1. Today: 0 problems, 13.60 USDT paid inside.

### Q8 (VC) Who pays for this?
Hypothesis, not validated: teams that let agents buy compute, credits or API time need a record a finance or compliance reader can check without trusting the operator. The vault and the audit stay open (Apache-2.0); a hosted audit with alerts on stops is the paid layer. It plugs in where an agent would call a wallet — it calls `vault.pay(…, receiptHash)` instead.

### Q9 (Organizer) Was this built during the hackathon?
Partly before, and we say which part. The organizer's group said work could start early; the Korean page says the first commit comes after the window opens. We asked in writing, got no answer, and list every commit before and during the window in the README, by hash and time.

### Q10 (Organizer) What is not done?
Testnet only (TRON Nile, test USDT — the brief asks for devnet or testnet). One line per vault. Signing is a command on the person's machine, not a browser button, so keys never enter the page. Energy is an estimate. The README's "Known limits" lists these next to the evidence.
