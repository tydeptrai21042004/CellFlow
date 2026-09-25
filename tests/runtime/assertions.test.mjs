import test from "node:test";
import assert from "node:assert/strict";
import {
  assertionHasChecks,
  verifyExpectedCell,
  verifyLiveCell,
} from "../../.tmp/assertions/index.js";

const lock = { code_hash: `0x${"11".repeat(32)}`, hash_type: "type", args: "0x1234" };
const tx = { outputs: [{ capacity: "0x64", lock, type: null }], outputs_data: ["0xabcd"] };

test("empty expected Cell assertion is rejected by verifier", () => {
  const assertion = { outputIndex: 0 };
  assert.equal(assertionHasChecks(assertion), false);
  const result = verifyExpectedCell(tx, assertion);
  assert.equal(result.ok, false);
});

test("capacity uses integer equivalence instead of textual hex equivalence", () => {
  const result = verifyExpectedCell(tx, { outputIndex: 0, capacity: "0x064" });
  assert.equal(result.ok, true);
});

test("created Cell assertion checks lock/type/data", () => {
  const result = verifyExpectedCell(tx, {
    outputIndex: 0,
    lock: { codeHash: lock.code_hash, hashType: "type", args: "0x1234" },
    type: null,
    data: "0xABCD",
  });
  assert.equal(result.ok, true);
});

test("live Cell assertion fails for dead/missing Cell", () => {
  const result = verifyLiveCell({ status: "dead" }, { outputIndex: 0, mode: "live", capacity: "0x64" });
  assert.equal(result.ok, false);
  assert.equal(result.mode, "live");
});

test("live Cell assertion verifies current Cell contents", () => {
  const result = verifyLiveCell({
    status: "live",
    cell: { output: tx.outputs[0], data: { content: "0xabcd" } },
  }, { outputIndex: 0, mode: "live", capacity: "0x64", data: "0xabcd" });
  assert.equal(result.ok, true);
});
