// AC-44 — the MCP host runs saved by `npm run mcp:host` (docs/live/mcp-host-*.json): their Kiln calls, labelled F4.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { HostRunLog } from '../application/report';
import type { Receipt } from '../domain/receipt';
import { relabelHostCalls, type UsageRecord } from '../domain/tokenLedger';

export function hostLogs(dir = 'docs/live'): (HostRunLog & { started?: string; request?: string; commit?: string })[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^mcp-host-.*\.json$/.test(n)).sort().map((n) => JSON.parse(readFileSync(`${dir}/${n}`, 'utf8')));
}
export const hostIds = (logs = hostLogs()): Set<string> => new Set(logs.flatMap((l) => l.calls.map((c) => c.generationId)));
/** Receipts with the host's planner calls reported as F4 (copies; the file and its hashes stay as recorded). */
export const withHostFlows = (receipts: Receipt[], logs = hostLogs()): Receipt[] => relabelHostCalls(receipts, hostIds(logs));
/** Host calls that are in no receipt (a closing answer, a call refused before the chain, a call the host could not parse). */
export function hostCallsOutsideReceipts(receipts: Receipt[], logs = hostLogs()): UsageRecord[] {
  const inReceipts = new Set(receipts.flatMap((r) => r.flows.map((u) => u.generationId)));
  return logs.flatMap((l) => l.calls).filter((u) => !inReceipts.has(u.generationId)).map((u) => ({ ...u, flow: 'F4_mcp_host' as const }));
}
