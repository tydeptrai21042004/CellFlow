import type { EvidenceDocument, EvidenceStateEvent, ExecutionSnapshot } from "./types.js";
import { deriveOverallStatus } from "./state-machine.js";

export interface EvidenceInput {
  projectId: string;
  intentId: string;
  txHash: string | null;
  network: string;
  snapshot: ExecutionSnapshot;
  assertionStatus: string | null;
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
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    events: sortedEvents,
  };
}

export function stableEvidenceJson(document: EvidenceDocument): string {
  return JSON.stringify(document, null, 2) + "\n";
}
