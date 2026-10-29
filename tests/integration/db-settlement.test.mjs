/**
 * Requires DATABASE_URL and applied migrations. Does not run against a shared
 * deployment without explicit configuration. The repository's PostgreSQL
 * transaction and actual webhook outbox are exercised, not mocked.
 * Run: node --experimental-transform-types --test tests/integration/db-settlement.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
const enabled = Boolean(process.env.DATABASE_URL);
if (process.env.CELLFLOW_REQUIRE_DB_TESTS === 'true' && !enabled) {
  throw new Error('DATABASE_URL is required: refusing to skip real PostgreSQL tests.');
}

async function fixture(webhookOverride = null) {
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
    url: webhookOverride?.url ?? `https://example.com/settlement-review/${suffix}`,
    signingSecretEncrypted: webhookOverride?.ciphertext ?? `test-ciphertext-${suffix}`,
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
  assert.equal((await repository.executionPublicView(current)).settlementReady, false);
  let rows = await sql`select kind from state_events where intent_row_id=${aggregate.intent.id} and kind='SETTLEMENT_READY'`;
  assert.equal(rows.length, 0);

  await repository.applySnapshot({aggregate:current, snapshot:chainCommitted(snapshotFromExecution(current.execution)),
    event: event('ASSERTION_VERIFIED','CONFIRMED'), assertionStatus:'VERIFIED', nextReconcileAt:null});
  current = await repository.getIntent(project.id, aggregate.intent.intentId);
  assert.equal((await repository.executionPublicView(current)).settlementReady, true);
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
  assert.equal((await repository.executionPublicView(current)).settlementReady, false);
  assert.equal(current.execution.settlementReadyAt, null);
  const rows = await sql`select kind from state_events where intent_row_id=${aggregate.intent.id} and kind='SETTLEMENT_REVOKED'`;
  assert.equal(rows.length, 1);
  const outbox = await sql`select wd.payload from webhook_deliveries wd join state_events se on se.id=wd.event_id
    where se.intent_row_id=${aggregate.intent.id} and se.kind='SETTLEMENT_REVOKED'`;
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].payload.data.settlementReady, false);
});


test('real PostgreSQL outbox -> signed webhook -> retry -> successful delivery, no second delivery', {skip: !enabled}, async () => {
  const { encryptSecret, verifyWebhookSignature } = await import('../../packages/webhooks/src/crypto.ts');
  const { deliverWebhookEvent } = await import('../../workflows/webhook-delivery/src/index.ts');
  const master = 'cellflow-ci-isolated-test-master-key-32-chars';
  const previousMaster = process.env.CELLFLOW_ENCRYPTION_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.CELLFLOW_ENCRYPTION_KEY = master;
  process.env.NODE_ENV = 'test';
  const signingSecret = `test-hook-secret-${randomUUID()}`;
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const timestamp = Number(req.headers['x-cellflow-timestamp']);
      const signatureValid = verifyWebhookSignature({
        rawBody: body, timestamp, signatureHeader: String(req.headers['x-cellflow-signature']),
        secret: signingSecret,
      });
      received.push({ eventId: req.headers['x-cellflow-event-id'], body: JSON.parse(body), signatureValid });
      res.writeHead(received.length === 1 ? 503 : 200);
      res.end(received.length === 1 ? 'retry' : 'ok');
    });
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const {repository, sql, project, aggregate} = await fixture({
      url: `http://127.0.0.1:${address.port}/hook`,
      ciphertext: encryptSecret(signingSecret, master),
    });
    const { snapshotFromExecution } = await import('../../packages/db/src/index.ts');
    await repository.applySnapshot({aggregate, snapshot:chainCommitted(snapshotFromExecution(aggregate.execution)),
      event:event('ASSERTION_VERIFIED','CONFIRMED'), assertionStatus:'VERIFIED', nextReconcileAt:null});
    const rows = await sql`select id from state_events where intent_row_id=${aggregate.intent.id} and kind='SETTLEMENT_READY'`;
    assert.equal(rows.length, 1);
    const eventId = String(rows[0].id);
    const first = await deliverWebhookEvent(project.id, eventId);
    assert.equal(first.attempted, 1);
    assert.equal(first.delivered, 0);
    const retriable = await sql`select status, attempt_count from webhook_deliveries where event_id=${eventId}`;
    assert.equal(retriable[0].status, 'RETRY');
    assert.equal(Number(retriable[0].attempt_count), 1);
    await sql`update webhook_deliveries set next_attempt_at=now()-interval '1 second' where event_id=${eventId}`;
    const second = await deliverWebhookEvent(project.id, eventId);
    assert.equal(second.attempted, 1);
    assert.equal(second.delivered, 1);
    const third = await deliverWebhookEvent(project.id, eventId);
    assert.equal(third.attempted, 0);
    assert.equal(received.length, 2);
    assert.ok(received.every(record => record.eventId === eventId && record.signatureValid));
    assert.ok(received.every(record => record.body?.data?.settlementReady === true));
    const delivered = await sql`select status, attempt_count from webhook_deliveries where event_id=${eventId}`;
    assert.equal(delivered[0].status, 'DELIVERED');
    assert.equal(Number(delivered[0].attempt_count), 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousMaster === undefined) delete process.env.CELLFLOW_ENCRYPTION_KEY;
    else process.env.CELLFLOW_ENCRYPTION_KEY = previousMaster;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});


test.after(async () => {
  if (!enabled) return;
  const db = await import('../../packages/db/src/index.ts');
  await db.closeSql();
});
