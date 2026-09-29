# Spendline — ten questions a judge will ask (with the answer and where to check it)

Every number here comes from the public record (`npm run audit`, `npm run attest -- --saved`, `docs/tokens-by-flow.md`) or is a stated assumption; `tests/pitch.test.ts` fails the build if one does not.

### Q1 (Kiln) Is Kiln doing real work, or is it decoration?
Every purchase starts with one Kiln call (flow F1): the request words become `{item, quantity, maxUnitPrice?, merchantHint?}`, and that JSON decides which seller and how much — code prices it. A general agent can also plan on Kiln through Spendline's MCP tools (flow F4). F2 explains a receipt and F3 settles a teammate's question. 57 live calls, each with its Kiln generation id in [docs/tokens-by-flow.md](tokens-by-flow.md) and the README proof tables. And Kiln is the second witness: `npm run attest` asks Kiln's own record (`GET /v1/generations/{id}`) about every call on the organizer-issued account — 29 of 29 rows match (model, tokens, cost), 16 of 16 paying calls are dated 2–10 s before their `pay()`, and where the receipt carries the model's own arguments, code re-derives the payment from them ([docs/kiln-attest.txt](kiln-attest.txt)).

### Q2 (Kiln) Why only one call per purchase — wouldn't a planning loop be smarter?
The decision that matters (pay or not) is a rule, so it is code and chain, not a model: the offer choice, the micro-USDT math and the receipt cost 0 calls. 1.00 LLM call per purchase on Spendline's own path, against a design limit of 2. A general MCP host planning on Kiln took 1.15 calls per pay attempt (15 calls, 13 attempts, 5 runs — Kiln once returned three tool calls in one reply) with longer prompts: MCP is for an agent that already has a planner; F1 stays the efficient path.

### Q3 (FuriosaAI) How honest is the energy number?
It is an estimate and says so everywhere: Wh = 180 W (RNGD card TDP, furiosa.ai/rngd) × time. On client wall time (network included — an upper bound): 6.60 Wh for 57 calls. On Kiln's own clock (`latency_ms` in the generation record): median 879 ms, ≈0.0440 Wh per call. Kiln exposes no power telemetry, so we do not claim a measurement. Kiln's record also shows 35% of the attested prompt tokens were served from its cache.

### Q4 (FuriosaAI) Did you measure what `/no_think` saves?
Yes, n = 12 paired runs of the same request: median 36 vs 223 output tokens, 0.95 vs 3.50 s, same JSON in 12 of 12 pairs — 84% fewer output tokens. Raw calls with generation ids: `docs/ab-no-think-2026-09-26.json`.

### Q5 (Bricksum) What stops the model from making things up — in F2 / F3, or in a payment?
The audit computes the facts; the model only phrases them. An F2 / F3 reply must repeat the audit's verdict and reason and may contain no number that is not in the facts — otherwise the code's template is shown. For payments, the model never sets an amount: on the MCP path it names seller, item and quantity and code prices it from the catalog; the receipt keeps the model's own arguments, and `attest` re-derives the payment from them.

### Q6 (Web3) Where exactly is the line enforced — the app could just skip the check?
On-chain, in `SpendlineVault.pay()` → `check()`. The agent key can only call `pay()`; only the owner key can grant, STOP, resume or withdraw. A refusal is not a revert: it emits `SpendBlocked` with the reason, so 12 stops (seller not listed, over budget with fees, STOP, deadline) plus 5 repeats refused as replays are in the vault's public history — every stop type again on the organizer account, Kiln-attested.

### Q7 (Web3) Why should I trust your receipts file?
You don't have to. `npm run audit` needs no key and no `.env`: it re-hashes the chain of 28 receipts, matches each to the vault's public event by receipt hash (1 : 1), and re-runs the rule with the line in force at that moment. Editing a receipt breaks the hash chain; dropping one leaves a vault event with no receipt — both exit 1. Today: 0 problems, 36.20 USDT paid inside. And the model calls behind the receipts are checked against Kiln's record, not our word (Q1).

### Q8 (VC) Who pays for this, and why not an existing agent wallet?
Hypothesis, not validated: teams that let agents buy compute, credits or API time need a record a finance or compliance reader can check without trusting the operator. Allowance-style limits (Safe's allowance module, `ERC-4337` session keys, Coinbase spend permissions) enforce a cap, and payment rails like `x402` move money per request; as far as their public docs show, a refused transfer simply reverts, so nothing records what the agent tried or who allowed what. Spendline's parts are the record: the stop as an event, the receipt bound to the model call and to Kiln's own record, and a keyless replay audit. It plugs in two ways: as an MCP server any agent host adds (driven by the official MCP Inspector, and live with Qwen3-32B on Kiln as the host), or as a drop-in `spendlineWallet(…)`. The lead's week closes with `npm run statement` (a CSV for the accountant; 12 refused attempts, 5 repeats refused as replays, an intent flag when the words named another seller) and `npm run tune` (what next week's line would have done). One guarded decision: Kiln F1 $0.0000197 (mean) plus 7.01 TRX for a paid `pay()` or 2.80 TRX for a stopped one (median) — `docs/chain-cost-2026-09-28.json`. Open vault and audit (Apache-2.0); a hosted audit with alerts on stops is the paid layer.

### Q9 (Organizer) Was this built during the hackathon?
Partly before, and we say which part. The organizer's group said work could start early; the Korean page says the first commit comes after the window opens. We asked in writing, got no answer, and list every commit with its time and window side in [docs/commits.md](commits.md), and the features by version in the README timeline.

### Q10 (Organizer) What is not done?
Testnet only (TRON Nile, test USDT — the brief asks for devnet or testnet). One line per vault and one agent key. Signing is a command on the person's machine, not a browser button, so keys never enter the page. No signed one-off approval of a single stopped payment: to allow it, the person grants a new line. Energy is an estimate. The 30 model calls made before the organizer's account existed can only be attested with that personal key or by Bricksum. The README's "Known limits" lists these next to the evidence.
