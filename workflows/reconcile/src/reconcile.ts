import {
  applyChainObservation,
  deriveOverallStatus,
  setWorkflowStatus,
  type ExecutionSnapshot,
} from "@cellflow/core";
import { verifyExpectedCells, type ExpectedCellAssertion } from "@cellflow/assertions";
import { CellFlowRepository, snapshotFromExecution, type IntentAggregate } from "@cellflow/db";
import { CkbRpcClient, observeTransaction } from "./rpc.js";

function backoffMs(attempt: number, chainStatus: string): number {
  if (chainStatus === "COMMITTED") return 12_000;
  const base = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempt, 6));
  return base;
}

function endpointsFor(projectRpcUrl: string | null): string[] {
  const urls = [projectRpcUrl, process.env.CKB_RPC_URL, process.env.CKB_RPC_FALLBACK_URL]
    .filter((value): value is string => Boolean(value));
  return [...new Set(urls)];
}

export interface ReconcileResult {
  intentId: string;
  txHash: string | null;
  changed: boolean;
  status: string;
  assertionStatus: string | null;
}

export async function reconcileIntent(
  aggregate: IntentAggregate,
  repository = new CellFlowRepository(),
): Promise<ReconcileResult> {
  const txHash = aggregate.execution.txHash;
  if (!txHash) {
    return {
      intentId: aggregate.intent.intentId,
      txHash: null,
      changed: false,
      status: deriveOverallStatus(snapshotFromExecution(aggregate.execution)),
      assertionStatus: aggregate.execution.assertionStatus,
    };
  }

  const project = await repository.getProject(aggregate.intent.projectId);
  if (!project) throw new Error("Project missing during reconciliation");
  const client = new CkbRpcClient(endpointsFor(project.rpcUrl));
  const prior = snapshotFromExecution(aggregate.execution);

  try {
    const { observation, rpcResult } = await observeTransaction(client, txHash);
    const applied = applyChainObservation(prior, observation);
    let nextSnapshot: ExecutionSnapshot = applied.snapshot;
    let assertionStatus = aggregate.execution.assertionStatus;
    let assertionResult: unknown = aggregate.execution.assertionResult;
    let eventKind = applied.event.kind;
    let reason = applied.event.reason;

    const shouldAssert = nextSnapshot.workflowStatus === "CONFIRMED" && aggregate.intent.expectedCells.length > 0;
    if (shouldAssert) {
      const transaction = rpcResult?.transaction;
      if (!transaction) {
        assertionStatus = "PENDING";
      } else {
        const results = verifyExpectedCells(
          transaction,
          aggregate.intent.expectedCells as ExpectedCellAssertion[],
        );
        assertionResult = results;
        if (results.every((result) => result.ok)) {
          assertionStatus = "VERIFIED";
          eventKind = "ASSERTION_VERIFIED";
        } else {
          assertionStatus = "FAILED";
          nextSnapshot = setWorkflowStatus(nextSnapshot, "CONFLICTED");
          eventKind = "ASSERTION_FAILED";
          reason = "Committed transaction did not produce the expected Cell state";
        }
      }
    }

    const terminal =
      nextSnapshot.workflowStatus === "CONFIRMED" ||
      nextSnapshot.workflowStatus === "CONFLICTED" ||
      nextSnapshot.workflowStatus === "EXPIRED" ||
      nextSnapshot.chainStatus === "REJECTED";
    const nextReconcileAt = terminal
      ? null
      : new Date(Date.now() + backoffMs(aggregate.execution.reconcileAttempts, nextSnapshot.chainStatus));

    const eventId = await repository.applySnapshot({
      aggregate,
      snapshot: nextSnapshot,
      event: {
        kind: eventKind,
        fromStatus: applied.event.fromOverall,
        toStatus: deriveOverallStatus(nextSnapshot),
        ...(reason ? { reason } : {}),
        rawObservation: observation.raw,
        occurredAt: observation.observedAt,
      },
      nextReconcileAt,
      assertionStatus,
      assertionResult,
    });

    if (eventId) {
      await repository.enqueueWebhookDeliveries({
        projectId: aggregate.intent.projectId,
        eventId,
        eventType: `intent.${deriveOverallStatus(nextSnapshot).toLowerCase()}`,
        payload: {
          id: eventId,
          type: `intent.${deriveOverallStatus(nextSnapshot).toLowerCase()}`,
          occurredAt: observation.observedAt,
          data: {
            intentId: aggregate.intent.intentId,
            txHash,
            status: deriveOverallStatus(nextSnapshot),
            submissionStatus: nextSnapshot.submissionStatus,
            chainStatus: nextSnapshot.chainStatus,
            workflowStatus: nextSnapshot.workflowStatus,
            confirmationCount: nextSnapshot.confirmationCount,
            assertionStatus,
          },
        },
      });
    }

    return {
      intentId: aggregate.intent.intentId,
      txHash,
      changed: Boolean(eventId),
      status: deriveOverallStatus(nextSnapshot),
      assertionStatus: assertionStatus ?? null,
    };
  } catch (error) {
    const reconciling = setWorkflowStatus(prior, "RECONCILING");
    const nextReconcileAt = new Date(Date.now() + backoffMs(aggregate.execution.reconcileAttempts, "UNKNOWN"));
    const eventId = await repository.applySnapshot({
      aggregate,
      snapshot: { ...reconciling, chainStatus: "UNKNOWN" },
      event: {
        kind: "WORKFLOW_UPDATED",
        fromStatus: deriveOverallStatus(prior),
        toStatus: "RECONCILING",
        reason: error instanceof Error ? error.message : "RPC observation failed",
        occurredAt: new Date().toISOString(),
      },
      nextReconcileAt,
    });
    return {
      intentId: aggregate.intent.intentId,
      txHash,
      changed: Boolean(eventId),
      status: "RECONCILING",
      assertionStatus: aggregate.execution.assertionStatus,
    };
  }
}

export async function reconcileDue(limit = 25): Promise<ReconcileResult[]> {
  const repository = new CellFlowRepository();
  const due = await repository.listDueExecutions(limit);
  const results: ReconcileResult[] = [];
  for (const aggregate of due) {
    results.push(await reconcileIntent(aggregate, repository));
  }
  return results;
}
