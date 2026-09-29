# Kiln tokens by flow — Spendline live record on TRON Nile (2026-09-26 → 2026-09-29, qwen3-32b)

Sources: `docs/receipts-nile-live.jsonl` · `docs/answers-nile-live.jsonl`. Every row is a real Kiln call (qwen3-32b) with its `X-Neocloud-Generation-Id`; usage without one is not counted. Stand-in usage excluded: 0 records.

| Flow | What the model does | Calls | Prompt tokens | Output tokens | Total tokens | USD (Kiln `usage.cost`) | Median latency | Total wall time | Wh (est.) | Wh / call (est.) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| F1 intent | request words → `{item, quantity, maxUnitPrice?, merchantHint?}`; code picks the offer and does the money math | 19 | 4343 | 590 | 4933 | $0.0003742 | 1.68 s | 35.33 s | 1.7667 | 0.0930 |
| F2 explain | audit facts → two plain sentences about one receipt (shown only if it echoes the audit verdict) | 9 | 3379 | 517 | 3896 | $0.0003936 | 2.26 s | 23.84 s | 1.1922 | 0.1325 |
| F3 dispute | a teammate's question → which receipt it is about (verdict always from the audit) | 14 | 20313 | 948 | 21261 | $0.0016574 | 2.37 s | 38.64 s | 1.9320 | 0.1380 |
| F4 MCP host | v1.1: a general MCP host planning on Kiln → `spendline_pay` tool calls (+ its closing answer); code prices catalog items | 15 | 15666 | 1395 | 17061 | $0.0013437 | 2.00 s | 34.09 s | 1.7046 | 0.1136 |
| **Total** | | **57** | **43701** | **3450** | **47151** | **$0.0037689** | 1.94 s | **131.91 s** | **6.5954** | 0.1157 |

- LLM calls per purchase: **1.00** (19 F1 calls / 19 receipts) — the design limit is 2. Offer choice, money math, the rule and the receipt are code: no call is spent on them.
- F2 and F3 run only when a person asks, and the same question on the same record is answered from the answers log with 0 calls.
- Energy per purchase (F1, est.): **0.0930 Wh**.
- F2 explain: 9 calls = v1 ×2 · v2 ×2 · v3 ×5 (one call per receipt per prompt version)
- F3 dispute: 14 calls = v1 ×3 · v2 ×3 · v3 ×3 · v4 ×5 (one call per question per prompt version)
- Prompt revisions came from live answers: v1 → times to the second and a code-written STOP relation → numbers only from the facts (see the commit log).

## Energy — an assumption, not a measurement
Kiln exposes no power telemetry, so Wh = 180 W × measured wall time ÷ 3600 per call. 180 W source: FuriosaAI RNGD card TDP — "180W TDP", furiosa.ai/rngd, checked 2026-09-26. It is an upper bound: 180 W NPU card × request wall time (upper bound; whole card attributed to this request). Wall time is measured at the client, so it also includes network time.

## Generation ids (Kiln `X-Neocloud-Generation-Id`)
- F1 intent: `d919cfd0-5e71-46fc-8ec0-6fad043902de` · `a83ece71-1d04-48cf-8cbf-38d1789e184f` · `00d1184c-2b24-43b9-b4f0-43a09039447b` · `0d72f2ca-d20d-40e5-af68-eb3ed9000660` · `bec549da-0c5e-4c45-b845-7a922da104c7` · `6bd3f0d9-086c-4a7c-8fe4-a8e5aac42b44` · `08b3ef5e-d928-428a-8d39-ff7e50d4d8c4` · `1985998e-c88d-4ed3-806e-713c7fd5ef24` · `36145ff2-cb1c-4414-adec-fecb566643da` · `71dc1400-07b0-4b84-aa3d-3b29cbf5b374` · `adfb41df-ce96-4ccd-a785-5f0daaa918ed` · `f1e7aa9a-d4fc-49e7-bef7-959b8191108e` · `f88084b3-e332-4cd4-a2d4-33ad024936bf` · `14c26f4e-d054-4a97-8a1a-aad8b2d9c959` · `2ad75081-1720-4145-9f9c-6a10c53d076a` · `26fa95a0-3eef-4256-94cb-92ae98d31c1a` · `0e8c90e1-9435-4dcf-a1c5-014d90b30091` · `a6c915f3-25e5-4510-8436-705373bf082a` · `dd86d26e-6eea-4d85-91ee-f9fa79d794bc`
- F2 explain: `e6ebd78a-1c0c-4863-97bc-0754f3ea8549` · `04da11bb-35cc-4626-9ee5-a68e277ad32c` · `53f41100-4caa-4377-aac1-abc3dfaa7d46` · `cccd1a4b-b964-4c53-bf96-9d8c2181b896` · `3a712866-d843-45a5-9058-dd1dbdb82b87` · `db754b5e-4b0e-425e-95a7-52903e4be32a` · `46108f55-baa2-4e65-bbb6-d1a2f0fb51b6` · `2c5b6816-e1fd-426e-bc67-f6fa2297ccc5` · `2c513ec0-7450-4778-9569-5fa038a03b56`
- F3 dispute: `d1bdd9c8-718d-4782-88d2-7c0ec57565c4` · `2389917f-9859-4351-abd0-45c6dbad197f` · `ffa30c87-4961-40fc-88cd-28393651542c` · `7c4141f9-35c4-46af-9b51-8a852328d94d` · `35c56cc2-328c-4fa0-ba8d-449afa868d54` · `74dda3ce-ce35-4aba-9627-390e55e79c2b` · `b720fc26-26ae-43e0-af6e-fc7a16d3a7d1` · `c856ef6f-93ef-4b67-b27c-0105ffc7caa7` · `1a19f663-d670-4b27-a5da-5490ebcb3a39` · `9040d65b-c3d2-408e-a9c4-e479e8053f1c` · `952891d8-988e-4397-8f6c-465fc1256204` · `a9e39d12-f8e3-40fa-9862-447222db447d` · `f2699a73-4f40-44fc-8b22-8040eaa0b25d` · `e569d038-647a-4d30-b22b-6697fdcfa186`
- F4 MCP host: `74aaa6f8-644e-46c7-83bf-d9fac9952e9f` · `03a3f569-ebf1-4a5e-81fe-38a32d3694fe` · `2622f88d-b806-4214-b8d8-f31e5576cdd5` · `bfdb4f53-7d41-4307-8f6f-8a6d690e4f8a` · `c5d5876e-f6c0-4b1b-bfb0-335c699bb0d1` · `7ade1952-d2a6-4176-9cd8-b4119c1dbba7` · `cc296906-192f-42de-a5c3-9f10703c7cf9` · `72f43818-9583-477d-8ca5-95d04226a1f1` · `7dfdb95b-a944-4949-a707-39d2b2c1c513` · `1417d6c3-126d-452e-b526-089feee858ee` · `9dc6f5f0-c8d3-4807-9038-c8c34265a965` · `6538542f-fee0-4a67-9c2f-23230a1c5cc7` · `93d4be98-8966-4aef-adee-d8202df5ccdc` · `bf625a4a-3d3c-4886-9d26-57e2d5026aaa` · `bb378748-d273-4602-adc0-35f028b09ae2`

## /no_think A/B — n = 12 pairs
Same F1 request, sent once with Qwen3's `/no_think` soft switch and once with thinking on, pairs in alternating order, 2026-09-26. Raw calls with generation ids: `docs/ab-no-think-2026-09-26.json`.

| Arm | n | JSON parsed | Median output tokens | Median latency | Median Wh (est.) | USD total |
|---|---:|---:|---:|---:|---:|---:|
| `/no_think` (production) | 12 | 100% | 36 | 0.95 s | 0.0474 | $0.0001954 |
| thinking on | 12 | 100% | 223 | 3.50 s | 0.1748 | $0.0009188 |

- Same JSON (item · quantity · price cap · seller hint): 12 / 12 pairs.
- `/no_think` saves 84% of median output tokens and 73% of median latency (≈ the same share of estimated Wh).

## F1 tool call vs text JSON (run1) — n = 12 pairs
Same F1 request, once as a Kiln tool call (`propose_purchase`, tool_choice auto) and once as JSON in the text reply, both `/no_think`, pairs in alternating order, 2026-09-28. Raw calls with generation ids: `docs/ab-tool-call-2026-09-28-run1.json`.

| Arm | n | Intent parsed | Median prompt tokens | Median output tokens | Median latency | Median Wh (est.) | USD total |
|---|---:|---:|---:|---:|---:|---:|---:|
| tool call `propose_purchase` | 12 | 83% | 322.5 | 40 | 1.00 s | 0.0500 | $0.0003190 |
| JSON in the text reply | 12 | 100% | 104.5 | 33 | 0.95 s | 0.0478 | $0.0001991 |

- Same intent (item · quantity · price cap · seller hint): 9 / 12 pairs.
- Rule fixed before the run (SPEC AC-34): tool call only if it parses as often, agrees on ≥ 11 / 12 and is not > 1.2× slower. **Production: text JSON** — text JSON stays: parse rate 83% vs 100% · same JSON 9 / 12.
- run1: parser read tool_calls only; 2 of 12 tool-arm replies carried the call as plain text ({"name","arguments"}) and failed to parse → leakedToolCall added before run2 (prompt and rule unchanged)

## F1 tool call vs text JSON (run2) — n = 12 pairs
Same F1 request, once as a Kiln tool call (`propose_purchase`, tool_choice auto) and once as JSON in the text reply, both `/no_think`, pairs in alternating order, 2026-09-28. Raw calls with generation ids: `docs/ab-tool-call-2026-09-28-run2.json`.

| Arm | n | Intent parsed | Median prompt tokens | Median output tokens | Median latency | Median Wh (est.) | USD total |
|---|---:|---:|---:|---:|---:|---:|---:|
| tool call `propose_purchase` | 12 | 100% | 322.5 | 40 | 1.03 s | 0.0515 | $0.0003176 |
| JSON in the text reply | 12 | 100% | 104.5 | 33.5 | 0.90 s | 0.0451 | $0.0001924 |

- Same intent (item · quantity · price cap · seller hint): 12 / 12 pairs.
- Rule fixed before the run (SPEC AC-34): tool call only if it parses as often, agrees on ≥ 11 / 12 and is not > 1.2× slower. **Production: tool call** — tool call: parse rate 100% vs 100% · same JSON 12 / 12 · median latency 1.14× the text arm.
- run2: leaked calls parsed (tool_call_in_text) — the rule picks the tool call. Price of that choice: ≈3× prompt tokens (the tool schema rides along) and ≈1.6× USD per F1 call; in run1 the text arm once invented a price cap the request never stated (maxUnitPrice 50 for "just one" dataset), the tool arm did not · run2 tool-arm paths: tool_calls 11, leaked into text 0, plain JSON 1

## Energy with Kiln's server-side time — n = 12 F1 calls (tool call, `/no_think`), 2026-09-28
Kiln returns `x-envoy-upstream-service-time` on every response: the time spent behind Kiln's edge. It excludes the network, so it is a tighter upper bound than client wall time — still not NPU busy time (queueing is inside it).

| Time base | Total | Wh (est., × 180 W) | Wh per F1 call |
|---|---:|---:|---:|
| client wall time | 13.23 s | 0.6613 | 0.0551 |
| Kiln upstream time | 8.68 s | 0.4338 | 0.0362 |

- Server time is 66% of wall time on these calls; F1 paths: tool_calls 8 · call leaked into text 3 · plain JSON 1 — parsed 12 / 12. Raw: `docs/energy-server-time-2026-09-28.json`. New receipts carry `serverMs` from v0.7 on.

## F4 MCP host on Kiln (AC-44) — the same payments through a general agent
- 5 runs (requests) of `npm run mcp:host`: 15 Kiln calls · 17,061 tokens · $0.0013437 → 9 new receipts (**1.67 calls per receipt**), 7 paid (2.14 per paid purchase), 3.00 per request; 13 pay attempts reached the vault, 4 of them repeats refused on-chain; 2 Kiln calls were spent only on a repeat.
- Runs that handled the whole request: 3 / 5. Calls that reached no vault: 6 — 1 refused before the chain (a seller name not in the catalog), 2 pay decisions the host could not parse (fixed with tests after those runs), 3 closing answers.
- Median prompt 973 tokens per call vs 320 for Spendline's own F1 with the tool offered (1 call per purchase): the purpose-built F1 stays the efficient path; MCP is the path for an agent that already has a planner.

Regenerate: `npm run report` (reads the files above; no key).
