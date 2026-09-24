export const submissionStatuses = [
  "NOT_SUBMITTED",
  "PREPARED",
  "BROADCASTING",
  "SUBMITTED",
  "SUBMISSION_UNKNOWN",
] as const;
export type SubmissionStatus = (typeof submissionStatuses)[number];

export const chainStatuses = [
  "UNOBSERVED",
  "UNKNOWN",
  "PENDING",
  "PROPOSED",
  "COMMITTED",
  "REJECTED",
] as const;
export type ChainStatus = (typeof chainStatuses)[number];

export const workflowStatuses = [
  "IDLE",
  "RECONCILING",
  "WAITING_CONFIRMATIONS",
  "CONFIRMED",
  "REORGED",
  "CONFLICTED",
  "EXPIRED",
] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];

export const overallStatuses = [
  "CREATED",
  "PREPARED",
  "SUBMITTING",
  "SUBMITTED",
  "UNKNOWN",
  "PENDING",
  "PROPOSED",
  "COMMITTED",
  "CONFIRMED",
  "RECONCILING",
  "REORGED",
  "REJECTED",
  "CONFLICTED",
  "EXPIRED",
] as const;
export type OverallStatus = (typeof overallStatuses)[number];

export interface ConfirmationPolicyCommitted {
  mode: "committed";
}

export interface ConfirmationPolicyDepth {
  mode: "depth";
  blocks: number;
}

export type ConfirmationPolicy =
  | ConfirmationPolicyCommitted
  | ConfirmationPolicyDepth;

export interface ExecutionSnapshot {
  submissionStatus: SubmissionStatus;
  chainStatus: ChainStatus;
  workflowStatus: WorkflowStatus;
  confirmationPolicy: ConfirmationPolicy;
  confirmationCount: number;
  committedBlockHash?: string;
  committedBlockNumber?: string;
  rejectionReason?: string;
}

export interface ChainObservation {
  status: Exclude<ChainStatus, "UNOBSERVED">;
  observedAt: string;
  raw: unknown;
  blockHash?: string;
  blockNumber?: string;
  tipBlockNumber?: string;
  rejectionReason?: string;
}

export interface TransitionEvent {
  kind:
    | "CREATED"
    | "SUBMISSION_UPDATED"
    | "CHAIN_OBSERVED"
    | "WORKFLOW_UPDATED"
    | "REORG_DETECTED"
    | "CONFIRMED"
    | "ASSERTION_VERIFIED"
    | "ASSERTION_FAILED"
    | "OPERATOR_NOTE";
  fromOverall: OverallStatus;
  toOverall: OverallStatus;
  at: string;
  reason?: string;
  observation?: ChainObservation;
}

export interface ApplyObservationResult {
  snapshot: ExecutionSnapshot;
  event: TransitionEvent;
  reorgDetected: boolean;
}

export interface EvidenceStateEvent {
  sequence: number;
  kind: string;
  fromStatus: string | null;
  toStatus: string;
  occurredAt: string;
  reason: string | null;
  rawObservation: unknown;
}

export interface EvidenceDocument {
  schemaVersion: "cellflow-evidence-v1";
  projectId: string;
  intentId: string;
  txHash: string | null;
  network: string;
  overallStatus: OverallStatus;
  submissionStatus: SubmissionStatus;
  chainStatus: ChainStatus;
  workflowStatus: WorkflowStatus;
  confirmationPolicy: ConfirmationPolicy;
  confirmationCount: number;
  committedBlockHash: string | null;
  committedBlockNumber: string | null;
  assertionStatus: string | null;
  createdAt: string;
  updatedAt: string;
  events: EvidenceStateEvent[];
}
