import test from "node:test";
import assert from "node:assert/strict";
import { classifyBroadcastError } from "../../.tmp/ccc-classifier/broadcast-errors.js";

test("transport timeout stays SUBMISSION_UNKNOWN evidence", () => {
  const error = Object.assign(new Error("fetch failed: connection timed out"), { code: "ETIMEDOUT" });
  const result = classifyBroadcastError(error);
  assert.equal(result.outcome, "AMBIGUOUS");
  assert.equal(result.evidence.errorType, "TRANSPORT_UNKNOWN");
  assert.equal(result.evidence.conflictType, undefined);
});

test("structured JSON-RPC rejection becomes NODE_REJECTED", () => {
  const error = Object.assign(new Error("Transaction rejected by tx-pool verification"), { code: -32602 });
  const result = classifyBroadcastError(error);
  assert.equal(result.outcome, "NODE_REJECTED");
  assert.equal(result.evidence.errorType, "RPC_REJECTION");
});

test("RBF/input race wording is only a conflict suspicion", () => {
  const error = Object.assign(new Error("PoolRejectedRBF: fee too low to replace transaction with unconfirmed input"), { code: -1107 });
  const result = classifyBroadcastError(error);
  assert.equal(result.outcome, "NODE_REJECTED");
  assert.equal(result.evidence.conflictType, "INPUT_CONFLICT_SUSPECTED");
  assert.equal(result.evidence.details?.canonicalSpendConfirmed, false);
});

test("unknown outpoint is rejection evidence but not canonical-spend proof", () => {
  const result = classifyBroadcastError(new Error("Resolve failed: unknown outpoint"));
  assert.equal(result.outcome, "NODE_REJECTED");
  assert.equal(result.evidence.conflictType, "INPUT_CONFLICT_SUSPECTED");
  assert.equal(result.evidence.details?.canonicalSpendConfirmed, false);
});

test("HTTP 503-style numeric code remains transport ambiguity", () => {
  const error = Object.assign(new Error("503 gateway unavailable"), { code: 503 });
  const result = classifyBroadcastError(error);
  assert.equal(result.outcome, "AMBIGUOUS");
  assert.equal(result.evidence.errorType, "TRANSPORT_UNKNOWN");
});
