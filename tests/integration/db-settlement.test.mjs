/**
 * Requires DATABASE_URL and applied migrations. Does not run against a shared
 * deployment without explicit configuration. The repository's PostgreSQL
 * transaction and actual webhook outbox are exercised, not mocked.
 * Run: node --experimental-transform-types --test tests/integration/db-settlement.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const enabled = Boolean(process.env.DATABASE_URL);

async function fixture() {
  const { CellFlowRepository, getSql } = await import('../../packages/db/src/index.ts');
  const repository = new CellFlowRepository();
  const sql = getSql();
  const suffix = randomUUID().slice(0, 8);
  const project = await repository.createProject({
    name: `settlement-regression-${suffix}`,
    network: 'testnet',
    confirmationPolicy: {mode: 'depth', blocks: 4},
    apiKeyId: randomUUID(), apiKeyPrefix: `cf_${suffix}`, apiKeyHash: `hash-${suffix}`,
  });
  await repository.createWebhookEndpoint({
    projectId: project.id,
    url: `https://example.com/settlement-review/${suffix}`,
    signingSecretEncrypted: `test-ciphertext-${suffix}`,
  });
  const { aggregate } = await repository.createIntent({
    project, intentId: `settlement-review:${suffix}`, metadata: {},
    expectedCells: [{outputIndex:0, mode:'live'}],
    txHash: `0x${'df'.repeat(32)}`,
    submissionStatus: 'SUBMITTED',
  });
  return {repository, sql, project, aggregate};
}
function chainCommitted(snapshot) {
  return {
    ...snapshot, submissionStatus: 'SUBMITTED', chainStatus: 'COMMITTED', workflowStatus: 'CONFIRMED',
    confirmationCount: 4, committedBlockHash: `0x${'cd'.repeat(32)}`, committedBlockNumber: '0x64',
  };
}
function event(kind, status) {
  return {kind, fromStatus: 'SUBMITTED', toStatus: status, occurredAt: new Date().toISOString(),
    rawObservation: {rpcEndpoint: 'local-test', blockHash: `0x${'cd'.repeat(32)}`}};
}

test('PENDING -> VERIFIED emits one settlement-ready webhook and never early', {skip: !enabled}, async () => {
  const {repository, sql, project, aggregate} = await fixture();
  const { snapshotFromExecution } = await import('../../packages/db/src/index.ts');
  const snapshot = chainCommitted(snapshotFromExecution(aggregate.execution));
  await repository.applySnapshot({aggregate, snapshot, event: event('CONFIRMED','CONFIRMED'),
    assertionStatus:'PENDING', nextReconcileAt: new Date(Date.now()+12000)});
  let current = await repository.getIntent(project.id, aggregate.intent.intentId);
  assert.equal(repository.executionPublicView(current).settlementReady, false);
  let rows = await sql`select kind from state_events where intent_row_id=${aggregate.intent.id} and kind='SETTLEMENT_READY'`;
  assert.equal(rows.length, 0);

  await repository.applySnapshot({aggregate:current, snapshot:chainCommitted(snapshotFromExecution(current.execution)),
    event: event('ASSERTION_VERIFIED','CONFIRMED'), assertionStatus:'VERIFIED', nextReconcileAt:null});
  current = await repository.getIntent(project.id, aggregate.intent.intentId);
  assert.equal(repository.executionPublicView(current).settlementReady, true);
  assert.ok(current.execution.settlementReadyAt);
  await repository.applySnapshot({aggregate:current, snapshot:chainCommitted(snapshotFromExecution(current.execution)),
    event: event('CHAIN_OBSERVED','CONFIRMED'), assertionStatus:'VERIFIED', nextReconcileAt:null});
  rows = await sql`select kind from state_events where intent_row_id=${aggregate.intent.id} and kind='SETTLEMENT_READY'`;
  assert.equal(rows.length, 1);
  const outbox = await sql`select wd.event_type, wd.payload from webhook_deliveries wd
    join state_events se on se.id=wd.event_id where se.intent_row_id=${aggregate.intent.id} and se.kind='SETTLEMENT_READY'`;
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].event_type, 'intent.settlement_ready');
  assert.equal(outbox[0].payload.data.settlementReady, true);
});

test('post-confirmation reorg emits settlement revocation and clears monitoring anchor', {skip: !enabled}, async () => {
  const {repository, sql, project, aggregate} = await fixture();
  const { snapshotFromExecution } = await import('../../packages/db/src/index.ts');
  let snapshot = chainCommitted(snapshotFromExecution(aggregate.execution));
  await repository.applySnapshot({aggregate, snapshot, event:event('ASSERTION_VERIFIED','CONFIRMED'),
    assertionStatus:'VERIFIED', nextReconcileAt:null});
  let current = await repository.getIntent(project.id, aggregate.intent.intentId);
  snapshot = {...snapshotFromExecution(current.execution), workflowStatus:'REORGED', chainStatus:'PENDING', confirmationCount:0,
    committedBlockHash:undefined, committedBlockNumber:undefined};
  await repository.applySnapshot({aggregate:current, snapshot, event:event('REORG_DETECTED','REORGED'),
    assertionStatus:null, assertionResult:null, nextReconcileAt:new Date(Date.now()+12000)});
  current = await repository.getIntent(project.id, aggregate.intent.intentId);
  assert.equal(repository.executionPublicView(current).settlementReady, false);
  assert.equal(current.execution.settlementReadyAt, null);
  const rows = await sql`select kind from state_events where intent_row_id=${aggregate.intent.id} and kind='SETTLEMENT_REVOKED'`;
  assert.equal(rows.length, 1);
  const outbox = await sql`select wd.payload from webhook_deliveries wd join state_events se on se.id=wd.event_id
    where se.intent_row_id=${aggregate.intent.id} and se.kind='SETTLEMENT_REVOKED'`;
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].payload.data.settlementReady, false);
});
