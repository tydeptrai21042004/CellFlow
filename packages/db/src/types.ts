import type {
  ChainStatus,
  ConfirmationPolicy,
  ExecutionSnapshot,
  SubmissionStatus,
  WorkflowStatus,
} from "@cellflow/core";


export type ApiKeyScope = "read" | "write" | "admin";

export interface ApiKeyAuthRecord {
  id: string;
  projectId: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
}

export interface OperationalHealthRecord {
  dueReconciliations: number;
  leasedReconciliations: number;
  staleActiveIntents: number;
  oldestActiveAgeSeconds: number | null;
  pendingWebhooks: number;
  failedWebhooks: number;
  activeApiKeys: number;
  expiringApiKeys7d: number;
  lastEventAt: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  network: "testnet" | "mainnet" | "devnet";
  rpcUrl: string | null;
  rpcGenesisHash: string | null;
  confirmationPolicy: ConfirmationPolicy;
  createdAt: string;
}

export interface IntentRecord {
  id: string;
  projectId: string;
  intentId: string;
  metadata: Record<string, unknown>;
  expectedCells: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRecord {
  id: string;
  projectId: string;
  intentRowId: string;
  txHash: string | null;
  network: string;
  submissionStatus: SubmissionStatus;
  chainStatus: ChainStatus;
  workflowStatus: WorkflowStatus;
  confirmationPolicy: ConfirmationPolicy;
  confirmationCount: number;
  committedBlockHash: string | null;
  committedBlockNumber: string | null;
  rejectionReason: string | null;
  assertionStatus: string | null;
  assertionResult: unknown;
  lastRawObservation: unknown;
  lastObservedAt: string | null;
  nextReconcileAt: string | null;
  reconcileAttempts: number;
  version: number;
  reconcileLeaseId: string | null;
  reconcileLeaseUntil: string | null;
  workflowRunId: string | null;
  workflowStartedAt: string | null;
  workflowCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntentAggregate {
  intent: IntentRecord;
  execution: ExecutionRecord;
}


export interface IntentListCursor {
  createdAt: string;
  id: string;
}

export interface IntentListPage {
  items: IntentAggregate[];
  nextCursor: IntentListCursor | null;
}

export interface StateEventRecord {
  sequence: number;
  id: string;
  kind: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  rawObservation: unknown;
  occurredAt: string;
}

export interface WebhookEndpointRecord {
  id: string;
  projectId: string;
  url: string;
  signingSecretEncrypted: string;
  secretVersion: number;
  enabled: boolean;
}

export interface WebhookDeliveryRecord {
  id: string;
  projectId: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  attemptCount: number;
  status: string;
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
}

export interface EvidenceExportRecord {
  id: string;
  evidenceSha256: string;
  schemaVersion: string;
  maxEventSequence: number;
  createdAt: string;
}

export function snapshotFromExecution(row: ExecutionRecord): ExecutionSnapshot {
  return {
    submissionStatus: row.submissionStatus,
    chainStatus: row.chainStatus,
    workflowStatus: row.workflowStatus,
    confirmationPolicy: row.confirmationPolicy,
    confirmationCount: row.confirmationCount,
    ...(row.committedBlockHash ? { committedBlockHash: row.committedBlockHash } : {}),
    ...(row.committedBlockNumber ? { committedBlockNumber: row.committedBlockNumber } : {}),
    ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
  };
}
