import test from "node:test";
import assert from "node:assert/strict";
import {
  applyChainObservation,
  computeConfirmationCount,
  deriveOverallStatus,
  initialSnapshot,
  normalizeTxHash,
  updateSubmission,
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
  });
  assert.equal(reorg.reorgDetected, true);
  assert.equal(reorg.snapshot.workflowStatus, "REORGED");
  assert.equal(deriveOverallStatus(reorg.snapshot), "REORGED");
  assert.equal(reorg.snapshot.committedBlockHash, undefined);
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
