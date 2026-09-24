# Spendline — receipts for AI spending

**Declared function (one sentence):** Spendline is a wallet-and-policy layer for an AI purchasing agent — a person grants a USDT budget with a merchant list and a deadline, the agent (Qwen3-32B on Kiln) proposes purchases, a policy vault on TRON Nile pays only inside that line and records every stop on-chain, and anyone can reconstruct from the receipts alone whether a payment was allowed.

GWDC 2026 Korea Hackathon · FuriosaAI × Bricksum "Agent Finance" track · Challenge B (Controls and Records for an AI Agent That Spends).

## Status: v0.1 template (pre-hackathon) — honest timeline
| Built **before** 2026-09-28 19:00 KST (disclosed) | Built **during** the 48h window |
|---|---|
| SPEC.md · domain core (mandate check, hash-chained receipts, audit, token ledger, energy estimate, intent parser) · Kiln adapter · TRON adapter · SpendlineVault.sol · Nile smoke run · video pipeline | (to be filled at the event) |

Organizer guidance used: "you can start working on your project right now and keep improving it onsite" (GWDC TG, 2026-09-22).

## What is verified so far (2026-09-24)
- `npm test` → 22 tests green (fakes only, no network). `npm run layers` → Clean Architecture OK.
- Kiln live (`npm run smoke:kiln`): qwen3-32b parsed the intent correctly with `/no_think` in **57 output tokens / 2.95 s** vs **250 tokens / 5.60 s** with thinking — same JSON.
- TRON Nile (`scripts/e2e-nile.ts`, vault `TNw1jzJ8NXHmhvwNhLRjLTiBzosu3GXAqF`): 1 paid · stopped MERCHANT_NOT_ALLOWED · stopped OVER_BUDGET_WITH_FEES · owner STOP → stopped PAUSED. `scripts/audit-nile.ts` rebuilt all 4 verdicts from public data only (0 mismatches).
- Finding: Nile/TRON USDT `transfer()` returns `false` on success → the vault verifies the recipient's balance delta instead of the return value.

## Layout
```
src/domain        policy, receipts, audit, ledger, energy (no I/O)
src/application   ports + UC-2 purchase
src/adapters      kiln (OpenAI-compatible), tron (TronWeb), memory (test doubles)
contracts/        SpendlineVault.sol (stops are events, not reverts)
scripts/          compile, smoke (Kiln/Nile), e2e, audit, record-video (no human voice)
```
Secrets live in `.env` (gitignored). Never in receipts, logs, or video.
