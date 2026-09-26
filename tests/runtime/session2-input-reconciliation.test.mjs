import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) { return readFile(path, "utf8"); }

test("CCC performs direct preflight before broadcasting", async () => {
  const source = await text("packages/ccc/src/ccc.ts");
  const preflightAt = source.indexOf("await options.flow.preflight");
  const broadcastingAt = source.indexOf("await options.flow.markBroadcasting");
  const sendAt = source.indexOf("sendTransaction(signed)");
  assert.ok(preflightAt >= 0);
  assert.ok(broadcastingAt > preflightAt);
  assert.ok(sendAt > broadcastingAt);
});

test("input inspection separates canonical and tx-pool-aware views", async () => {
  const rpc = await text("workflows/reconcile/src/rpc.ts");
  assert.match(rpc, /liveCellParams\(outPoint, false\)/);
  assert.match(rpc, /liveCellParams\(outPoint, true\)/);
  assert.match(rpc, /MEMPOOL_CONTENDED/);
  assert.match(rpc, /CANONICALLY_SPENT/);
  assert.match(rpc, /creatorCanonicalEvidence/);
  assert.match(rpc, /canonicalHash === blockHash/);
});

test("reconciliation keeps spend provisional before confirmation window", async () => {
  const reconcile = await text("workflows/reconcile/src/reconcile.ts");
  assert.match(reconcile, /INPUT_SPENT_OBSERVED/);
  assert.match(reconcile, /conflictObservationMatured/);
  assert.match(reconcile, /INPUT_CONFLICT_CONFIRMED/);
  assert.match(reconcile, /setWorkflowStatus\(nextSnapshot, "CONFLICTED"\)/);
  assert.match(reconcile, /INPUT_POOL_CONTENTION_DETECTED/);
});

test("RBF-like node rejection remains reconcilable when conflict is only suspected", async () => {
  const service = await text("apps/api/src/service.ts");
  const repository = await text("packages/db/src/repository.ts");
  assert.match(service, /status === "NODE_REJECTED" && failure\?\.conflictType === "INPUT_CONFLICT_SUSPECTED"/);
  assert.match(repository, /submission_status <> 'NODE_REJECTED' or e\.conflict_type = 'INPUT_CONFLICT_SUSPECTED'/);
});

test("preflight endpoint fails closed through direct RPC input inspection", async () => {
  const service = await text("apps/api/src/service.ts");
  const route = await text("apps/web/app/api/v1/intents/[intentId]/preflight/route.ts");
  assert.match(service, /inspectInputOutPoints/);
  assert.match(service, /inspection\.state !== "ALL_LIVE"/);
  assert.match(service, /INPUT_PREFLIGHT_FAILED/);
  assert.match(service, /INPUT_PREFLIGHT_VERIFIED/);
  assert.match(route, /service\.preflight/);
});
