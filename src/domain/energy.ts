/**
 * Energy is estimated, never "measured", unless Kiln exposes power telemetry. The number always travels with its assumption.
 * Default assumption: FuriosaAI RNGD card TDP 180 W, whole card attributed to the request for its wall time (upper bound).
 */
export type EnergyInput = { latencyMs: number; npuWatts?: number };
export function estimateEnergy({ latencyMs, npuWatts = 180 }: EnergyInput): { wh: number; assumption: string } {
  const wh = (npuWatts * (latencyMs / 1000)) / 3600;
  return { wh, assumption: `${npuWatts} W NPU card × request wall time (upper bound; whole card attributed to this request)` };
}
