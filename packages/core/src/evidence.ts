import type {
  ConflictType,
  EvidenceDocument,
  EvidenceStateEvent,
  ExecutionSnapshot,
  EvidenceAttempt,
  InputRef,
  OutPointRef,
  SubmissionErrorType,
} from "./types.ts";
import { deriveOverallStatus, deriveRecommendedAction } from "./state-machine.ts";

export interface EvidenceInput {
  projectId: string;
  intentId: string;
  txHash: string | null;
  inputOutPoints: OutPointRef[];
  inputRefs: InputRef[];
  activeAttemptId: string | null;
  winningAttemptId: string | null;
  attempts: EvidenceAttempt[];
  network: string;
  snapshot: ExecutionSnapshot;
  assertionStatus: string | null;
  submissionErrorCode: string | null;
  submissionErrorType: SubmissionErrorType | null;
  submissionErrorDetails: unknown;
  conflictType: ConflictType | null;
  conflictDetails: unknown;
  createdAt: string;
  updatedAt: string;
  events: EvidenceStateEvent[];
}

export function buildEvidence(input: EvidenceInput): EvidenceDocument {
  const sortedEvents = [...input.events].sort((a, b) => a.sequence - b.sequence);
  return {
    schemaVersion: "cellflow-evidence-v2",
    projectId: input.projectId,
    intentId: input.intentId,
    txHash: input.txHash,
    inputOutPoints: input.inputOutPoints,
    inputRefs: input.inputRefs,
    activeAttemptId: input.activeAttemptId,
    winningAttemptId: input.winningAttemptId,
    attempts: [...input.attempts].sort((a, b) => a.attemptNumber - b.attemptNumber),
    network: input.network,
    overallStatus: deriveOverallStatus(input.snapshot),
    submissionStatus: input.snapshot.submissionStatus,
    chainStatus: input.snapshot.chainStatus,
    workflowStatus: input.snapshot.workflowStatus,
    confirmationPolicy: input.snapshot.confirmationPolicy,
    confirmationCount: input.snapshot.confirmationCount,
    committedBlockHash: input.snapshot.committedBlockHash ?? null,
    committedBlockNumber: input.snapshot.committedBlockNumber ?? null,
    assertionStatus: input.assertionStatus,
    submissionErrorCode: input.submissionErrorCode,
    submissionErrorType: input.submissionErrorType,
    submissionErrorDetails: input.submissionErrorDetails,
    conflictType: input.conflictType,
    conflictDetails: input.conflictDetails,
    recommendedAction: deriveRecommendedAction(
      input.snapshot,
      input.conflictType,
      input.assertionStatus,
      input.conflictDetails,
      input.submissionErrorDetails,
    ),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    events: sortedEvents,
  };
}

export function stableEvidenceJson(document: EvidenceDocument): string {
  return JSON.stringify(document, null, 2) + "\n";
}
