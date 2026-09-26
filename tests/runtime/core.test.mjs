import test from "node:test";
import assert from "node:assert/strict";
import {
  applyChainObservation,
  computeConfirmationCount,
  deriveOverallStatus,
  deriveRecommendedAction,
  initialSnapshot,
  isConfirmationSatisfied,
  normalizeIntentId,
  normalizeTxHash,
  parseHexBlockNumber,
  setWorkflowStatus,
  updateSubmission,
  supersedeNodeRejectionFromChainEvidence,
  breakSpendObservationContinuity,
  conflictObservationMatured,
  nextSpentObservationDetails,
} from "../../.tmp/core/index.js";

test("submission identity is persisted before broadcast", () => {
  const created = initialSnapshot({ mode: "depth", blocks: 4 });
  const prepared = updateSubmission(created, "PREPARED");
  const broadcasting = updateSubmission(prepared, "BROADCASTING");
  const ambiguous = updateSubmission(broadcasting, "SUBMISSION_UNKNOWN");
  assert.equal(deriveOverallStatus(prepared), "PREPARED");
  assert.equal(deriveOverallStatus(broadcasting), "SUBMITTING");
  assert.equal(deriveOverallStatus(ambiguous), "UNKNOWN");
});

test("ambiguous submission may recover to submitted", () => {
  const state = updateSubmission(
    updateSubmission(
      updateSubmission(initialSnapshot(), "PREPARED"),
      "BROADCASTING",
    ),
    "SUBMISSION_UNKNOWN",
  );
  const recovered = updateSubmission(state, "SUBMITTED");
  assert.equal(recovered.submissionStatus, "SUBMITTED");
});

test("confirmation depth derives CONFIRMED only at policy depth", () => {
  let snapshot = updateSubmission(initialSnapshot({ mode: "depth", blocks: 4 }), "SUBMITTED");
  const first = applyChainObservation(snapshot, {
    status: "COMMITTED",
    observedAt: "2026-09-24T00:00:00.000Z",
    raw: {},
    blockHash: "0xabc",
    blockNumber: "0x64",
    tipBlockNumber: "0x65",
  });
  assert.equal(first.snapshot.confirmationCount, 2);
  assert.equal(first.snapshot.workflowStatus, "WAITING_CONFIRMATIONS");
  assert.equal(deriveOverallStatus(first.snapshot), "COMMITTED");

  const final = applyChainObservation(first.snapshot, {
    status: "COMMITTED",
    observedAt: "2026-09-24T00:01:00.000Z",
    raw: {},
    blockHash: "0xabc",
    blockNumber: "0x64",
    tipBlockNumber: "0x67",
  });
  assert.equal(final.snapshot.confirmationCount, 4);
  assert.equal(final.snapshot.workflowStatus, "CONFIRMED");
  assert.equal(deriveOverallStatus(final.snapshot), "CONFIRMED");
});

test("a prior committed block disappearing is explicit REORGED", () => {
  const committed = applyChainObservation(
    updateSubmission(initialSnapshot({ mode: "depth", blocks: 5 }), "SUBMITTED"),
    {
      status: "COMMITTED",
      observedAt: "2026-09-24T00:00:00.000Z",
      raw: {},
      blockHash: "0xold",
      blockNumber: "0x64",
      tipBlockNumber: "0x65",
    },
  ).snapshot;

  const reorg = applyChainObservation(committed, {
    status: "PENDING",
    observedAt: "2026-09-24T00:01:00.000Z",
    raw: {},
    priorCommitCanonical: false,
  });
  assert.equal(reorg.reorgDetected, true);
  assert.equal(reorg.snapshot.workflowStatus, "REORGED");
  assert.equal(deriveOverallStatus(reorg.snapshot), "REORGED");
  assert.equal(reorg.snapshot.committedBlockHash, undefined);
});


test("lagging pending observation does not erase a canonical prior commit", () => {
  const committed = applyChainObservation(
    updateSubmission(initialSnapshot({ mode: "depth", blocks: 5 }), "SUBMITTED"),
    {
      status: "COMMITTED", observedAt: "2026-09-24T00:00:00.000Z", raw: {},
      blockHash: "0xold", blockNumber: "0x64", tipBlockNumber: "0x65",
    },
  ).snapshot;
  const lagging = applyChainObservation(committed, {
    status: "PENDING", observedAt: "2026-09-24T00:00:10.000Z", raw: {},
    priorCommitCanonical: true,
  });
  assert.equal(lagging.reorgDetected, false);
  assert.equal(lagging.snapshot.chainStatus, "COMMITTED");
  assert.equal(lagging.snapshot.committedBlockHash, "0xold");
});


test("unknown after commit is uncertainty, not automatic reorg", () => {
  const committed = applyChainObservation(
    updateSubmission(initialSnapshot({ mode: "depth", blocks: 5 }), "SUBMITTED"),
    {
      status: "COMMITTED", observedAt: "2026-09-24T00:00:00.000Z", raw: {},
      blockHash: "0xold", blockNumber: "0x64", tipBlockNumber: "0x65",
    },
  ).snapshot;
  const unknown = applyChainObservation(committed, {
    status: "UNKNOWN", observedAt: "2026-09-24T00:00:10.000Z", raw: null,
  });
  assert.equal(unknown.reorgDetected, false);
  assert.equal(unknown.snapshot.workflowStatus, "RECONCILING");
  assert.equal(unknown.snapshot.committedBlockHash, "0xold");
});

test("confirmation count uses inclusive committed block depth", () => {
  assert.equal(computeConfirmationCount("0x10", "0x10"), 1);
  assert.equal(computeConfirmationCount("0x10", "0x13"), 4);
  assert.equal(computeConfirmationCount("0x13", "0x10"), 0);
});

test("transaction hash validation is strict", () => {
  const valid = `0x${"ab".repeat(32)}`;
  assert.equal(normalizeTxHash(valid.toUpperCase().replace("0X", "0x")), valid);
  assert.throws(() => normalizeTxHash("0x1234"));
});

test("submission state cannot move backward", () => {
  const submitted = updateSubmission(updateSubmission(initialSnapshot(), "PREPARED"), "SUBMITTED");
  assert.throws(() => updateSubmission(submitted, "PREPARED"), /cannot move backward/i);
});

test("committed policy confirms on first canonical committed observation", () => {
  const snapshot = updateSubmission(initialSnapshot({ mode: "committed" }), "SUBMITTED");
  const result = applyChainObservation(snapshot, {
    status: "COMMITTED", observedAt: "2026-09-25T00:00:00.000Z", raw: {},
    blockHash: "0x01", blockNumber: "0x10", tipBlockNumber: "0x10",
  });
  assert.equal(result.snapshot.workflowStatus, "CONFIRMED");
});

test("same transaction committed in a different block is treated as reorg evidence", () => {
  const first = applyChainObservation(
    updateSubmission(initialSnapshot({ mode: "depth", blocks: 5 }), "SUBMITTED"),
    { status: "COMMITTED", observedAt: "2026-09-25T00:00:00Z", raw: {}, blockHash: "0xaa", blockNumber: "0x10", tipBlockNumber: "0x11" },
  ).snapshot;
  const second = applyChainObservation(first, {
    status: "COMMITTED", observedAt: "2026-09-25T00:01:00Z", raw: {}, blockHash: "0xbb", blockNumber: "0x10", tipBlockNumber: "0x11",
  });
  assert.equal(second.reorgDetected, true);
  assert.equal(second.snapshot.workflowStatus, "WAITING_CONFIRMATIONS");
  assert.equal(second.snapshot.committedBlockHash, "0xbb");
});

test("rejected transaction becomes terminal chain rejection", () => {
  const snapshot = updateSubmission(initialSnapshot(), "SUBMITTED");
  const result = applyChainObservation(snapshot, {
    status: "REJECTED", observedAt: "2026-09-25T00:00:00Z", raw: {}, rejectionReason: "invalid",
  });
  assert.equal(result.snapshot.chainStatus, "REJECTED");
  assert.equal(deriveOverallStatus(result.snapshot), "REJECTED");
  assert.equal(result.snapshot.rejectionReason, "invalid");
});


test("hex block parsing rejects malformed values", () => {
  assert.equal(parseHexBlockNumber("0x10"), 16n);
  assert.equal(parseHexBlockNumber("10"), undefined);
  assert.equal(parseHexBlockNumber("0xzz"), undefined);
  assert.equal(parseHexBlockNumber(undefined), undefined);
});

test("confirmation policy requires committed chain state and configured depth", () => {
  assert.equal(isConfirmationSatisfied({ mode: "depth", blocks: 4 }, "COMMITTED", 3), false);
  assert.equal(isConfirmationSatisfied({ mode: "depth", blocks: 4 }, "COMMITTED", 4), true);
  assert.equal(isConfirmationSatisfied({ mode: "committed" }, "PROPOSED", 20), false);
});

test("intent identifiers are normalized and constrained", () => {
  assert.equal(normalizeIntentId("  skillpass:transfer-1042  "), "skillpass:transfer-1042");
  assert.throws(() => normalizeIntentId("bad intent with spaces"));
  assert.throws(() => normalizeIntentId(""));
  assert.throws(() => normalizeIntentId("a".repeat(129)));
});

test("proposed observation remains reconciling and derives PROPOSED", () => {
  const snapshot = updateSubmission(initialSnapshot(), "SUBMITTED");
  const result = applyChainObservation(snapshot, {
    status: "PROPOSED", observedAt: "2026-09-25T00:00:00Z", raw: {},
  });
  assert.equal(result.snapshot.chainStatus, "PROPOSED");
  assert.equal(result.snapshot.workflowStatus, "RECONCILING");
  assert.equal(deriveOverallStatus(result.snapshot), "PROPOSED");
});

test("unknown observation before any commit remains recoverable", () => {
  const snapshot = updateSubmission(initialSnapshot(), "SUBMITTED");
  const result = applyChainObservation(snapshot, {
    status: "UNKNOWN", observedAt: "2026-09-25T00:00:00Z", raw: null,
  });
  assert.equal(result.snapshot.workflowStatus, "RECONCILING");
  assert.equal(deriveOverallStatus(result.snapshot), "RECONCILING");
});

test("manual CONFIRMED workflow state requires a committed transaction", () => {
  assert.throws(() => setWorkflowStatus(initialSnapshot(), "CONFIRMED"), /requires COMMITTED/i);
  const committed = applyChainObservation(
    updateSubmission(initialSnapshot({ mode: "depth", blocks: 5 }), "SUBMITTED"),
    { status: "COMMITTED", observedAt: "2026-09-25T00:00:00Z", raw: {}, blockHash: "0xaa", blockNumber: "0x10", tipBlockNumber: "0x10" },
  ).snapshot;
  assert.equal(setWorkflowStatus(committed, "CONFIRMED").workflowStatus, "CONFIRMED");
});

test("submission cannot change after authoritative rejection", () => {
  const rejected = applyChainObservation(
    updateSubmission(initialSnapshot(), "SUBMITTED"),
    { status: "REJECTED", observedAt: "2026-09-25T00:00:00Z", raw: {}, rejectionReason: "bad tx" },
  ).snapshot;
  assert.throws(() => updateSubmission(rejected, "SUBMITTED"), /authoritative rejection/i);
});

test("CONFLICTED and EXPIRED dominate overall state", () => {
  assert.equal(deriveOverallStatus({ ...initialSnapshot(), workflowStatus: "CONFLICTED", chainStatus: "REJECTED" }), "CONFLICTED");
  assert.equal(deriveOverallStatus({ ...initialSnapshot(), workflowStatus: "EXPIRED", chainStatus: "COMMITTED" }), "EXPIRED");
});

test("committed observation without block depth does not falsely satisfy depth policy", () => {
  const result = applyChainObservation(
    updateSubmission(initialSnapshot({ mode: "depth", blocks: 2 }), "SUBMITTED"),
    { status: "COMMITTED", observedAt: "2026-09-25T00:00:00Z", raw: {}, blockHash: "0xaa" },
  );
  assert.equal(result.snapshot.confirmationCount, 0);
  assert.equal(result.snapshot.workflowStatus, "WAITING_CONFIRMATIONS");
});

test("confirmation count saturates safely for huge block distance", () => {
  assert.equal(computeConfirmationCount("0x0", "0xffffffffffffffffffffffffffffffff"), Number.MAX_SAFE_INTEGER);
});


test("explicit node rejection is a distinct terminal submission-layer state", () => {
  const prepared = updateSubmission(initialSnapshot(), "PREPARED");
  const broadcasting = updateSubmission(prepared, "BROADCASTING");
  const rejected = updateSubmission(broadcasting, "NODE_REJECTED");
  assert.equal(rejected.submissionStatus, "NODE_REJECTED");
  assert.equal(rejected.chainStatus, "UNOBSERVED");
  assert.equal(deriveOverallStatus(rejected), "NODE_REJECTED");
  assert.throws(() => updateSubmission(rejected, "SUBMITTED"), /node rejection/i);
});


test("chain evidence outranks a later submission-layer rejection", () => {
  let snapshot = updateSubmission(initialSnapshot(), "PREPARED");
  snapshot = updateSubmission(snapshot, "BROADCASTING");
  snapshot = updateSubmission(snapshot, "NODE_REJECTED");
  const observed = applyChainObservation(snapshot, {
    status: "PENDING", observedAt: "2026-09-26T00:00:00Z", raw: {},
  });
  assert.equal(observed.snapshot.submissionStatus, "NODE_REJECTED");
  assert.equal(observed.snapshot.chainStatus, "PENDING");
  assert.equal(deriveOverallStatus(observed.snapshot), "PENDING");
});


test("contradictory rejected RPC observation cannot erase a canonical prior commit", () => {
  const committed = applyChainObservation(
    updateSubmission(initialSnapshot({ mode: "depth", blocks: 5 }), "SUBMITTED"),
    {
      status: "COMMITTED", observedAt: "2026-09-26T00:00:00Z", raw: {},
      blockHash: "0xcanonical", blockNumber: "0x64", tipBlockNumber: "0x65",
    },
  ).snapshot;
  const contradictory = applyChainObservation(committed, {
    status: "REJECTED", observedAt: "2026-09-26T00:01:00Z", raw: {},
    rejectionReason: "lagging node", priorCommitCanonical: true,
  });
  assert.equal(contradictory.reorgDetected, false);
  assert.equal(contradictory.snapshot.chainStatus, "COMMITTED");
  assert.equal(contradictory.snapshot.committedBlockHash, "0xcanonical");
  assert.match(contradictory.event.reason ?? "", /Contradictory RPC rejection/i);
});

test("only direct positive chain evidence supersedes NODE_REJECTED", () => {
  const prepared = updateSubmission(initialSnapshot(), "PREPARED");
  const rejected = updateSubmission(prepared, "NODE_REJECTED");
  assert.equal(supersedeNodeRejectionFromChainEvidence(rejected, "UNKNOWN").submissionStatus, "NODE_REJECTED");
  assert.equal(supersedeNodeRejectionFromChainEvidence(rejected, "REJECTED").submissionStatus, "NODE_REJECTED");
  assert.equal(supersedeNodeRejectionFromChainEvidence(rejected, "PENDING").submissionStatus, "SUBMITTED");
  assert.equal(supersedeNodeRejectionFromChainEvidence(rejected, "COMMITTED").submissionStatus, "SUBMITTED");
});

test("recommended actions are machine-readable and conservative", () => {
  const unknown = updateSubmission(
    updateSubmission(updateSubmission(initialSnapshot(), "PREPARED"), "BROADCASTING"),
    "SUBMISSION_UNKNOWN",
  );
  assert.equal(deriveRecommendedAction(unknown), "WAIT_FOR_RECONCILIATION");
  assert.equal(deriveRecommendedAction(unknown, "INPUT_CONFLICT_SUSPECTED"), "WAIT_AND_RECONCILE");
  assert.equal(
    deriveRecommendedAction({ ...unknown, workflowStatus: "CONFLICTED" }, "INPUT_SPENT"),
    "REBUILD_FROM_LIVE_STATE",
  );
  assert.equal(
    deriveRecommendedAction({ ...unknown, workflowStatus: "REORGED" }),
    "RECONCILE_CANONICAL_STATE",
  );
  assert.equal(
    deriveRecommendedAction({ ...unknown, workflowStatus: "CONFLICTED" }, "EXPECTED_CELL_ASSERTION_FAILED", "FAILED"),
    "MANUAL_REVIEW",
  );
});


test("canonical spend maturity requires uninterrupted repeated evidence", () => {
  const firstInspection = {
    observedAt: "2026-09-26T00:00:00Z",
    tipBlockNumber: "0x64",
    inputs: [{ outPoint: { txHash: `0x${"11".repeat(32)}`, index: 0 }, canonical: "SPENT" }],
  };
  const first = nextSpentObservationDetails(null, firstInspection);
  const execution = { confirmationPolicy: { mode: "depth", blocks: 4 }, conflictDetails: first };
  assert.equal(conflictObservationMatured(execution, { ...firstInspection, observedAt: "2026-09-26T00:01:00Z", tipBlockNumber: "0x68" }), true);

  const broken = breakSpendObservationContinuity(first, "2026-09-26T00:00:30Z", "RPC unavailable");
  assert.equal(conflictObservationMatured(
    { confirmationPolicy: { mode: "depth", blocks: 4 }, conflictDetails: broken },
    { ...firstInspection, observedAt: "2026-09-26T00:01:00Z", tipBlockNumber: "0x68" },
  ), false);

  const restarted = nextSpentObservationDetails(broken, {
    ...firstInspection,
    observedAt: "2026-09-26T00:01:00Z",
    tipBlockNumber: "0x68",
  });
  assert.equal(restarted.firstObservedTipBlockNumber, "0x68");
  assert.equal(restarted.spentObservationCount, 1);
  assert.equal(restarted.continuityBroken, false);
});
