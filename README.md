# Spendline — receipts for AI spending

**Declared function (one sentence):** Spendline is a wallet-and-policy layer for an AI purchasing agent — a person grants a USDT budget with a merchant list and a deadline, the agent (Qwen3-32B on Kiln) proposes purchases, a policy vault on TRON Nile pays only inside that line and records every stop on-chain, and anyone can reconstruct from the receipts alone whether a payment was allowed.

GWDC 2026 Korea Hackathon · FuriosaAI × Bricksum "Agent Finance" track · Challenge B (Controls and Records for an AI Agent That Spends).

## Check it yourself — no key, no `.env`
```bash
npm install
npm run audit -- docs/receipts-nile.jsonl --vault TNw1jzJ8NXHmhvwNhLRjLTiBzosu3GXAqF
# → 6 receipts · 2 paid inside · 4 stopped · 0 mismatch → OK   (exit code 0)
npm run ui        # open the printed URL: Grant · Feed · Receipt · Audit
```
The audit reads only the receipts file and the vault's public events on TronGrid. It recomputes every receipt hash, matches each receipt to its on-chain event, and re-runs the rule with the line that was in force at that moment (grants and STOPs included). Expected output: [docs/audit-nile-2026-09-26.txt](docs/audit-nile-2026-09-26.txt).

## Acceptance criteria → evidence (status 2026-09-26, v0.5)
| Brief criterion | Evidence | State |
|---|---|---|
| Declared Function | the sentence above | ✅ |
| Boundaries & Stopping | every stop is an on-chain `SpendBlocked` event: seller not listed [dfabe354…](https://nile.tronscan.org/#/transaction/dfabe354f7f527177d29f085c326b90752e69e1f2214cf629627409bbf6f601b) · over budget with fees [9a1fe129…](https://nile.tronscan.org/#/transaction/9a1fe129669d67089d36146fdeaff37a49a0414dc6d028447174deb928e6f64a) · deadline passed [ec20af5a…](https://nile.tronscan.org/#/transaction/ec20af5a007307c69565c6c159f6af8fe063d2a3b30238c9c161d300e3292bc1) · human STOP [488996ee…](https://nile.tronscan.org/#/transaction/488996eef9ecdc35f53004ccb1f7b5b1d43484fc84ebb9a7bf6a154f382a0721) → next pay stopped PAUSED [5c91105e…](https://nile.tronscan.org/#/transaction/5c91105ed9d0cd49ea8822ab0d30f3d5d9a34232f8020096d658befede01cffc) | ✅ 3 limits + 1 STOP |
| Kiln Integration & Efficiency | F1 (intent) live on qwen3-32b: 1 call per purchase, 104 prompt + 37–41 output tokens, 1.5–3.3 s, generation id sealed in each receipt; `/no_think` 57 vs 250 tokens (n = 1) | ◐ per-flow table, A/B n ≥ 10 and Wh table at the event |
| Blockchain Integration | each receipt hash is an argument of `pay()` and appears in the `Paid` / `SpendBlocked` event → 1:1 | ✅ |
| Approval & Evidence | keyless audit (above) + UI: grant a line, watch the feed, open a receipt, audit a file | ◐ Grant and STOP in the UI are not wired to a signer yet |

## Timeline — built before / during the event (honest disclosure)
The Korean site says "first commit after 19:00" on 2026-09-28; the global organizer said "you can start working on your project right now and keep improving it onsite" (GWDC TG, 2026-09-22). We asked in writing which one applies (2026-09-24) and had no answer by 2026-09-26. So everything built before the window is listed here, commit by commit, and can be told apart by commit time.

| Built **before** 2026-09-28 19:00 KST (disclosed) | Built **during** the 48 h window |
|---|---|
| **v0.1 · 2026-09-24** (`26f19e0`): SPEC, domain core (mandate check, hash-chained receipts, audit, token ledger, energy estimate, intent parser), Kiln adapter, TRON adapter, SpendlineVault.sol, Nile smoke run, video pipeline | (filled at the event) |
| **v0.5 · 2026-09-26**: keyless audit CLI + mandate history in the audit (`1b88483`) · deadline stop measured on Nile, audit in chain order (`a4c74fc`) · UI skeleton, 4 screens (`1db3a11`) | |

## What is verified (2026-09-26)
- `npm test` → 48 tests green (fakes only, no network). `npm run typecheck` clean. `npm run layers` → Clean Architecture OK.
- TRON Nile, vault `TNw1jzJ8NXHmhvwNhLRjLTiBzosu3GXAqF`: 6 receipts over 2 grants — 2 paid, stopped MERCHANT_NOT_ALLOWED, OVER_BUDGET_WITH_FEES, PAUSED (after a human STOP) and DEADLINE_PASSED (the same request that was paid 93 s earlier, sent again after the window closed). Run logs: [docs/nile-smoke-2026-09-24.json](docs/nile-smoke-2026-09-24.json), [docs/nile-r2-deadline-2026-09-26.json](docs/nile-r2-deadline-2026-09-26.json).
- Audit across re-grants: the vault can be re-granted, so the auditor rebuilds the line from `MandateGranted` events and counts spent per mandate. On this history the v0.1 audit reported the last two receipts as MISMATCH; v0.5 reports 0.
- UI captures at 390 px and 1280 px, no sideways scroll, one bottom action per screen: [docs/ui/](docs/ui/).
- Findings: Nile/TRON USDT `transfer()` returns `false` on success, so the vault checks the recipient's balance delta instead. TronGrid returns `bytes32` without `0x`, and an `address[]` event field as one newline-joined string.

## Layout
```
src/domain          policy, receipts, audit (replays grants / STOP), ledger, energy — no I/O
src/application     ports, UC-2 purchase, UC-4 audit records, view models for the UI
src/adapters        kiln (OpenAI-compatible), tron (TronWeb signer), trongrid (public events, keyless), memory (test doubles), web (HTML render), sha256
src/infrastructure  audit CLI, web composition root
web/                vite app (index.html, styles, public/session.json = public record)
contracts/          SpendlineVault.sol (stops are events, not reverts)
scripts/            compile, smoke (Kiln/Nile), e2e, r2-deadline, ui-data, capture-ui, record-video (no human voice)
```
Secrets live in `.env` (gitignored). Never in receipts, logs, the UI, or video.
