import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const enabled = Boolean(process.env.DATABASE_URL);
let db = null;

async function loadDb() {
  if (!enabled) return null;
  if (!db) db = await import("../../packages/db/src/index.ts");
  return db;
}

async function fixture() {
  const { CellFlowRepository } = await loadDb();
  const repository = new CellFlowRepository();
  const suffix = randomUUID().slice(0, 8);
  const project = await repository.createProject({
    name: `db-concurrency-${suffix}`,
    network: "testnet",
    confirmationPolicy: { mode: "depth", blocks: 4 },
    apiKeyId: randomUUID(),
    apiKeyPrefix: `cf_${suffix}`,
    apiKeyHash: `hash-${suffix}`,
  });
  const { aggregate } = await repository.createIntent({
    project,
    intentId: `race:${suffix}`,
    metadata: {},
    expectedCells: [],
    txHash: `0x${"ab".repeat(32)}`,
    submissionStatus: "SUBMITTED",
  });
  return { repository, project, aggregate };
}

test("only one worker claims a due reconciliation lease", { skip: !enabled }, async () => {
  const { repository } = await fixture();
  const [a, b] = await Promise.all([
    repository.claimDueExecutions(1, `worker-a-${randomUUID()}`, 60),
    repository.claimDueExecutions(1, `worker-b-${randomUUID()}`, 60),
  ]);
  assert.equal(a.length + b.length, 1);
});

test("an expired lease can be reclaimed by another worker", { skip: !enabled }, async () => {
  const { repository } = await fixture();
  const firstLease = `worker-a-${randomUUID()}`;
  const first = await repository.claimDueExecutions(1, firstLease, 60);
  assert.equal(first.length, 1);
  const executionId = first[0].execution.id;

  const { getSql } = await loadDb();
  const sql = getSql();
  await sql`
    update executions
    set reconcile_lease_until = now() - interval '1 second'
    where id = ${executionId}
  `;

  const second = await repository.claimDueExecutions(1, `worker-b-${randomUUID()}`, 60);
  assert.equal(second.length, 1);
  assert.equal(second[0].execution.id, executionId);
});

test("stale optimistic-concurrency writers are rejected", { skip: !enabled }, async () => {
  const { repository, project, aggregate } = await fixture();
  const stale = await repository.getIntent(project.id, aggregate.intent.intentId);
  assert.ok(stale);

  const { OptimisticConcurrencyError, snapshotFromExecution } = await loadDb();
  const snapshot = {
    ...snapshotFromExecution(aggregate.execution),
    workflowStatus: "RECONCILING",
  };
  await repository.applySnapshot({
    aggregate,
    snapshot,
    event: {
      kind: "TEST_RECONCILE",
      fromStatus: "SUBMITTED",
      toStatus: "RECONCILING",
      occurredAt: new Date().toISOString(),
    },
    nextReconcileAt: new Date(Date.now() + 60_000),
  });

  await assert.rejects(
    repository.applySnapshot({
      aggregate: stale,
      snapshot,
      event: {
        kind: "TEST_STALE_WRITE",
        fromStatus: "SUBMITTED",
        toStatus: "RECONCILING",
        occurredAt: new Date().toISOString(),
      },
      nextReconcileAt: new Date(Date.now() + 60_000),
    }),
    (error) => error instanceof OptimisticConcurrencyError,
  );
});

test.after(async () => {
  if (!enabled || !db) return;
  await db.closeSql();
});
