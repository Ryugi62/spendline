# Kiln tokens by flow — Spendline live run on TRON Nile (2026-09-26, qwen3-32b)

Sources: `docs/receipts-nile-live.jsonl` · `docs/answers-nile-live.jsonl`. Every row is a real Kiln call (qwen3-32b) with its `X-Neocloud-Generation-Id`; usage without one is not counted. Stand-in usage excluded: 0 records.

| Flow | What the model does | Calls | Prompt tokens | Output tokens | Total tokens | USD (Kiln `usage.cost`) | Median latency | Total wall time | Wh (est.) | Wh / call (est.) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| F1 intent | request words → `{item, quantity, maxUnitPrice?, merchantHint?}`; code picks the offer and does the money math | 8 | 831 | 262 | 1093 | $0.0001110 | 1.51 s | 16.22 s | 0.8108 | 0.1014 |
| F2 explain | audit facts → two plain sentences about one receipt (shown only if it echoes the audit verdict) | 6 | 2237 | 341 | 2578 | $0.0002536 | 3.20 s | 17.52 s | 0.8759 | 0.1460 |
| F3 dispute | a teammate's question → which receipt it is about (verdict always from the audit) | 12 | 14044 | 775 | 14819 | $0.0011078 | 2.20 s | 32.91 s | 1.6453 | 0.1371 |
| **Total** | | **26** | **17112** | **1378** | **18490** | **$0.0014723** | 2.16 s | **66.64 s** | **3.3320** | 0.1282 |

- LLM calls per purchase: **1.00** (8 F1 calls / 8 receipts) — the design limit is 2. Offer choice, money math, the rule and the receipt are code: no call is spent on them.
- F2 and F3 run only when a person asks, and the same question on the same record is answered from the answers log with 0 calls.
- Energy per purchase (F1, est.): **0.1014 Wh**.
- F2 explain: 6 calls = v1 ×2 · v2 ×2 · v3 ×2 (one call per receipt per prompt version)
- F3 dispute: 12 calls = v1 ×3 · v2 ×3 · v3 ×3 · v4 ×3 (one call per question per prompt version)
- Prompt revisions came from live answers: v1 → times to the second and a code-written STOP relation → numbers only from the facts (see the commit log).

## Energy — an assumption, not a measurement
Kiln exposes no power telemetry, so Wh = 180 W × measured wall time ÷ 3600 per call. 180 W source: FuriosaAI RNGD card TDP — "180W TDP", furiosa.ai/rngd, checked 2026-09-26. It is an upper bound: 180 W NPU card × request wall time (upper bound; whole card attributed to this request). Wall time is measured at the client, so it also includes network time.

## Generation ids (Kiln `X-Neocloud-Generation-Id`)
- F1 intent: `d919cfd0-5e71-46fc-8ec0-6fad043902de` · `a83ece71-1d04-48cf-8cbf-38d1789e184f` · `00d1184c-2b24-43b9-b4f0-43a09039447b` · `0d72f2ca-d20d-40e5-af68-eb3ed9000660` · `bec549da-0c5e-4c45-b845-7a922da104c7` · `6bd3f0d9-086c-4a7c-8fe4-a8e5aac42b44` · `08b3ef5e-d928-428a-8d39-ff7e50d4d8c4` · `1985998e-c88d-4ed3-806e-713c7fd5ef24`
- F2 explain: `e6ebd78a-1c0c-4863-97bc-0754f3ea8549` · `04da11bb-35cc-4626-9ee5-a68e277ad32c` · `53f41100-4caa-4377-aac1-abc3dfaa7d46` · `cccd1a4b-b964-4c53-bf96-9d8c2181b896` · `3a712866-d843-45a5-9058-dd1dbdb82b87` · `db754b5e-4b0e-425e-95a7-52903e4be32a`
- F3 dispute: `d1bdd9c8-718d-4782-88d2-7c0ec57565c4` · `2389917f-9859-4351-abd0-45c6dbad197f` · `ffa30c87-4961-40fc-88cd-28393651542c` · `7c4141f9-35c4-46af-9b51-8a852328d94d` · `35c56cc2-328c-4fa0-ba8d-449afa868d54` · `74dda3ce-ce35-4aba-9627-390e55e79c2b` · `b720fc26-26ae-43e0-af6e-fc7a16d3a7d1` · `c856ef6f-93ef-4b67-b27c-0105ffc7caa7` · `1a19f663-d670-4b27-a5da-5490ebcb3a39` · `9040d65b-c3d2-408e-a9c4-e479e8053f1c` · `952891d8-988e-4397-8f6c-465fc1256204` · `a9e39d12-f8e3-40fa-9862-447222db447d`

## /no_think A/B — n = 12 pairs
Same F1 request, sent once with Qwen3's `/no_think` soft switch and once with thinking on, pairs in alternating order, 2026-09-26. Raw calls with generation ids: `docs/ab-no-think-2026-09-26.json`.

| Arm | n | JSON parsed | Median output tokens | Median latency | Median Wh (est.) | USD total |
|---|---:|---:|---:|---:|---:|---:|
| `/no_think` (production) | 12 | 100% | 36 | 0.95 s | 0.0474 | $0.0001954 |
| thinking on | 12 | 100% | 223 | 3.50 s | 0.1748 | $0.0009188 |

- Same JSON (item · quantity · price cap · seller hint): 12 / 12 pairs.
- `/no_think` saves 84% of median output tokens and 73% of median latency (≈ the same share of estimated Wh).

Regenerate: `npm run report` (reads the files above; no key).
