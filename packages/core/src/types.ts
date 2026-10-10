export const submissionStatuses = [
  "NOT_SUBMITTED",
  "PREPARED",
  "BROADCASTING",
  "SUBMITTED",
  "SUBMISSION_UNKNOWN",
  "NODE_REJECTED",
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
  "NODE_REJECTED",
  "CONFLICTED",
  "EXPIRED",
] as const;
export type OverallStatus = (typeof overallStatuses)[number];

export interface OutPointRef {
  txHash: string;
  index: number;
}

export const inputRoles = [
  "APPLICATION_STATE",
  "WALLET_FUNDING",
  "FEE",
  "DEPENDENCY",
  "OTHER",
] as const;
export type InputRole = (typeof inputRoles)[number];

export interface InputRef {
  outPoint: OutPointRef;
  role: InputRole;
  resourceKey?: string;
}

export const attemptKinds = [
  "INITIAL",
  "REBUILD",
  "RBF_REPLACEMENT",
  "MANUAL_RETRY",
] as const;
export type AttemptKind = (typeof attemptKinds)[number];

export const attemptDispositions = [
  "ACTIVE",
  "SUPERSEDED",
  "CONFIRMED",
  "REJECTED",
  "CONFLICTED",
  "ABANDONED",
] as const;
export type AttemptDisposition = (typeof attemptDispositions)[number];

export type ConflictDomain = "APPLICATION" | "WALLET" | "MIXED" | "UNKNOWN";

export const conflictTypes = [
  "INPUT_CONFLICT_SUSPECTED",
  "INPUT_SPENT",
  "EXPECTED_CELL_ASSERTION_FAILED",
  "REORG_CONFLICT",
  "SIGNED_PAYLOAD_MISMATCH",
  "OTHER",
] as const;
export type ConflictType = (typeof conflictTypes)[number];

export const recommendedActions = [
  "NONE",
  "WAIT_FOR_RECONCILIATION",
  "WAIT_AND_RECONCILE",
  "REBUILD_FROM_LIVE_STATE",
  "RECOLLECT_WALLET_INPUTS",
  "REBUILD_AND_RESIGN",
  "RECONCILE_CANONICAL_STATE",
  "WAIT_FOR_MATURITY",
  "MANUAL_REVIEW",
] as const;
export type RecommendedAction = (typeof recommendedActions)[number];

export const submissionErrorTypes = [
  "TRANSPORT_UNKNOWN",
  "RPC_REJECTION",
  "HASH_MISMATCH",
] as const;
export type SubmissionErrorType = (typeof submissionErrorTypes)[number];

export interface SubmissionFailureEvidence {
  errorCode?: string;
  errorType: SubmissionErrorType;
  errorMessage?: string;
  conflictType?: ConflictType;
  details?: Record<string, unknown>;
}

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
  rpcEndpoint?: string;
  canonicalBlockHash?: string;
  priorCommitCanonical?: boolean;
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

export interface EvidenceAttempt {
  id: string;
  attemptNumber: number;
  txHash: string;
  signedPayloadHashSha256: string | null;
  parentAttemptId: string | null;
  replacesAttemptId: string | null;
  replacedByAttemptId: string | null;
  attemptKind: AttemptKind;
  disposition: AttemptDisposition;
  inputRefs: InputRef[];
  submissionStatus: SubmissionStatus;
  chainStatus: ChainStatus;
  workflowStatus: WorkflowStatus;
  conflictType: ConflictType | null;
  conflictDetails: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceDocument {
  schemaVersion: "cellflow-evidence-v2";
  projectId: string;
  intentId: string;
  txHash: string | null;
  inputOutPoints: OutPointRef[];
  inputRefs: InputRef[];
  activeAttemptId: string | null;
  winningAttemptId: string | null;
  attempts: EvidenceAttempt[];
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
  settlementReady: boolean;
  settlementReadyAt: string | null;
  submissionErrorCode: string | null;
  submissionErrorType: SubmissionErrorType | null;
  submissionErrorDetails: unknown;
  conflictType: ConflictType | null;
  conflictDetails: unknown;
  recommendedAction: RecommendedAction;
  createdAt: string;
  updatedAt: string;
  events: EvidenceStateEvent[];
}
