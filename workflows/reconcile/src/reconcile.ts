import { randomUUID } from "node:crypto";
import { postSettlementMonitorMs, shouldContinueSettlementMonitoring, shouldReverifyExpectedCells } from "./monitoring.ts";
import {
  applyChainObservation,
  deriveOverallStatus,
  initialSnapshot,
  setWorkflowStatus,
  supersedeNodeRejectionFromChainEvidence,
  isSettlementReady,
  breakSpendObservationContinuity,
  conflictObservationMatured,
  nextSpentObservationDetails,
  signedPayloadFingerprintSha256,
  type ConflictDomain,
  type ConflictType,
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
import { CkbRpcClient, observeTransaction, parseRpcUrls, type InputInspection } from "./rpc.ts";

export function nextReconcileDelayMs(attempt: number, chainStatus: string): number {
  if (["PENDING", "PROPOSED", "COMMITTED"].includes(chainStatus)) return 12_000;
  if (chainStatus === "UNKNOWN" || chainStatus === "UNOBSERVED") {
    return Math.min(5 * 60_000, 10_000 * 2 ** Math.min(attempt, 5));
  }
  return 20_000;
}


function contentionGraceMs(): number {
  const parsed = Number(process.env.CELLFLOW_CONTENTION_GRACE_MS ?? "30000");
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.min(Math.max(Math.floor(parsed), 1_000), 10 * 60_000);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function contentionDetails(
  priorValue: unknown,
  inspection: InputInspection,
): Record<string, unknown> {
  const prior = asRecord(priorValue);
  const sameContention = prior.classification === "MEMPOOL_CONTENDED";
  const firstObservedAt = sameContention && typeof prior.firstObservedAt === "string"
    ? prior.firstObservedAt
    : inspection.observedAt;
  const graceMs = sameContention && typeof prior.graceMs === "number"
    ? prior.graceMs
    : contentionGraceMs();
  const firstMs = Date.parse(firstObservedAt);
  const fallbackFirstMs = Date.parse(inspection.observedAt);
  const baseMs = Number.isFinite(firstMs) ? firstMs : fallbackFirstMs;
  const graceExpiresAt = new Date(baseMs + graceMs).toISOString();
  const observedMs = Date.parse(inspection.observedAt);
  const graceExpired = Number.isFinite(observedMs) && observedMs >= baseMs + graceMs;
  return {
    source: "reconciliation",
    classification: "MEMPOOL_CONTENDED",
    canonicalSpendConfirmed: false,
    firstObservedAt,
    lastObservedAt: inspection.observedAt,
    observedAt: inspection.observedAt,
    graceMs,
    graceExpiresAt,
    graceExpired,
    tipBlockNumber: inspection.tipBlockNumber,
    inputDomain: inputConflictDomain(inspection, "contended"),
    contendedInputs: inspection.contendedInputs,
    inputs: inspection.inputs,
  };
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
  settlementReady: boolean;
  terminal: boolean;
  nextDelayMs: number | null;
  error?: string;
}

function inputConflictDomain(inspection: InputInspection, mode: "spent" | "contended"): ConflictDomain {
  const observations = mode === "spent" ? inspection.spentInputs : inspection.contendedInputs;
  let application = false;
  let wallet = false;
  let unknown = false;
  for (const observation of observations) {
    if (observation.input.role === "APPLICATION_STATE") application = true;
    else if (observation.input.role === "WALLET_FUNDING" || observation.input.role === "FEE") wallet = true;
    else unknown = true;
  }
  if (application && wallet) return "MIXED";
  if (application && !unknown) return "APPLICATION";
  if (wallet && !unknown) return "WALLET";
  return "UNKNOWN";
}

function isTerminal(snapshot: ExecutionSnapshot, assertionStatus: string | null, expectedCount: number): boolean {
  if (snapshot.workflowStatus === "CONFLICTED" || snapshot.workflowStatus === "EXPIRED" || snapshot.chainStatus === "REJECTED") {
    return true;
  }
  if (snapshot.workflowStatus !== "CONFIRMED") return false;
  return expectedCount === 0 || assertionStatus === "VERIFIED";
}

async function corroborateCanonicalSpend(input: {
  client: CkbRpcClient;
  primary: InputInspection;
  configuredEndpoints: string[];
  inputOutPoints: IntentAggregate["execution"]["inputRefs"];
  identity: { chain: string | null; genesisHash: string | null };
}): Promise<{
  confirmed: boolean;
  requiredEndpoints: number;
  observations: Array<{ endpoint: string; state: string; observedAt?: string; error?: string }>;
}> {
  const unique = [...new Set(input.configuredEndpoints)];
  const requiredEndpoints = unique.length >= 2 ? 2 : 1;
  const observations: Array<{ endpoint: string; state: string; observedAt?: string; error?: string }> = [{
    endpoint: input.primary.endpoint,
    state: input.primary.state,
    observedAt: input.primary.observedAt,
  }];
  if (requiredEndpoints === 1) {
    return { confirmed: input.primary.state === "CANONICALLY_SPENT", requiredEndpoints, observations };
  }

  for (const endpoint of unique) {
    if (endpoint === input.primary.endpoint) continue;
    try {
      const secondary = await input.client.inspectInputOutPointsAt(
        endpoint,
        input.inputOutPoints,
        input.identity,
      );
      observations.push({ endpoint, state: secondary.state, observedAt: secondary.observedAt });
      if (secondary.state === "CANONICALLY_SPENT") {
        return { confirmed: true, requiredEndpoints, observations };
      }
    } catch (error) {
      observations.push({
        endpoint,
        state: "RPC_UNAVAILABLE",
        error: error instanceof Error ? error.message : "Corroboration failed",
      });
    }
  }
  return { confirmed: false, requiredEndpoints, observations };
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
        if (live?.block_hash) {
          const canonical = await input.client.verifyCanonicalBlockAt(input.endpoint, live.block_hash);
          liveResult.evidence = {
            ...(liveResult.evidence ?? {}),
            liveBlockHash: live.block_hash,
            liveBlockNumber: canonical.blockNumber,
            canonicalBlockHash: canonical.canonicalBlockHash,
            canonicalAtObservation: canonical.canonical,
            rpcEndpoint: input.endpoint,
          };
          liveResult.checks.push({
            field: "live.blockHashCanonical",
            expected: true,
            actual: canonical.canonical,
            ok: canonical.canonical === true,
          });
          liveResult.ok = liveResult.ok && canonical.canonical === true;
          if (canonical.canonical === false) {
            return { status: "FAILED", results, reason: "Expected live Cell was reported from a block that is no longer canonical" };
          }
          if (canonical.canonical === null) {
            return { status: "PENDING", results, reason: "Live Cell block canonicality could not yet be verified" };
          }
        }
      } catch {
        return { status: "PENDING", results: null };
      }
    }
  }
  return { status: "VERIFIED", results };
}

async function promoteCommittedCompetingCandidate(
  aggregate: IntentAggregate,
  repository: CellFlowRepository,
  client: CkbRpcClient,
  identity: { chain: string | null; genesisHash: string | null },
): Promise<IntentAggregate | null> {
  const candidates = aggregate.attempts.filter((attempt) =>
    attempt.disposition === "ACTIVE" && attempt.id !== aggregate.intent.activeAttemptId
  );
  for (const candidate of candidates) {
    const candidateInputs = candidate.inputRefs.length > 0 ? candidate.inputRefs : candidate.inputOutPoints;
    const startedAt = Date.now();
    try {
      const observed = await client.observe(candidate.txHash, undefined, identity, candidateInputs);
      await repository.recordRpcObservation({
        aggregate,
        attemptId: candidate.id,
        txHash: candidate.txHash,
        rpcEndpoint: observed.endpoint,
        observedStatus: observed.observation.status,
        ...(observed.observation.blockHash ? { blockHash: observed.observation.blockHash } : {}),
        ...(observed.observation.blockNumber ? { blockNumber: observed.observation.blockNumber } : {}),
        ...(observed.observation.tipBlockNumber ? { tipBlockNumber: observed.observation.tipBlockNumber } : {}),
        ...(observed.observation.canonicalBlockHash ? { canonicalBlockHash: observed.observation.canonicalBlockHash } : {}),
        ...(observed.inputInspection ? { inputState: observed.inputInspection.state } : {}),
        latencyMs: Date.now() - startedAt,
        rawObservation: observed.observation.raw,
        observedAt: observed.observation.observedAt,
      });
      const base = initialSnapshot(aggregate.execution.confirmationPolicy);
      const candidateBase: ExecutionSnapshot = {
        ...base,
        submissionStatus: candidate.submissionStatus === "NOT_SUBMITTED" ? "SUBMITTED" : candidate.submissionStatus,
        chainStatus: candidate.chainStatus,
        workflowStatus: candidate.workflowStatus,
      };

      if (observed.observation.status !== "COMMITTED") {
        const sideApplied = applyChainObservation(candidateBase, observed.observation);
        await repository.updateCandidateAttempt({
          aggregate,
          attemptId: candidate.id,
          snapshot: sideApplied.snapshot,
        });
        continue;
      }

      if (candidate.signedPayloadHashSha256 && observed.rpcResult?.transaction) {
        const observedFingerprint = await signedPayloadFingerprintSha256(observed.rpcResult.transaction);
        if (observedFingerprint && observedFingerprint !== candidate.signedPayloadHashSha256) {
          // Same raw CKB hash with an unexpected witness payload is not enough
          // evidence to promote a competing attempt into the business projection.
          await repository.updateCandidateAttempt({
            aggregate,
            attemptId: candidate.id,
            snapshot: setWorkflowStatus(candidateBase, "CONFLICTED"),
            conflictType: "SIGNED_PAYLOAD_MISMATCH",
            conflictDetails: {
              source: "competing_attempt_scan",
              expectedSignedPayloadHashSha256: candidate.signedPayloadHashSha256,
              observedSignedPayloadHashSha256: observedFingerprint,
              rpcEndpoint: observed.endpoint,
              observedAt: observed.observation.observedAt,
            },
          });
          continue;
        }
      }

      const applied = applyChainObservation(candidateBase, observed.observation);
      return repository.promoteAttemptProjection({
        aggregate,
        attemptId: candidate.id,
        snapshot: applied.snapshot,
        eventKind: applied.snapshot.workflowStatus === "CONFIRMED"
          ? "COMPETING_ATTEMPT_CONFIRMED"
          : "COMPETING_ATTEMPT_COMMITTED",
        reason: "A previously unresolved transaction candidate committed on the canonical chain and now drives the intent projection",
        rawObservation: observed.observation.raw,
        occurredAt: observed.observation.observedAt,
        nextReconcileAt: new Date(Date.now() + 12_000),
      });
    } catch (error) {
      const observedAt = new Date().toISOString();
      await repository.recordRpcObservation({
        aggregate,
        attemptId: candidate.id,
        txHash: candidate.txHash,
        observedStatus: "RPC_FAILURE",
        latencyMs: Date.now() - startedAt,
        rawObservation: {
          source: "competing_attempt_scan",
          error: error instanceof Error ? error.message : "RPC observation failed",
        },
        observedAt,
      }).catch(() => undefined);
      // A failed side-candidate probe is absence of evidence. The current
      // projection must still reconcile normally.
    }
  }
  return null;
}

async function reconcileIntentOnce(
  aggregate: IntentAggregate,
  repository: CellFlowRepository,
  scanCompetingCandidates = true,
): Promise<ReconcileResult> {
  const txHash = aggregate.execution.txHash;
  if (!txHash) {
    return {
      intentId: aggregate.intent.intentId,
      txHash: null,
      changed: false,
      status: deriveOverallStatus(snapshotFromExecution(aggregate.execution)),
      assertionStatus: aggregate.execution.assertionStatus,
      settlementReady: false,
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
  const identity = {
    chain: expectedChain(project.network),
    genesisHash: project.rpcGenesisHash ?? process.env.CKB_EXPECTED_GENESIS_HASH ?? null,
  };
  if (scanCompetingCandidates && aggregate.attempts.some((attempt) =>
    attempt.disposition === "ACTIVE" && attempt.id !== aggregate.intent.activeAttemptId
  )) {
    const promoted = await promoteCommittedCompetingCandidate(aggregate, repository, client, identity);
    if (promoted) return reconcileIntentOnce(promoted, repository, false);
  }
  const prior = snapshotFromExecution(aggregate.execution);
  const reconciliationInputs = aggregate.execution.inputRefs.length > 0
    ? aggregate.execution.inputRefs
    : aggregate.execution.inputOutPoints.map((outPoint) => ({ outPoint, role: "OTHER" as const }));

  let observed;
  const observationStartedAt = Date.now();
  try {
    observed = await observeTransaction(
      client,
      txHash,
      prior.committedBlockHash && prior.committedBlockNumber
        ? { blockHash: prior.committedBlockHash, blockNumber: prior.committedBlockNumber }
        : undefined,
      identity,
      reconciliationInputs,
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
    await repository.recordRpcObservation({
      aggregate,
      attemptId: aggregate.intent.activeAttemptId,
      txHash,
      observedStatus: "RPC_FAILURE",
      rawObservation: failureObservation.raw,
      observedAt,
    }).catch(() => undefined);
    const applied = applyChainObservation(prior, failureObservation);
    const nextDelayMs = nextReconcileDelayMs(aggregate.execution.reconcileAttempts, "UNKNOWN");
    const brokenConflictDetails = breakSpendObservationContinuity(
      aggregate.execution.conflictDetails,
      observedAt,
      "RPC observation failed before canonical spend evidence could be rechecked",
    );
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
      ...(brokenConflictDetails !== aggregate.execution.conflictDetails
        ? { conflictDetails: brokenConflictDetails }
        : {}),
    });
    return {
      intentId: aggregate.intent.intentId,
      txHash,
      changed: Boolean(eventId),
      status: deriveOverallStatus(applied.snapshot),
      assertionStatus: aggregate.execution.assertionStatus,
      settlementReady: false,
      terminal: false,
      nextDelayMs,
    };
  }

  const { observation, rpcResult, endpoint, inputInspection } = observed;
  await repository.recordRpcObservation({
    aggregate,
    attemptId: aggregate.intent.activeAttemptId,
    txHash,
    rpcEndpoint: endpoint,
    observedStatus: observation.status,
    ...(observation.blockHash ? { blockHash: observation.blockHash } : {}),
    ...(observation.blockNumber ? { blockNumber: observation.blockNumber } : {}),
    ...(observation.tipBlockNumber ? { tipBlockNumber: observation.tipBlockNumber } : {}),
    ...(observation.canonicalBlockHash ? { canonicalBlockHash: observation.canonicalBlockHash } : {}),
    ...(inputInspection ? { inputState: inputInspection.state } : {}),
    latencyMs: Date.now() - observationStartedAt,
    rawObservation: observation.raw,
    observedAt: observation.observedAt,
  });
  const applied = applyChainObservation(prior, observation);
  let nextSnapshot: ExecutionSnapshot = applied.snapshot;
  const rejectionSuperseded =
    aggregate.execution.submissionStatus === "NODE_REJECTED" &&
    ["PENDING", "PROPOSED", "COMMITTED"].includes(observation.status);
  if (rejectionSuperseded) {
    nextSnapshot = supersedeNodeRejectionFromChainEvidence(nextSnapshot, observation.status);
  }
  let assertionStatus = aggregate.execution.assertionStatus;
  let assertionResult: unknown = aggregate.execution.assertionResult;
  let eventKind: string = applied.event.kind;
  let reason = applied.event.reason;
  let conflictType: ConflictType | null = aggregate.execution.conflictType;
  let conflictDetails: unknown = aggregate.execution.conflictDetails;

  let signedPayloadMismatch = false;
  const expectedSignedPayloadHash = aggregate.activeAttempt?.signedPayloadHashSha256 ?? null;
  if (expectedSignedPayloadHash && rpcResult?.transaction &&
      ["PENDING", "PROPOSED", "COMMITTED"].includes(observation.status)) {
    const observedSignedPayloadHash = await signedPayloadFingerprintSha256(rpcResult.transaction);
    if (observedSignedPayloadHash && observedSignedPayloadHash !== expectedSignedPayloadHash) {
      signedPayloadMismatch = true;
      nextSnapshot = setWorkflowStatus(nextSnapshot, "CONFLICTED");
      conflictType = "SIGNED_PAYLOAD_MISMATCH";
      conflictDetails = {
        source: "reconciliation",
        classification: "SIGNED_PAYLOAD_MISMATCH",
        txHash,
        expectedSignedPayloadHashSha256: expectedSignedPayloadHash,
        observedSignedPayloadHashSha256: observedSignedPayloadHash,
        rpcEndpoint: endpoint,
        observedAt: observation.observedAt,
      };
      eventKind = "SIGNED_PAYLOAD_MISMATCH";
      reason = "CKB RPC returned the expected raw transaction hash but a different complete signed-payload fingerprint";
    }
  }

  if (!signedPayloadMismatch && ["PENDING", "PROPOSED", "COMMITTED"].includes(observation.status)) {
    // Finding the exact transaction is stronger evidence than an earlier
    // submission-layer conflict suspicion. Keep history in events, not in the
    // current conflict field.
    conflictType = null;
    conflictDetails = null;
    if (rejectionSuperseded) {
      eventKind = "SUBMISSION_REJECTION_SUPERSEDED";
      reason = "A later direct chain observation proved that the exact transaction exists; earlier node rejection evidence was superseded";
    }
  } else if (observation.status === "UNKNOWN" && inputInspection) {
    if (inputInspection.state === "MEMPOOL_CONTENDED") {
      conflictType = "INPUT_CONFLICT_SUSPECTED";
      const priorContention = asRecord(aggregate.execution.conflictDetails);
      conflictDetails = contentionDetails(aggregate.execution.conflictDetails, inputInspection);
      const details = asRecord(conflictDetails);
      const graceJustExpired = details.graceExpired === true && priorContention.graceExpired !== true;
      eventKind = graceJustExpired
        ? "INPUT_CONTENTION_GRACE_EXPIRED"
        : "INPUT_POOL_CONTENTION_DETECTED";
      reason = graceJustExpired
        ? "The configured input-contention grace window expired; recovery is now selected from the semantic input role while reconciliation continues"
        : "Exact transaction is absent while an original input is live canonically but unavailable with tx-pool state";
    } else if (inputInspection.state === "CANONICALLY_SPENT") {
      const priorDetails = aggregate.execution.conflictDetails;
      if (conflictObservationMatured(aggregate.execution, inputInspection)) {
        const corroboration = await corroborateCanonicalSpend({
          client,
          primary: inputInspection,
          configuredEndpoints: urls,
          inputOutPoints: reconciliationInputs,
          identity: {
            chain: expectedChain(project.network),
            genesisHash: project.rpcGenesisHash ?? process.env.CKB_EXPECTED_GENESIS_HASH ?? null,
          },
        });
        if (corroboration.confirmed) {
          conflictType = "INPUT_SPENT";
          conflictDetails = {
            ...nextSpentObservationDetails(priorDetails, inputInspection),
            source: "reconciliation",
            classification: "INPUT_SPENT",
            canonicalSpendConfirmed: true,
            confirmedAt: inputInspection.observedAt,
            confirmedTipBlockNumber: inputInspection.tipBlockNumber,
            confirmationPolicy: aggregate.execution.confirmationPolicy,
            inputDomain: inputConflictDomain(inputInspection, "spent"),
            spentInputs: inputInspection.spentInputs,
            corroboration,
            inputs: inputInspection.inputs,
          };
          nextSnapshot = setWorkflowStatus(nextSnapshot, "CONFLICTED");
          eventKind = "INPUT_CONFLICT_CONFIRMED";
          reason = corroboration.requiredEndpoints > 1
            ? "Original input remained canonically spent through the recheck window and a second configured RPC corroborated the terminal conflict"
            : "Original input remained canonically spent through the recheck window; only one trusted RPC endpoint is configured";
        } else {
          conflictType = "INPUT_CONFLICT_SUSPECTED";
          conflictDetails = {
            ...nextSpentObservationDetails(priorDetails, inputInspection),
            inputDomain: inputConflictDomain(inputInspection, "spent"),
            spentInputs: inputInspection.spentInputs,
            corroboration,
          };
          eventKind = "INPUT_CONFLICT_CORROBORATION_PENDING";
          reason = "Primary RPC indicates canonical spend, but a second configured RPC has not corroborated the terminal conflict";
        }
      } else {
        conflictType = "INPUT_CONFLICT_SUSPECTED";
        conflictDetails = {
          ...nextSpentObservationDetails(priorDetails, inputInspection),
          inputDomain: inputConflictDomain(inputInspection, "spent"),
          spentInputs: inputInspection.spentInputs,
        };
        eventKind = "INPUT_SPENT_OBSERVED";
        reason = "Original input is no longer live while its creator transaction remains canonical; waiting for repeated canonical spend evidence before confirming conflict";
      }
    } else if (inputInspection.state === "ALL_LIVE") {
      // Direct input evidence disproves a current canonical/pool conflict. An
      // explicit NODE_REJECTED submission still remains rejected, but it no
      // longer needs conflict reconciliation.
      conflictType = null;
      conflictDetails = null;
      eventKind = "INPUT_STATE_INSPECTED";
      reason = "Exact transaction is absent and all original inputs remain live and available";
    } else {
      const broken = breakSpendObservationContinuity(
        conflictDetails,
        inputInspection.observedAt,
        "Original input state became uncertain",
      );
      if (broken !== conflictDetails) {
        conflictType = "INPUT_CONFLICT_SUSPECTED";
        conflictDetails = broken;
      }
      eventKind = "INPUT_STATE_UNCERTAIN";
      reason = "Exact transaction is absent but the original input state could not be proven; spend-evidence continuity is paused";
    }
  }

  const assertions = aggregate.intent.expectedCells as ExpectedCellAssertion[];
  // Never re-use assertions from an earlier committed block after a reorg.
  if (applied.reorgDetected || nextSnapshot.workflowStatus === "REORGED") {
    assertionStatus = null;
    assertionResult = null;
  }
  // Current live-Cell state is a point-in-time assertion. Once verified,
  // authorized later spending does not undo that historical settlement. During
  // the finite monitoring horizon, observe the committed block/canonicality;
  // only recheck Cell assertions if the canonical block changed.
  const reverifyAssertions = shouldReverifyExpectedCells({
    previouslySettled: aggregate.execution.settlementReadyAt !== null,
    previouslyVerified: aggregate.execution.assertionStatus === "VERIFIED",
    priorCommittedBlockHash: aggregate.execution.committedBlockHash,
    currentCommittedBlockHash: nextSnapshot.committedBlockHash ?? null,
    reorgDetected: applied.reorgDetected,
  });
  if (nextSnapshot.workflowStatus === "CONFIRMED" && assertions.length > 0 && reverifyAssertions) {
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
      conflictType = "EXPECTED_CELL_ASSERTION_FAILED";
      conflictDetails = {
        source: "assertion",
        classification: "EXPECTED_CELL_ASSERTION_FAILED",
        evaluatedAt: observation.observedAt,
        results: evaluated.results,
      };
      eventKind = "ASSERTION_FAILED";
      reason = evaluated.reason;
    }
  }

  const unresolvedCompetingCandidate =
    nextSnapshot.workflowStatus !== "CONFIRMED" &&
    aggregate.attempts.some((attempt) =>
      attempt.disposition === "ACTIVE" && attempt.id !== aggregate.intent.activeAttemptId
    );
  const settlementReady = isSettlementReady(
    nextSnapshot, assertionStatus ?? null, assertions.length, conflictType,
  );
  const firstReadyAt = settlementReady
    ? (aggregate.execution.settlementReadyAt ?? observation.observedAt)
    : null;
  const monitoring = shouldContinueSettlementMonitoring(
    settlementReady, firstReadyAt, Date.now(),
  );
  const terminal =
    isTerminal(nextSnapshot, assertionStatus ?? null, assertions.length) &&
    !unresolvedCompetingCandidate && !monitoring;
  const nodeRejectionConflictResolved =
    !unresolvedCompetingCandidate &&
    observation.status === "UNKNOWN" &&
    aggregate.execution.submissionStatus === "NODE_REJECTED" &&
    conflictType === null;
  const nextDelayMs = terminal || nodeRejectionConflictResolved
    ? null
    : monitoring
      ? Math.min(60_000, Math.max(12_000, postSettlementMonitorMs() / 20))
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
    conflictType,
    conflictDetails,
  });

  return {
    intentId: aggregate.intent.intentId,
    txHash,
    changed: Boolean(eventId),
    status: deriveOverallStatus(nextSnapshot),
    assertionStatus: assertionStatus ?? null,
    settlementReady,
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
          settlementReady: false,
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
        settlementReady: false,
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
