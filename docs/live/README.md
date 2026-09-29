# docs/live — terminal transcripts and run logs (verbatim)

- `agent-*-rNN.txt` — `npm run agent` runs, one receipt each (#9–#15 in the window, #25–#29 on the organizer-issued Kiln account).
- `mcp-2026-09-29-runN.txt` + `mcp-host-*.json` — `npm run mcp:host` runs (Qwen3-32B on Kiln as an MCP host's planner). Log files are named to the second since run 5:
  run 4 and run 5 started in the same minute, so run 5 first wrote `mcp-host-202609291323.json` over run 4's log (the name both transcripts print). Run 5's log was renamed to `mcp-host-20260929132352.json`; run 4's was rebuilt as `mcp-host-20260929132318.json` from its transcript, the usage committed in receipts #22–#24 and Kiln's own record of the closing call (marked `reconstructed` inside).
  `38a3cae+dirty` in run 5 = the working tree differed from the commit only in `docs/` (run 4's new receipts); the code was `38a3cae`. The CLI now ignores `docs/` and `web/public/` for that mark.
- `agents-sdk-demo-2026-09-29*.txt` — the stock OpenAI Agents SDK on Kiln against the keyless demo MCP server (the first run found a race, fixed).
- `mcp-inspector-demo-2026-09-29.txt` — the official MCP Inspector CLI against the keyless demo server.
- `mandate-N.json`, `grant-*.txt`, `stop-*.txt` — the lines the person signed (owner CLI) and their txs.
