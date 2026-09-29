import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const text = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("submit-time conflict rejection starts reconciliation immediately", async () => {
  const route = await text("apps/web/app/api/v1/intents/[intentId]/rejected/route.ts");
  assert.match(route, /startReconciliationWorkflow/);
  assert.match(route, /INPUT_CONFLICT_SUSPECTED/);
  assert.match(route, /workflowRunId/);
});

test("CCC accepts explicit semantic inputRefs and validates them against the signed transaction", async () => {
  const ccc = await text("packages/ccc/src/ccc.ts");
  assert.match(ccc, /inputRefs\?: InputRef\[\]/);
  assert.match(ccc, /Explicit inputRef .* does not exist in the final signed transaction/);
  assert.match(ccc, /Duplicate explicit inputRef/);
  assert.match(ccc, /if \(declared\) return/);
});

test("mempool contention persists a configurable grace window", async () => {
  const reconcile = await text("workflows/reconcile/src/reconcile.ts");
  assert.match(reconcile, /CELLFLOW_CONTENTION_GRACE_MS/);
  assert.match(reconcile, /firstObservedAt/);
  assert.match(reconcile, /graceExpiresAt/);
  assert.match(reconcile, /graceExpired/);
  assert.match(reconcile, /INPUT_CONTENTION_GRACE_EXPIRED/);
});

test("post-grace recovery is role-aware", async () => {
  const state = await text("packages/core/src/state-machine.ts");
  assert.match(state, /classification === "MEMPOOL_CONTENDED" && details\.graceExpired === true/);
  assert.match(state, /RECOLLECT_WALLET_INPUTS/);
  assert.match(state, /REBUILD_FROM_LIVE_STATE/);
  assert.match(state, /REBUILD_AND_RESIGN/);
});
