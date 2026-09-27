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

async function projectFixture() {
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
  return { repository, project, suffix };
}

async function fixture() {
  const { repository, project, suffix } = await projectFixture();
  const { aggregate } = await repository.createIntent({
    project,
    intentId: `race:${suffix}`,
    metadata: {},
    expectedCells: [],
    txHash: `0x${"ab".repeat(32)}`,
    submissionStatus: "SUBMITTED",
  });
  return { repository, project, aggregate, suffix };
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

test("20 duplicate create requests collapse to one logical intent and execution", { skip: !enabled }, async () => {
  const { repository, project, suffix } = await projectFixture();
  const intentId = `duplicate-create:${suffix}`;
  const calls = await Promise.all(Array.from({ length: 20 }, () => repository.createIntent({
    project,
    intentId,
    metadata: { source: "duplicate-race" },
    expectedCells: [],
    txHash: `0x${"ef".repeat(32)}`,
    submissionStatus: "SUBMITTED",
  })));

  assert.equal(calls.filter((item) => item.created).length, 1);
  assert.equal(new Set(calls.map((item) => item.aggregate.intent.id)).size, 1);
  assert.equal(new Set(calls.map((item) => item.aggregate.execution.id)).size, 1);

  const { getSql } = await loadDb();
  const sql = getSql();
  const rows = await sql`
    select count(*)::int as intents,
      (select count(*)::int from executions e join intents i2 on i2.id = e.intent_row_id
       where i2.project_id = ${project.id} and i2.intent_id = ${intentId}) as executions
    from intents i where i.project_id = ${project.id} and i.intent_id = ${intentId}
  `;
  assert.equal(Number(rows[0]?.intents), 1);
  assert.equal(Number(rows[0]?.executions), 1);
});

test("duplicate intent race emits one CREATED event and one webhook outbox item", { skip: !enabled }, async () => {
  const { repository, project, suffix } = await projectFixture();
  await repository.createWebhookEndpoint({
    projectId: project.id,
    url: `https://example.com/cellflow-test/${suffix}`,
    signingSecretEncrypted: `encrypted-${suffix}`,
  });
  const intentId = `outbox-race:${suffix}`;

  await Promise.all(Array.from({ length: 12 }, () => repository.createIntent({
    project,
    intentId,
    metadata: {},
    expectedCells: [],
    txHash: `0x${"12".repeat(32)}`,
    submissionStatus: "SUBMITTED",
  })));

  const { getSql } = await loadDb();
  const sql = getSql();
  const rows = await sql`
    select
      (select count(*)::int from state_events se join intents i on i.id = se.intent_row_id
       where i.project_id = ${project.id} and i.intent_id = ${intentId} and se.kind = 'CREATED') as created_events,
      (select count(*)::int from webhook_deliveries wd join state_events se on se.id = wd.event_id
       join intents i on i.id = se.intent_row_id
       where i.project_id = ${project.id} and i.intent_id = ${intentId} and se.kind = 'CREATED') as webhook_rows
  `;
  assert.equal(Number(rows[0]?.created_events), 1);
  assert.equal(Number(rows[0]?.webhook_rows), 1);
});

test("only one worker claims a webhook delivery and an expired webhook lease is recoverable", { skip: !enabled }, async () => {
  const { repository, project, suffix } = await projectFixture();
  await repository.createWebhookEndpoint({
    projectId: project.id,
    url: `https://example.com/cellflow-lease/${suffix}`,
    signingSecretEncrypted: `encrypted-${suffix}`,
  });
  await repository.createIntent({
    project,
    intentId: `webhook-lease:${suffix}`,
    metadata: {},
    expectedCells: [],
    txHash: `0x${"34".repeat(32)}`,
    submissionStatus: "SUBMITTED",
  });

  const ownerA = `webhook-a-${randomUUID()}`;
  const ownerB = `webhook-b-${randomUUID()}`;
  const [a, b] = await Promise.all([
    repository.claimDueWebhookDeliveries(1, ownerA, 60, project.id),
    repository.claimDueWebhookDeliveries(1, ownerB, 60, project.id),
  ]);
  assert.equal(a.length + b.length, 1);
  const claimed = (a[0] ?? b[0]);
  assert.ok(claimed);

  const { getSql } = await loadDb();
  const sql = getSql();
  await sql`update webhook_deliveries set lease_until = now() - interval '1 second' where id = ${claimed.id}`;

  const recovered = await repository.claimDueWebhookDeliveries(1, `webhook-recovery-${randomUUID()}`, 60, project.id);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, claimed.id);
});

test.after(async () => {
  if (!enabled || !db) return;
  await db.closeSql();
});
