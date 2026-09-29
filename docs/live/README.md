# docs/live — terminal transcripts and run logs (verbatim)

- `agent-*-rNN.txt` — `npm run agent` runs, one receipt each (#9–#15 in the window, #25–#29 on the organizer-issued Kiln account).
- `mcp-2026-09-29-runN.txt` + `mcp-host-*.json` — `npm run mcp:host` runs (Qwen3-32B on Kiln as an MCP host's planner). Log files are named to the second since run 5:
  run 4 and run 5 started in the same minute, so run 5 first wrote `mcp-host-202609291323.json` over run 4's log (the name both transcripts print). Run 5's log was renamed to `mcp-host-20260929132352.json`; run 4's was rebuilt as `mcp-host-20260929132318.json` from its transcript, the usage committed in receipts #22–#24 and Kiln's own record of the closing call (marked `reconstructed` inside).
  `38a3cae+dirty` in run 5 = the working tree differed from the commit only in `docs/` (run 4's new receipts); the code was `38a3cae`. The CLI now ignores `docs/` and `web/public/` for that mark.
- `agents-sdk-demo-*.txt` — the stock OpenAI Agents SDK on Kiln against the keyless demo MCP server (the first run found a race, fixed).
- `agents-sdk-live-*.txt` + `mcp-host-*-agents-sdk.json` + `kiln-journal-*.jsonl` — the stock OpenAI Agents SDK, unmodified, on Kiln through the Spendline pass-through, paying on the live vault: #32–#34 (23:44 KST), #35–#36 with thinking off, then the same request refused on-chain twice (00:20 KST). The journal is the pass-through's record of each Kiln reply: generation id, usage, the tool calls asked for, the person's request (first user message), a hash of the conversation's opening and of Kiln's reply body — `npm run attest` checks every bound receipt's arguments against it byte for byte.
- `mcp-inspector-demo-2026-09-29.txt` — the official MCP Inspector CLI against the keyless demo server.
- `mandate-N.json`, `grant-*.txt`, `stop-*.txt` — the lines the person signed (owner CLI) and their txs.
