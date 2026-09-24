import { CellFlowError } from "./errors.js";
import type {
  ApplyObservationResult,
  ChainObservation,
  ConfirmationPolicy,
  ExecutionSnapshot,
  OverallStatus,
  SubmissionStatus,
  WorkflowStatus,
} from "./types.js";

export function parseHexBlockNumber(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  if (!/^0x[0-9a-f]+$/i.test(value)) return undefined;
  return BigInt(value);
}

export function computeConfirmationCount(
  committedBlockNumber?: string,
  tipBlockNumber?: string,
): number {
  const committed = parseHexBlockNumber(committedBlockNumber);
  const tip = parseHexBlockNumber(tipBlockNumber);
  if (committed === undefined || tip === undefined || tip < committed) return 0;
  const depth = tip - committed + 1n;
  return depth > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(depth);
}

export function isConfirmationSatisfied(
  policy: ConfirmationPolicy,
  chainStatus: ExecutionSnapshot["chainStatus"],
  confirmationCount: number,
): boolean {
  if (chainStatus !== "COMMITTED") return false;
  if (policy.mode === "committed") return true;
  return confirmationCount >= policy.blocks;
}

export function deriveOverallStatus(snapshot: ExecutionSnapshot): OverallStatus {
  if (snapshot.workflowStatus === "CONFLICTED") return "CONFLICTED";
  if (snapshot.workflowStatus === "EXPIRED") return "EXPIRED";
  if (snapshot.chainStatus === "REJECTED") return "REJECTED";
  if (snapshot.workflowStatus === "REORGED") return "REORGED";
  if (snapshot.workflowStatus === "CONFIRMED") return "CONFIRMED";
  if (snapshot.chainStatus === "COMMITTED") return "COMMITTED";
  if (snapshot.chainStatus === "PROPOSED") return "PROPOSED";
  if (snapshot.chainStatus === "PENDING") return "PENDING";
  if (snapshot.workflowStatus === "RECONCILING") return "RECONCILING";
  if (snapshot.chainStatus === "UNKNOWN") return "UNKNOWN";
  if (snapshot.submissionStatus === "SUBMITTED") return "SUBMITTED";
  if (snapshot.submissionStatus === "SUBMISSION_UNKNOWN") return "UNKNOWN";
  if (snapshot.submissionStatus === "BROADCASTING") return "SUBMITTING";
  if (snapshot.submissionStatus === "PREPARED") return "PREPARED";
  return "CREATED";
}

export function initialSnapshot(
  confirmationPolicy: ConfirmationPolicy = { mode: "depth", blocks: 4 },
): ExecutionSnapshot {
  return {
    submissionStatus: "NOT_SUBMITTED",
    chainStatus: "UNOBSERVED",
    workflowStatus: "IDLE",
    confirmationPolicy,
    confirmationCount: 0,
  };
}

export function updateSubmission(
  snapshot: ExecutionSnapshot,
  next: SubmissionStatus,
): ExecutionSnapshot {
  if (snapshot.workflowStatus === "CONFLICTED" || snapshot.workflowStatus === "EXPIRED") {
    throw new CellFlowError(
      "TRANSITION_INVALID",
      `Cannot change submission state after ${snapshot.workflowStatus}`,
      409,
    );
  }
  if (snapshot.chainStatus === "REJECTED") {
    throw new CellFlowError(
      "TRANSITION_INVALID",
      "Cannot change submission state after authoritative rejection",
      409,
    );
  }

  const order: SubmissionStatus[] = [
    "NOT_SUBMITTED",
    "PREPARED",
    "BROADCASTING",
    "SUBMISSION_UNKNOWN",
    "SUBMITTED",
  ];
  const currentIndex = order.indexOf(snapshot.submissionStatus);
  const nextIndex = order.indexOf(next);
  const allowedAmbiguousRecovery =
    snapshot.submissionStatus === "SUBMISSION_UNKNOWN" && next === "SUBMITTED";

  if (nextIndex < currentIndex && !allowedAmbiguousRecovery) {
    throw new CellFlowError(
      "TRANSITION_INVALID",
      `Submission state cannot move backward from ${snapshot.submissionStatus} to ${next}`,
      409,
    );
  }

  return { ...snapshot, submissionStatus: next };
}

function reorgAgainstPriorCommit(
  snapshot: ExecutionSnapshot,
  observation: ChainObservation,
): boolean {
  if (!snapshot.committedBlockHash) return false;
  if (observation.status === "COMMITTED") {
    return Boolean(observation.blockHash && observation.blockHash !== snapshot.committedBlockHash);
  }
  // UNKNOWN alone is not authoritative evidence of a reorg; another RPC may simply be stale or unavailable.
  return observation.status === "PENDING" || observation.status === "PROPOSED";
}

export function applyChainObservation(
  snapshot: ExecutionSnapshot,
  observation: ChainObservation,
): ApplyObservationResult {
  const before = deriveOverallStatus(snapshot);

  if (snapshot.workflowStatus === "CONFLICTED" || snapshot.workflowStatus === "EXPIRED") {
    throw new CellFlowError(
      "TRANSITION_INVALID",
      `Cannot apply chain observation after ${snapshot.workflowStatus}`,
      409,
    );
  }

  const reorgDetected = reorgAgainstPriorCommit(snapshot, observation);
  const confirmationCount =
    observation.status === "COMMITTED"
      ? computeConfirmationCount(observation.blockNumber, observation.tipBlockNumber)
      : 0;

  let next: ExecutionSnapshot = {
    ...snapshot,
    chainStatus: observation.status,
    confirmationCount,
    ...(observation.rejectionReason
      ? { rejectionReason: observation.rejectionReason }
      : snapshot.rejectionReason
        ? { rejectionReason: snapshot.rejectionReason }
        : {}),
  };

  if (observation.status === "COMMITTED") {
    next = {
      ...next,
      ...(observation.blockHash ? { committedBlockHash: observation.blockHash } : {}),
      ...(observation.blockNumber ? { committedBlockNumber: observation.blockNumber } : {}),
      workflowStatus: isConfirmationSatisfied(
        snapshot.confirmationPolicy,
        "COMMITTED",
        confirmationCount,
      )
        ? "CONFIRMED"
        : "WAITING_CONFIRMATIONS",
    };
  } else if (observation.status === "REJECTED") {
    next = { ...next, workflowStatus: "IDLE" };
  } else if (reorgDetected) {
    const { committedBlockHash: _oldHash, committedBlockNumber: _oldNumber, ...withoutCommit } = next;
    next = {
      ...withoutCommit,
      workflowStatus: "REORGED",
    };
  } else if (observation.status === "UNKNOWN") {
    next = { ...next, workflowStatus: "RECONCILING" };
  } else {
    next = { ...next, workflowStatus: "RECONCILING" };
  }

  const after = deriveOverallStatus(next);
  return {
    snapshot: next,
    reorgDetected,
    event: {
      kind: reorgDetected
        ? "REORG_DETECTED"
        : next.workflowStatus === "CONFIRMED"
          ? "CONFIRMED"
          : "CHAIN_OBSERVED",
      fromOverall: before,
      toOverall: after,
      at: observation.observedAt,
      observation,
      ...(reorgDetected
        ? { reason: "Previously committed transaction is no longer observed in the same canonical block" }
        : {}),
    },
  };
}

export function setWorkflowStatus(
  snapshot: ExecutionSnapshot,
  status: WorkflowStatus,
): ExecutionSnapshot {
  if (status === "CONFIRMED" && snapshot.chainStatus !== "COMMITTED") {
    throw new CellFlowError(
      "TRANSITION_INVALID",
      "CONFIRMED requires COMMITTED chain state",
      409,
    );
  }
  return { ...snapshot, workflowStatus: status };
}
