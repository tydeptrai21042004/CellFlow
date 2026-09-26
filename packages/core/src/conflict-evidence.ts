import { parseHexBlockNumber } from "./state-machine.ts";
import type { ConfirmationPolicy } from "./types.ts";

export interface ConflictInputInspection {
  observedAt: string;
  tipBlockNumber: string | null;
  inputs: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export interface ConflictEvidenceState {
  confirmationPolicy: ConfirmationPolicy;
  conflictDetails: unknown;
}

export function conflictObservationMatured(
  execution: ConflictEvidenceState,
  inspection: ConflictInputInspection,
): boolean {
  const prior = asRecord(execution.conflictDetails);
  if (prior.classification !== "INPUT_SPENT_OBSERVED" || prior.continuityBroken === true) return false;
  const firstTip = typeof prior.firstObservedTipBlockNumber === "string"
    ? parseHexBlockNumber(prior.firstObservedTipBlockNumber)
    : undefined;
  const lastTip = typeof prior.lastObservedTipBlockNumber === "string"
    ? parseHexBlockNumber(prior.lastObservedTipBlockNumber)
    : undefined;
  const currentTip = inspection.tipBlockNumber
    ? parseHexBlockNumber(inspection.tipBlockNumber)
    : undefined;
  if (firstTip === undefined || lastTip === undefined || currentTip === undefined) return false;
  if (currentTip <= lastTip) return false;
  const observationCount = typeof prior.spentObservationCount === "number"
    ? prior.spentObservationCount
    : 1;
  if (observationCount < 1) return false;
  const requiredBlocks = execution.confirmationPolicy.mode === "depth"
    ? BigInt(Math.max(execution.confirmationPolicy.blocks, 1))
    : 1n;
  return currentTip >= firstTip + requiredBlocks;
}

export function nextSpentObservationDetails(
  conflictDetails: unknown,
  inspection: ConflictInputInspection,
): Record<string, unknown> {
  const priorDetails = asRecord(conflictDetails);
  const continues = priorDetails.classification === "INPUT_SPENT_OBSERVED" && priorDetails.continuityBroken !== true;
  const previousTip = typeof priorDetails.lastObservedTipBlockNumber === "string"
    ? parseHexBlockNumber(priorDetails.lastObservedTipBlockNumber)
    : undefined;
  const currentTip = inspection.tipBlockNumber ? parseHexBlockNumber(inspection.tipBlockNumber) : undefined;
  const distinctObservation = previousTip === undefined || currentTip === undefined || currentTip > previousTip;
  const previousCount = typeof priorDetails.spentObservationCount === "number"
    ? Math.max(1, Math.floor(priorDetails.spentObservationCount))
    : 1;
  return {
    source: "reconciliation",
    classification: "INPUT_SPENT_OBSERVED",
    canonicalSpendConfirmed: false,
    continuityBroken: false,
    firstObservedAt: continues
      ? priorDetails.firstObservedAt ?? inspection.observedAt
      : inspection.observedAt,
    firstObservedTipBlockNumber: continues
      ? priorDetails.firstObservedTipBlockNumber ?? inspection.tipBlockNumber
      : inspection.tipBlockNumber,
    lastObservedAt: inspection.observedAt,
    lastObservedTipBlockNumber: inspection.tipBlockNumber,
    spentObservationCount: continues
      ? previousCount + (distinctObservation ? 1 : 0)
      : 1,
    inputs: inspection.inputs,
  };
}

export function breakSpendObservationContinuity(
  conflictDetails: unknown,
  observedAt: string,
  reason: string,
): unknown {
  const prior = asRecord(conflictDetails);
  if (prior.classification !== "INPUT_SPENT_OBSERVED") return conflictDetails;
  return {
    ...prior,
    continuityBroken: true,
    continuityBrokenAt: observedAt,
    continuityBreakReason: reason,
  };
}
