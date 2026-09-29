# Spendline — SPEC (SDD, v1.1 2026-09-29)

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
| Event source | where public chain events come from (TronGrid, or a saved JSON) — keyless | `EventSource` |
| Session | the public record the UI reads: vault, receipts, chain events | `Session` |

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
| UC-4 audit | receipts file (`.jsonl`, one receipt per line, or a run JSON `{vault, receipts}`) + public chain events | verdict per receipt | no private data, no API key, no `.env`; the line in force is rebuilt from `MandateGranted` events, not from current contract state |
| UC-5 explain | receipt id | plain-language explanation | F2 on demand only, cached |
| UC-6 dispute | a teammate's question | the receipt it is about + the audit verdict + tx | F3 once, cached; verdict from audit only |

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

## 6b. v0.5 acceptance (build items R1 · R2 · R7)
R7 — audit anyone can run (UC-4 as a CLI, `npm run audit -- <receipts file> [--vault T…] [--events file.json]`):
- AC-10 Given two grants (m1, then m2) When audit Then spent is counted per mandate, and a grant clears an earlier STOP (as `SpendlineVault.grant` sets `paused = false`).
- AC-11 Given `granted` chain events When audit Then the mandate for each receipt comes from those events (the `mandates` argument is only a fallback).
- AC-12 Given a `.jsonl` receipts file or a run JSON When parsed Then receipts (+ vault if present) are returned; a bad line Then a typed error naming the line number.
- AC-13 Given an audit result When reported Then one line per receipt (seq, verdict, reason, tx) + a summary line; exit code 0 only if the hash chain is intact and every receipt is PAID_INSIDE or STOPPED.
- AC-14 Given TronGrid event payloads (shape measured 2026-09-26: `mandateId` without `0x`, addresses `0x`+40 hex, `merchants` one newline-joined string) When decoded Then chain events with base58 merchants and `0x`-prefixed mandate ids; pages follow `meta.fingerprint`; no key, no TronWeb signer.
- AC-15 Given no `.env` and no key in the working directory When the CLI runs with `--events` Then it prints the report (keyless path is tested, not assumed).

R2 — deadline stop measured once on Nile: grant m2 with a deadline a few minutes out → one paid run inside it → the same request after it → `SpendBlocked(DEADLINE_PASSED)`; the R7 CLI rebuilds every receipt (m1 + m2) with 0 mismatches. Unit side is AC-3.

R1 — web UI skeleton, 4 screens (Grant · Feed · Receipt · Audit). Everything shown is rebuilt from public records by `audit()` — the UI never trusts the operator. No keys in the browser (non-goal), so Grant ends in a mandate to sign locally and STOP shows the recorded on-chain STOP until the local signer lands (v0.9).
- AC-16 Given grant form values When `grantDraft` Then a mandate in micro-USDT, or plain-language errors (budget ≤ 0, cap ≤ 0 or > budget, no merchant, a merchant that is not a TRON address, deadline not in the future).
- AC-17 Given a session (receipts + chain events) When `feedView` Then the first value is spent / budget of the latest mandate, rows newest first with paid / stopped + plain-language reason; no receipts Then an empty state.
- AC-18 Given a session and a seq When `receiptView` Then amount first, one verdict line, the request words, a Nile tronscan link, and hash / token details for a collapsed section; unknown seq Then a not-found state.
- AC-19 Given an audit result When `auditView` Then the first value is the problem count (mismatch + no event + broken chain), then per-receipt rows.
- AC-20 Rendered screens: exactly one primary bottom CTA each, details collapsed by default, the number rendered before the verdict line, HTML-escaped user text; `index.html` has a viewport meta and no external font / CDN request.

## 6c. M0 mock-review fixes (2026-09-26)
- AC-21 Given a vault `Paid` / `SpendBlocked` event whose receipt hash is in no receipt of the file (or a second event carrying the same receipt hash) When audit Then it is listed as a chain spend without a receipt, counts as a problem, and the CLI exits 1. (Without this, dropping the *last* receipt keeps the hash chain intact and the audit said OK while money had left the vault.)
- AC-22 Given a receipt whose flow usage came from the scripted stand-in (generation id `fake-N`, used by the 2026-09-24 template smoke) When the receipt screen renders Then it says "scripted stand-in — no Kiln call", never "N Kiln calls"; only usage with a real `X-Neocloud-Generation-Id` counts as a Kiln call.

## 6d. v0.6 — M0 open items closed before the event (2026-09-26)
F2 · F3 — Kiln flows beyond F1 (UC-5 explain, UC-6 dispute). The model reads and writes words; every fact it may use is computed by code from `audit()`, and its answer must **echo the audit verdict** or it is not shown.
- AC-23 Given a receipt When `explain` (F2) Then exactly one Kiln call with code-built facts (amount, fee, seller, verdict, reason, the line in force, spent before); the reply is JSON `{verdict, reason?, explanation}`; a verdict / reason that differs from the audit → the code's template text, marked "model answer rejected"; the same receipt again → answered from the answers log, 0 calls. A standalone number in the reply that is not a number of the facts → not shown (the model copies numbers, it does not compute them). Cache keys carry the prompt version.
- AC-24 Given a teammate's question When `dispute` (F3) Then exactly one Kiln call picks the receipt (`{seq, verdict, answer}`) from a code-built table of audited receipts; the verdict shown always comes from the audit (never the model); unknown seq → "no receipt matches"; verdict echo differs → template; the same question on the same record → cached, 0 calls. Each row carries the code-computed STOP relation at that moment (`stopStateAt`: STOP in force since T / line granted T — this grant lifted the STOP of S) and times to the second; the number rule of AC-23 applies.
UC-6 dispute: question text + receipts + public events → `{seq, verdict, answer, tx}` · F3 once, cached.

M0-19 — one receipt, one decision on-chain.
- AC-25 Given a receipt hash already passed to `pay()` When `pay()` again Then `SpendBlocked(…, DUPLICATE_RECEIPT)` (code 7, checked **first**, codes 1–6 unchanged so old vault events still decode); `evaluate(…, receiptUsed = true)` → DUPLICATE_RECEIPT; the audit lists a second `SpendBlocked(DUPLICATE_RECEIPT)` for a known receipt as a replay stopped on-chain (not a problem), while a second `Paid` stays a problem (AC-21).

M0-11 · M0-12 — efficiency in numbers.
- AC-26 Given usage records When `flowReport` Then per flow: calls, prompt / completion tokens, USD, median and total latency, Wh (card watts × wall time, assumption text attached), generation ids; stand-in usage is excluded and counted separately; calls per purchase = F1 calls / receipts.
- AC-27 Given paired A/B runs (same request, `/no_think` vs thinking) When `abSummary` Then per arm n, JSON parse rate, median completion tokens, median latency, median Wh, and the share of pairs whose parsed intents are identical; n < 10 is reported as "n below 10".

M0-14 · M0-15 — the person signs, the agent takes one line.
- AC-28 Given the JSON the Grant screen copies (`Omit<Mandate,'id'>`, micro-USDT) When `npm run grant -- mandate.json` Then it validates like `grantDraft` (plain-language errors), derives the mandate id, and the owner key signs `grant()` → `MandateGranted`; `npm run stop` signs `pause()` → `Paused`, after which `pay()` → PAUSED. The STOP sheet and the Grant step name these commands.
- AC-29 Given one request line When `npm run agent -- "<request>"` Then UC-2 runs with live Kiln (no stand-in fallback), the receipt is appended to the receipts file continuing its hash chain, one report line says paid / stopped + reason + tx link + Kiln tokens, and `web/public/session.json` is rebuilt from public records (unless `--no-ui`).

Physical (M0-13): a new vault with AC-25 on Nile; every run's F1 on live Kiln (a Kiln failure aborts the run — no stand-in); grant and STOP through the owner CLI, purchases through the agent CLI; runs: paid ×≥2 · MERCHANT_NOT_ALLOWED · OVER_BUDGET_WITH_FEES · a replayed receipt hash → DUPLICATE_RECEIPT · STOP → PAUSED · re-grant with a short window → paid → DEADLINE_PASSED; keyless audit 0 problems; F2 ×≥2 and F3 ×≥2 live → `docs/tokens-by-flow.md`.

UI acceptance (Toss checklist → this product): mobile first (390 px no horizontal scroll, 1280 px intact) · Grant is a step form, ≤ 2 questions per step · titles ≥ 22 px bold, body 15–16 px, captions 13 px · sections ≥ 24 px apart, cards radius ≥ 16 px, ≤ 1 shadow · one fixed bottom CTA ≥ 52 px · number first (≥ 28 px) · proofs in `<details>` · short friendly copy, jargon glossed once · white + blue #3182F6 + ok / warn / stop colours, body contrast ≥ 4.5:1, dark mode minimal · system fonts, no CDN. Checked by tests (AC-20) + captures 390 / 1280.

## 6e. v0.7 — M1 prep: the demo axis first (2026-09-28)
Gap order from the M0 scores (Demo 2 · Completeness 5 · Practical value 5–6): the model's words must be visible where a judge looks,
and the video, deck and pitch must say only what the record says.

- AC-30 Given a session that carries the answers log When `receiptView(seq)` Then `why` = the newest prompt version's F2 text for that seq,
  only if it is grounded and its verdict / reason equal the audit's for that seq (else no `why`); When `questionsView(session)` Then one row per
  F3 question (newest prompt version), each with the receipt it picked, the **audit's** verdict line and tx for that seq, and the model's words —
  a row whose verdict does not echo the audit, or whose seq is not in the record, is left out. The Receipt screen shows `why` under the verdict,
  labelled as Kiln's words; the Audit screen lists the questions. Stand-in usage and ungrounded text are never shown as the model's answer.
- AC-31 Given a narration script (scenes `{id, url, en}`) and the record's facts When `checkScript` Then it reports: estimated length
  (words ÷ 2.6 per second + 0.9 s per scene) over the limit (180 s demo · 300 s pitch); for the demo, no scene that opens the receipt of a
  `MERCHANT_NOT_ALLOWED` stop starting before 0:20; a number in the narration that is not a fact or a stated assumption; a tx prefix
  (≥ 6 hex) that is not the start of a tx in the record. `npm run video -- --check` refuses to record a script with any finding.
- AC-32 Given the record's facts When `deckSlides(facts)` Then 8–10 slides (organizer mail 2026-09-28: presentation PDF ≤ 10 pages); slide 1 = the declared function; one slide each for the
  five acceptance criteria' evidence, who pays / where it plugs in, and what is not done; every number in the slide text is a fact or a stated
  assumption (the AC-23 number rule, applied to our own copy). `npm run deck` renders `docs/deck.pdf` (1 page per slide, checked) and
  `docs/qa.md` (10 judge questions, answers under the same number rule).
M1 mock review (2026-09-28) — Kiln tool calling, the organizers' own pointer ("Qwen3-32B Tool Call Parser", GWDC TG; the model was switched *because* of tool calling):
- AC-33 Given F1 When the purchase runs Then the Kiln request carries one tool `propose_purchase` (JSON-schema parameters: item ∈ catalog items, quantity > 0,
  optional maxUnitPrice, optional merchantHint) with `tool_choice: "auto"` (the only mode qwen3-32b supports); a returned tool call's `arguments` are validated
  by the same `parseIntent`; a reply in text instead of a call goes down the text-JSON path; the F1 usage records `via: "tool_call" | "text"`. Other flows send no tools.
- AC-34 Given the same 12 requests in both arms (tool call · text JSON, `/no_think` both, order alternating) When `abSummary` Then per arm parse rate, median prompt / output tokens,
  latency, Wh and same-JSON pairs. Decision rule fixed before the run: production = tool call **iff** its parse rate ≥ the text arm's and same JSON ≥ 11 / 12 and its median latency
  ≤ 1.2 × the text arm's; otherwise text JSON stays and the report says why. Written to `docs/ab-tool-call-<date>.json` and `docs/tokens-by-flow.md`.
- Physical: UI captures re-taken on the live record (390 / 1280, 0 sideways scroll) · `docs/video/spendline-demo.mp4` ≤ 3:00 ·
  `docs/video/spendline-pitch.mp4` ≤ 5:00 (deck slides + the same narration pipeline) · `docs/deck.pdf`.

## 6f. v0.8 — during the 48 h window (2026-09-28 19:00 KST →): the live run judges asked for (M1-06)
M1 said: the demo only replays the 2026-09-26 record, no live receipt comes through the tool-call F1, the README "during" column is empty.
- AC-35 Given a Kiln usage record that carries `via` / `serverMs` When `usageLine(u)` Then the line also says how F1 got its intent
  (`tool call` · `tool call leaked into text` · `JSON in text (tool offered)`) and `server <s> s` — records without them print as before.
- AC-36 Given the live receipts file and the terminal transcripts in `docs/live/agent-*.txt` When `npm run video:stage` Then `stage.html#agent`
  shows those transcripts verbatim, each receipt's `via` and server time from the record, and nothing that is not in them; a transcript whose
  receipt hash / tx is not in the record is refused (the AC-31 number rule, applied to the terminal scene).
- Physical: `npm run agent` on live Kiln + Nile after 19:00 → receipts #9+ (every result kept, including a text fallback) · keyless audit OK ·
  demo scene `#agent` · README "during" column with the commit hashes · pushed only at the v1 freeze (2026-09-29 20:00).

## 6g. v0.9 — organizer's required item 4 (Kiln account mail, 2026-09-28 23:17 KST): "Proof of API usage in your README (on-chain tx hashes + Kiln API call logs, per flow)"
- AC-38 Given the receipts, the vault's public events and the answers log When `proofByFlow` Then one table per flow (F1 · F2 · F3):
  F1 = one row per receipt (seq, time KST, Kiln generation id, prompt / output tokens, USD, `via`, server time, outcome, the `pay()` tx that
  carries that receipt hash — the first event for the hash, never the replay); F2 / F3 = one row per Kiln call (seq it is about, question,
  generation id, tokens, USD, shown or held back, the tx of that receipt). Stand-in usage is never a row. A receipt with no on-chain event is a
  finding, not a blank cell. `npm run proof` writes it into README between `<!-- proof:start -->` and `<!-- proof:end -->` (keyless, offline).
- AC-37 Given an existing agent loop that pays with `wallet.transfer(to, amount, memo)` When its wallet is swapped for `spendlineWallet({ chain, store, hash })`
  (same call shape, `examples/plug-in.ts`) Then the unchanged loop gets paid inside the line and `ok: false` + the on-chain reason outside it; every attempt
  is a hash-chained receipt (memo = the receipt's words, no model call added) and the keyless audit rebuilds each verdict. UC-2 purchase uses the same `guardedPay`.
- AC-32 tightened: deck ≤ 10 slides (the "not done" slide and "check it yourself" are one slide).
- AC-39 Given a request that names a seller by its catalog name (the label before " — ", whole words, any case) and an F1 answer with no
  `merchantHint` address When the purchase runs Then that seller is priced and sent to the vault (unlisted → stopped on-chain MERCHANT_NOT_ALLOWED);
  an address from F1 still wins; two different names or none → the cheapest listed offer as before. Code, not prompt: F1 is unchanged (no new A/B).
- README record numbers (the How-to-run audit line, the Kiln row) are pinned to the record's facts by `tests/readme-numbers.test.ts`.

### 6h. v1.1 (2026-09-29 night, during the window) — a second witness, and the lead's weekly loop
- AC-40 (two witnesses) Given the receipts, the answers log, the vault's public events and Kiln's own record of each generation
  (`GET /v1/generations/{id}` → `{id, model, total_cost, tokens_prompt, tokens_completion, created_at}`) When `attest` Then one row per Kiln
  call in the record (F1 per receipt, F2 / F3 per answer): MATCH when Kiln has that generation id with the same model (qwen3-32b), the same
  prompt / output tokens and the same cost (±1e-9 USD); DIFFERS with each differing field named; NOT_FOUND when Kiln does not show the id.
  For F1 the row also carries Kiln's `created_at` and the block time of the `pay()` event whose receipt hash commits to that generation id,
  and the lead in seconds; a generation created **after** the payment is DIFFERS ("model call after the payment"). Stand-in usage is never a row.
  `npm run attest` asks Kiln live and saves Kiln's answers to `docs/kiln-generations.json`; `npm run attest -- --saved`
  re-runs the comparison keyless from that file. Exit 0 only when every row is MATCH.
- AC-41 (weekly statement) Given the receipts, the audit and the catalog When `statement` Then one line per receipt: time (KST), seller label,
  the request words, amount, fee, the audit's verdict and reason, the tx; totals: paid inside by seller, stops by reason, what the guarding
  cost (Kiln USD from the record); a receipt the audit did not rebuild (MISMATCH / NO_CHAIN_EVENT) is listed as a problem, never as paid.
  The statement's verdicts come from `audit()` only. `npm run statement` writes `docs/statement.md` + `docs/statement.csv` (keyless).
- AC-42 (tune the next line) Given the recorded requests and a candidate line (`mandate.json`) When `tune` Then each request is re-evaluated in
  order under the candidate (same `evaluate()` and check order as the vault, spent accumulates only on allow, time and STOP ignored — the
  question is budget, cap and sellers) and the result is paid / stopped per reason under the candidate vs the record, and the requests whose
  verdict would change. Keyless, no chain write.
- AC-43 (MCP) Given an MCP host (any agent that speaks the Model Context Protocol) When it connects to `npm run mcp` (stdio) Then it sees three
  tools: `spendline_line` (the line: budget, spent, left, cap, sellers, deadline, STOP), `spendline_pay` (`to`, `amount_usdt`, `why`,
  optional `fee_usdt`) → `guardedPay` (AC-37) → `{ok, reason?, tx, receipt}`, and `spendline_check` (`seq`) → the audit's verdict for that
  receipt (keyless). No model call is added; the host keeps its own planner. Amounts are USDT with ≤6 decimals, converted to micro-USDT by code.
  A seller may be named instead of an address (catalog names, matched by code). Optional `kiln_usage` (set by host code, never shown to the
  model) = the Kiln call that decided the payment → the receipt's F1 usage, so the on-chain hash commits to it and AC-40 can attest it.
- AC-44 (a Kiln-planned MCP host) Given a request and the MCP tools When `runHost` Then Qwen3-32B on Kiln is offered the tools (without
  `kiln_usage`), each reply's tool call (proper, or leaked into the text) is sent to the MCP server one at a time — `spendline_pay` with the
  host's `kiln_usage` of that call, a model-written one replaced — and the result goes back to the model, until a plain answer or 8 tool
  calls. `npm run mcp:host -- "<words>"` runs it over stdio against `npm run mcp` and saves the run to `docs/live/mcp-host-*.json`.

## 7. Architecture (Clean)
```
src/domain/ ← src/application/ ← src/adapters/ (kiln, tron, memory, jsonl) ← src/infrastructure/ (config, cli, composition root)
```
Domain imports nothing outside domain. Check: `grep -rn "adapters\|infrastructure\|tronweb\|node:" src/domain src/application` → 0.

## 8. Non-functional
Kiln calls: retry 429/5xx with `x-ratelimit-reset`; ≤2 LLM calls per purchase; every call logged with generation id. Chain: build → sign → broadcast split so a network error is retried safely (rebuild after a failed build, re-send the same signed tx after a failed broadcast; `pay()` cannot pay twice anyway, AC-25); the decision is read from the block-included tx info log, not the solidified node (≈60 s) or the event API (≈50 s).

## 9. Physical verification
Nile: deploy vault → grant → 2 paid + 3 blocked + 1 STOP → tronscan links in README. R2 (deadline) and the R7 CLI are run against the same vault; UI captures at 390 / 1280. Kiln: live F1 on qwen3-32b, token report from real `usage`.
Video ≤3:00 (`scripts/record-video.mjs`), captions burned in, no human voice.

## 10. Changelog
- v0.1 2026-09-24 template + domain core (Jarvis, pre-hackathon; disclosed in README).
- v0.5 2026-09-26 §6b: keyless audit CLI (R7), mandate history in audit, deadline stop on Nile (R2), UI skeleton (R1) — pre-hackathon, disclosed in README.
- v0.5.1 2026-09-26 §6c (M0 mock review): audit lists chain spends without a receipt (AC-21) · scripted stand-in usage is labelled, not counted as Kiln (AC-22) · README states user, AI-vs-code split, enforcement point, chain read/write/settle.
- v0.6 2026-09-26 §6d (M0 open items, pre-hackathon, disclosed; live answers added the number rule and the STOP relation to AC-23/24): F2 explain · F3 dispute on Kiln (AC-23/24) · vault refuses a reused receipt hash (AC-25) · per-flow token / Wh report and /no_think A/B (AC-26/27) · owner CLI signs grant / STOP (AC-28) · agent CLI, one request line → receipt (AC-29) · live Nile rerun with every model call on Kiln.
- v0.7 2026-09-28 §6e (M1 prep, before the 19:00 window — disclosed): Kiln F2 / F3 words on the Receipt and Audit screens, audit-checked (AC-30) · narration check for video and pitch (AC-31) · deck built from the record's facts, same number rule (AC-32) · demo video, pitch video, deck PDF, 10 Q&A.
- v0.8 2026-09-28 §6f (during the window, from 19:00 KST): live agent receipts on the tool-call F1 with `via` · `serverMs` in the report line (AC-35) · terminal scene in the demo from the transcripts, checked against the record (AC-36).
- v0.9 2026-09-29 §6g (during the window): README proof of API usage per flow, generated and checked (AC-38) · plug-in wallet + example, tested (AC-37) · deck ≤ 10 pages (AC-32 tightened to the organizer's limit).
- v0.9.1 2026-09-29 (during the window, M1 check): live receipt #12 · a seller named in the words reaches the vault (AC-39) · README record numbers pinned by a test.
- v1.0.0 2026-09-29 (during the window, v1 freeze): live receipts #13–#15 and F2 / F3 on the organizer-issued Kiln account (team32) · README's account sentence pinned to the record by a test.
- v1.1.0 2026-09-29 night (during the window) §6h: two witnesses — Kiln's own generation record vs the receipts on TRON (AC-40) · statement + tune for the lead's week (AC-41/42) · MCP server + a Kiln-planned MCP host, 3 live runs → #16–#21, three host bugs from the live runs fixed with tests (AC-43/44).
