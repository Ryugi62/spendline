# Spendline — SPEC (SDD, v0.1 2026-09-24)

> GWDC 2026 Korea Hackathon · FuriosaAI × Bricksum "Agent Finance" track · Challenge B (covers A's condition checks).
> Brief (verbatim source): https://docs.google.com/document/d/13qh7oePGl7Flrl-Zh_A6hfr02L266PvS — model changed to **Qwen3-32B** (Bricksum, TG 2026-09-22).
> v0.1 = template + domain core written **before** the 48h window (organizer TG 2026-09-22 "you can start working on your project right now");
> everything built before 2026-09-28 19:00 KST is listed in README "Built before / during the hackathon".

## 0. One line
Spendline is the wallet-and-policy layer for an AI agent that spends: a person grants a USDT budget with a merchant list and a deadline,
the agent (Qwen3-32B on Kiln) proposes purchases, a policy vault on TRON Nile pays only inside the line and **records every stop on-chain**,
and anyone can reconstruct from the receipts alone whether a payment was allowed.
Essence: not "an agent that can pay" but "**a payment that can prove it was allowed**".

## 1. Success (numbers) · deadline · non-goals
- Reference: none public for Kiln × on-chain spend receipts (checked TG group 2026-09-24) → judged against the brief's 5 acceptance criteria.
- Success: every brief criterion has a named artifact (README table) · ≥3 boundary runs stopped and recorded on-chain (fees, merchant, deadline) ·
  1 human STOP run · ≥2 successful paid runs · verifier reproduces all verdicts from `receipts.jsonl` + chain only (0 mismatches) ·
  token report per flow (≥3 flows) · Wh estimate per completed purchase with stated assumptions · LLM calls per purchase ≤2.
- Deadline: submission 2026-09-30 12:00 KST (platform auto-lock). Internal v1 freeze 2026-09-29 20:00.
- Non-goals: mainnet, real money, custody of user keys in the browser, multi-chain, a general chat assistant.

## 2. Constraints (verbatim where it matters)
- "all AI-related inference and decision-making processes must go through the Kiln API" (Bricksum, TG 2026-09-21).
- Kiln: OpenAI-compatible `https://api.bricksum.com/v1`; qwen3-32b = tool calling auto only (no forced / parallel), **no structured outputs** (response_format unsupported),
  thinking mode yes, 32,768 ctx, 60 RPM / 8 concurrent per org, `usage.cost` + header `X-Neocloud-Generation-Id` per request.
- Chain: TRON Nile testnet (`https://nile.trongrid.io`), test USDT TRC20 `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` (nileex.io faucet).
- Secrets only in `.env*` (gitignored). No private key in logs, receipts, video or README.

## 3. Ubiquitous language (= code identifiers)
| Term | Meaning | Code |
|---|---|---|
| Mandate | the line the user drew: budget, per-payment cap, merchant list, deadline, paused flag | `Mandate` |
| Spend request | one payment the agent wants: merchant, amount, fee | `SpendRequest` |
| Decision | allow, or block with one reason | `Decision`, `BlockReason` |
| Receipt | hash-chained record of one attempt (request, proposal, decision, chain outcome) | `Receipt` |
| Flow | a named place where the LLM is called (F1 intent, F2 explain, F3 dispute) | `Flow` |
| Token ledger | per-flow token / cost / latency / generation-id totals | `TokenLedger` |
| Audit | rebuild verdicts from receipts + chain events only | `audit()` |

## 4. Domain model
- Value objects: `Mandate`, `SpendRequest`, `Decision`, `Usage`. Entity: `Receipt` (seq, prevHash, hash). Aggregate: receipt chain.
- Domain services: `evaluate(mandate, spent, request)` (same check order as the vault contract), `sealReceipt(prev, body, hash)`, `audit(...)`, `summarize(ledger)`, `estimateEnergy(...)`.
- Ports: `LlmPort`, `ChainPort`, `ReceiptStore`, `Clock`, `Hasher`.

## 5. Use cases
| UC | Input | Output | Rule |
|---|---|---|---|
| UC-1 grant | budget, cap, merchants, deadline | mandate tx | only the owner key |
| UC-2 purchase | teammate's request text | receipt (paid or blocked) | F1 once → deterministic offer pick → vault `pay` always called (stops are recorded) |
| UC-3 stop | human presses STOP | pause tx | further `pay` → blocked PAUSED |
| UC-4 audit | receipts.jsonl + chain | verdict per receipt | no private data, no API key needed |
| UC-5 explain | receipt id | plain-language explanation | F2 on demand only, cached |

## 6. Acceptance criteria (each → ≥1 test)
- AC-1 Given budget 10 USDT, spent 0, request 9.8 + fee 0.4 When evaluate Then block OVER_BUDGET_WITH_FEES.
- AC-2 Given merchant not in list When evaluate Then block MERCHANT_NOT_ALLOWED (even if cheaper).
- AC-3 Given now > deadline When evaluate Then block DEADLINE_PASSED; Given paused Then PAUSED first.
- AC-4 Given amount ≤ 0 Then INVALID_AMOUNT; Given amount+fee > cap Then OVER_TX_CAP; Given all inside Then allow.
- AC-5 Given 3 receipts sealed in order When one byte changes Then audit reports BROKEN_CHAIN at that seq.
- AC-6 Given receipts + chain events When a chain outcome disagrees with re-evaluated policy Then audit verdict MISMATCH; When all agree Then INSIDE / STOPPED per receipt.
- AC-7 Given usages in flows F1×2, F2×1 When summarize Then per-flow counts and token sums, total equals sum of flows.
- AC-8 Given latency and tokens with assumption npuWatts When estimateEnergy Then Wh = watts × seconds / 3600 and the assumption text is returned with the number.
- AC-9 Given the LLM returns prose around JSON When parseIntent Then the JSON object is extracted and validated, else a typed error (no response_format on Kiln).

## 7. Architecture (Clean)
```
src/domain/ ← src/application/ ← src/adapters/ (kiln, tron, memory, jsonl) ← src/infrastructure/ (config, cli, composition root)
```
Domain imports nothing outside domain. Check: `grep -rn "adapters\|infrastructure\|tronweb\|node:" src/domain src/application` → 0.

## 8. Non-functional
Kiln calls: retry 429/5xx with `x-ratelimit-reset`; ≤2 LLM calls per purchase; every call logged with generation id. Chain: wait for receipt, record energy used.

## 9. Physical verification
Nile: deploy vault → grant → 2 paid + 3 blocked + 1 STOP → tronscan links in README. Kiln: live F1 on qwen3-32b, token report from real `usage`.
Video ≤3:00 (`scripts/record-video.mjs`), captions burned in, no human voice.

## 10. Changelog
- v0.1 2026-09-24 template + domain core (Jarvis, pre-hackathon; disclosed in README).
