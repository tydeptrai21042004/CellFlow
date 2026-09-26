import type {
  ConflictType,
  EvidenceDocument,
  EvidenceStateEvent,
  ExecutionSnapshot,
  OutPointRef,
  SubmissionErrorType,
} from "./types.ts";
import { deriveOverallStatus, deriveRecommendedAction } from "./state-machine.ts";

export interface EvidenceInput {
  projectId: string;
  intentId: string;
  txHash: string | null;
  inputOutPoints: OutPointRef[];
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
    schemaVersion: "cellflow-evidence-v1",
    projectId: input.projectId,
    intentId: input.intentId,
    txHash: input.txHash,
    inputOutPoints: input.inputOutPoints,
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
    recommendedAction: deriveRecommendedAction(input.snapshot, input.conflictType, input.assertionStatus),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    events: sortedEvents,
  };
}

export function stableEvidenceJson(document: EvidenceDocument): string {
  return JSON.stringify(document, null, 2) + "\n";
}
