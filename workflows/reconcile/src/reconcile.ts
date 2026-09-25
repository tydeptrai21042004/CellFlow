import { randomUUID } from "node:crypto";
import {
  applyChainObservation,
  deriveOverallStatus,
  setWorkflowStatus,
  type ExecutionSnapshot,
} from "@cellflow/core";
import {
  verifyExpectedCell,
  verifyLiveCell,
  type AssertionResult,
  type ExpectedCellAssertion,
} from "@cellflow/assertions";
import {
  CellFlowRepository,
  OptimisticConcurrencyError,
  snapshotFromExecution,
  type IntentAggregate,
} from "@cellflow/db";
import { CkbRpcClient, observeTransaction, parseRpcUrls } from "./rpc.ts";

export function nextReconcileDelayMs(attempt: number, chainStatus: string): number {
  if (["PENDING", "PROPOSED", "COMMITTED"].includes(chainStatus)) return 12_000;
  if (chainStatus === "UNKNOWN" || chainStatus === "UNOBSERVED") {
    return Math.min(5 * 60_000, 10_000 * 2 ** Math.min(attempt, 5));
  }
  return 20_000;
}

function endpointsFor(projectRpcUrl: string | null): string[] {
  return parseRpcUrls(
    projectRpcUrl,
    process.env.CKB_RPC_URL,
    process.env.CKB_RPC_FALLBACK_URL,
    process.env.CKB_RPC_FALLBACK_URLS,
  );
}

function expectedChain(network: string): string | null {
  if (network === "mainnet") return "ckb";
  if (network === "testnet") return "ckb_testnet";
  return null;
}

export interface ReconcileResult {
  intentId: string;
  txHash: string | null;
  changed: boolean;
  status: string;
  assertionStatus: string | null;
  terminal: boolean;
  nextDelayMs: number | null;
  error?: string;
}

function isTerminal(snapshot: ExecutionSnapshot, assertionStatus: string | null, expectedCount: number): boolean {
  if (snapshot.workflowStatus === "CONFLICTED" || snapshot.workflowStatus === "EXPIRED" || snapshot.chainStatus === "REJECTED") {
    return true;
  }
  if (snapshot.workflowStatus !== "CONFIRMED") return false;
  return expectedCount === 0 || assertionStatus === "VERIFIED";
}

async function evaluateAssertions(input: {
  client: CkbRpcClient;
  endpoint: string;
  txHash: string;
  transaction: Parameters<typeof verifyExpectedCell>[0] | null | undefined;
  assertions: ExpectedCellAssertion[];
}): Promise<{ status: "PENDING" | "VERIFIED" | "FAILED"; results: AssertionResult[] | null; reason?: string }> {
  if (!input.transaction) return { status: "PENDING", results: null };
  const results: AssertionResult[] = [];
  for (const assertion of input.assertions) {
    const created = verifyExpectedCell(input.transaction, assertion);
    results.push(created);
    if (!created.ok) {
      return { status: "FAILED", results, reason: "Committed transaction did not create the expected Cell state" };
    }
    if ((assertion.mode ?? "created") === "live") {
      try {
        const live = await input.client.getLiveCell(input.txHash, assertion.outputIndex, input.endpoint);
        const liveResult = verifyLiveCell(live, assertion);
        results.push(liveResult);
        if (!liveResult.ok) {
          return { status: "FAILED", results, reason: "Expected output Cell is not live or no longer matches the asserted state" };
        }
      } catch {
        return { status: "PENDING", results: null };
      }
    }
  }
  return { status: "VERIFIED", results };
}

async function reconcileIntentOnce(
  aggregate: IntentAggregate,
  repository: CellFlowRepository,
): Promise<ReconcileResult> {
  const txHash = aggregate.execution.txHash;
  if (!txHash) {
    return {
      intentId: aggregate.intent.intentId,
      txHash: null,
      changed: false,
      status: deriveOverallStatus(snapshotFromExecution(aggregate.execution)),
      assertionStatus: aggregate.execution.assertionStatus,
      terminal: false,
      nextDelayMs: null,
    };
  }

  const project = await repository.getProject(aggregate.intent.projectId);
  if (!project) throw new Error("Project missing during reconciliation");
  const urls = endpointsFor(project.rpcUrl);
  if (urls.length === 0) throw new Error("No CKB RPC endpoint configured");
  if (!project.rpcUrl && process.env.CKB_NETWORK && process.env.CKB_NETWORK !== project.network) {
    throw new Error(`Project network ${project.network} does not match global CKB_NETWORK ${process.env.CKB_NETWORK}`);
  }
  const client = new CkbRpcClient(urls);
  const prior = snapshotFromExecution(aggregate.execution);

  let observed;
  try {
    observed = await observeTransaction(
      client,
      txHash,
      prior.committedBlockHash && prior.committedBlockNumber
        ? { blockHash: prior.committedBlockHash, blockNumber: prior.committedBlockNumber }
        : undefined,
      {
        chain: expectedChain(project.network),
        genesisHash: project.rpcGenesisHash ?? process.env.CKB_EXPECTED_GENESIS_HASH ?? null,
      },
    );
  } catch (error) {
    // An RPC outage is absence of new evidence, not evidence that a previously
    // committed transaction disappeared. Route UNKNOWN through the state machine
    // so a trusted COMMITTED observation is preserved unless canonicality is
    // explicitly disproved.
    const observedAt = new Date().toISOString();
    const failureObservation = {
      status: "UNKNOWN" as const,
      observedAt,
      raw: {
        source: "rpc_failure",
        error: error instanceof Error ? error.message : "RPC observation failed",
      },
    };
    const applied = applyChainObservation(prior, failureObservation);
    const nextDelayMs = nextReconcileDelayMs(aggregate.execution.reconcileAttempts, "UNKNOWN");
    const eventId = await repository.applySnapshot({
      aggregate,
      snapshot: applied.snapshot,
      event: {
        kind: applied.event.kind,
        fromStatus: applied.event.fromOverall,
        toStatus: applied.event.toOverall,
        reason: applied.event.reason ?? (error instanceof Error ? error.message : "RPC observation failed"),
        rawObservation: failureObservation.raw,
        occurredAt: observedAt,
      },
      nextReconcileAt: new Date(Date.now() + nextDelayMs),
    });
    return {
      intentId: aggregate.intent.intentId,
      txHash,
      changed: Boolean(eventId),
      status: deriveOverallStatus(applied.snapshot),
      assertionStatus: aggregate.execution.assertionStatus,
      terminal: false,
      nextDelayMs,
    };
  }

  const { observation, rpcResult, endpoint } = observed;
  const applied = applyChainObservation(prior, observation);
  let nextSnapshot: ExecutionSnapshot = applied.snapshot;
  let assertionStatus = aggregate.execution.assertionStatus;
  let assertionResult: unknown = aggregate.execution.assertionResult;
  let eventKind = applied.event.kind;
  let reason = applied.event.reason;

  const assertions = aggregate.intent.expectedCells as ExpectedCellAssertion[];
  if (nextSnapshot.workflowStatus === "CONFIRMED" && assertions.length > 0) {
    const evaluated = await evaluateAssertions({
      client,
      endpoint,
      txHash,
      transaction: rpcResult?.transaction,
      assertions,
    });
    assertionStatus = evaluated.status;
    assertionResult = evaluated.results;
    if (evaluated.status === "VERIFIED") {
      eventKind = "ASSERTION_VERIFIED";
    } else if (evaluated.status === "FAILED") {
      nextSnapshot = setWorkflowStatus(nextSnapshot, "CONFLICTED");
      eventKind = "ASSERTION_FAILED";
      reason = evaluated.reason;
    }
  }

  const terminal = isTerminal(nextSnapshot, assertionStatus ?? null, assertions.length);
  const nextDelayMs = terminal
    ? null
    : nextReconcileDelayMs(aggregate.execution.reconcileAttempts, nextSnapshot.chainStatus);
  const nextReconcileAt = nextDelayMs === null ? null : new Date(Date.now() + nextDelayMs);

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

  return {
    intentId: aggregate.intent.intentId,
    txHash,
    changed: Boolean(eventId),
    status: deriveOverallStatus(nextSnapshot),
    assertionStatus: assertionStatus ?? null,
    terminal,
    nextDelayMs,
  };
}

export async function reconcileIntent(
  initial: IntentAggregate,
  repository = new CellFlowRepository(),
): Promise<ReconcileResult> {
  let aggregate = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await reconcileIntentOnce(aggregate, repository);
    } catch (error) {
      if (!(error instanceof OptimisticConcurrencyError) || attempt === 2) throw error;
      const refreshed = await repository.getIntent(aggregate.intent.projectId, aggregate.intent.intentId);
      if (!refreshed) throw error;
      aggregate = refreshed;
    }
  }
  throw new Error("Reconciliation concurrency retry exhausted");
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function reconcileConcurrency(): number {
  return boundedInteger(process.env.CELLFLOW_RECONCILE_CONCURRENCY, 4, 1, 8);
}

function reconcileItemLeaseSeconds(): number {
  const rpcTimeoutMs = boundedInteger(process.env.CKB_RPC_TIMEOUT_MS, 10_000, 1_000, 30_000);
  // A committed observation may need identity, transaction, canonicality, header,
  // tip and assertion RPCs. Keep the lease comfortably beyond that upper bound.
  return Math.min(900, Math.max(120, Math.ceil((rpcTimeoutMs * 7) / 1000) + 30));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function reconcileDue(limit = 25): Promise<ReconcileResult[]> {
  const repository = new CellFlowRepository();
  const leaseId = randomUUID();
  const concurrency = reconcileConcurrency();
  const itemLeaseSeconds = reconcileItemLeaseSeconds();
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  // Claimed rows wait in-memory before their worker starts. Cover that queue time,
  // then renew each row immediately before doing RPC work.
  const initialLeaseSeconds = Math.min(
    3600,
    itemLeaseSeconds * Math.max(1, Math.ceil(boundedLimit / concurrency)),
  );
  const due = await repository.claimDueExecutions(boundedLimit, leaseId, initialLeaseSeconds);
  const results: ReconcileResult[] = new Array(due.length);

  await runWithConcurrency(due.map((aggregate, index) => ({ aggregate, index })), concurrency, async ({ aggregate, index }) => {
    try {
      const renewed = await repository.renewReconcileLease(aggregate.execution.id, leaseId, itemLeaseSeconds);
      if (!renewed) {
        results[index] = {
          intentId: aggregate.intent.intentId,
          txHash: aggregate.execution.txHash,
          changed: false,
          status: "LEASE_LOST",
          assertionStatus: aggregate.execution.assertionStatus,
          terminal: false,
          nextDelayMs: null,
          error: "Reconciliation lease was lost before work started",
        };
        return;
      }
      results[index] = await reconcileIntent(aggregate, repository);
    } catch (error) {
      results[index] = {
        intentId: aggregate.intent.intentId,
        txHash: aggregate.execution.txHash,
        changed: false,
        status: "ERROR",
        assertionStatus: aggregate.execution.assertionStatus,
        terminal: false,
        nextDelayMs: null,
        error: error instanceof Error ? error.message : "Reconciliation worker failed",
      };
    } finally {
      await repository.releaseReconcileLease(aggregate.execution.id, leaseId).catch(() => undefined);
    }
  });

  return results.filter((item): item is ReconcileResult => Boolean(item));
}
