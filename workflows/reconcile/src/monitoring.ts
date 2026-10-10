/** Bounded optional monitoring; zero (default) retains historical terminal behavior. */
export function postSettlementMonitorMs(): number {
  const raw = process.env.CELLFLOW_POST_CONFIRMATION_MONITOR_MS;
  if (raw === undefined || raw.trim() === "") return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 7 * 24 * 60 * 60_000);
}

export function shouldContinueSettlementMonitoring(
  ready: boolean,
  firstReadyAt: string | null,
  nowMs: number,
  horizonMs = postSettlementMonitorMs(),
): boolean {
  if (!ready || horizonMs <= 0 || !firstReadyAt) return false;
  const startedMs = Date.parse(firstReadyAt);
  return Number.isFinite(startedMs) && nowMs < startedMs + horizonMs;
}


/**
 * A previously verified live Cell may be legitimately spent later. Preserve
 * its point-in-time settlement proof while its committed block remains the
 * same canonical block. A block change or explicit reorg requires fresh checks.
 */
export function shouldReverifyExpectedCells(input: {
  previouslySettled: boolean;
  previouslyVerified: boolean;
  priorCommittedBlockHash: string | null;
  currentCommittedBlockHash: string | null;
  reorgDetected: boolean;
}): boolean {
  return !input.previouslySettled || !input.previouslyVerified ||
    input.reorgDetected || !input.priorCommittedBlockHash ||
    !input.currentCommittedBlockHash ||
    input.priorCommittedBlockHash !== input.currentCommittedBlockHash;
}
