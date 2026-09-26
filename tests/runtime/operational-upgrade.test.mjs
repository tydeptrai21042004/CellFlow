import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) { return readFile(path, "utf8"); }

test("migration 004 adds durable per-project genesis identity and pagination indexes", async () => {
  const migration = await text("packages/db/migrations/004_operational_scalability.sql");
  assert.match(migration, /rpc_genesis_hash/);
  assert.match(migration, /intents_project_created_id_idx/);
  assert.match(migration, /executions_active_observation_idx/);
  assert.match(migration, /webhook_deliveries_project_due_idx/);
});

test("custom RPC genesis is persisted per project and reused during reconciliation", async () => {
  const service = await text("apps/api/src/service.ts");
  const repository = await text("packages/db/src/repository.ts");
  const reconcile = await text("workflows/reconcile/src/reconcile.ts");
  assert.match(service, /rpcGenesisHash = observedGenesis/);
  assert.match(repository, /rpc_genesis_hash/);
  assert.match(reconcile, /project\.rpcGenesisHash \?\?/);
});

test("intent listing uses opaque keyset pagination instead of unbounded offset scans", async () => {
  const repository = await text("packages/db/src/repository.ts");
  const service = await text("apps/api/src/service.ts");
  const route = await text("apps/web/app/api/v1/intents/route.ts");
  const dashboard = await text("apps/web/components/Dashboard.tsx");
  assert.match(repository, /\(i\.created_at, i\.id\) </);
  assert.match(service, /base64url/);
  assert.match(service, /INVALID_CURSOR/);
  assert.match(route, /searchParams\.get\("cursor"\)/);
  assert.match(dashboard, /Load older intents/);
});

test("reconciliation and webhook workers renew leases and use bounded concurrency", async () => {
  const repository = await text("packages/db/src/repository.ts");
  const reconcile = await text("workflows/reconcile/src/reconcile.ts");
  const webhookWorker = await text("workflows/webhook-delivery/src/index.ts");
  const maintenance = await text("apps/web/app/api/internal/maintenance/route.ts");
  assert.match(repository, /renewReconcileLease/);
  assert.match(repository, /renewWebhookDeliveryLease/);
  assert.match(reconcile, /CELLFLOW_RECONCILE_CONCURRENCY/);
  assert.match(reconcile, /initialLeaseSeconds/);
  assert.match(webhookWorker, /CELLFLOW_WEBHOOK_CONCURRENCY/);
  assert.match(maintenance, /CELLFLOW_MAINTENANCE_RECONCILE_LIMIT/);
});

test("webhook test delivery targets its own event instead of draining unrelated backlog", async () => {
  const repository = await text("packages/db/src/repository.ts");
  const worker = await text("workflows/webhook-delivery/src/index.ts");
  const route = await text("apps/web/app/api/v1/webhooks/test/route.ts");
  assert.match(repository, /claimWebhookDeliveriesForEvent/);
  assert.match(worker, /deliverWebhookEvent/);
  assert.match(route, /deliverWebhookEvent\(project\.id, eventId\)/);
});

test("webhook delivery honors Retry-After and enforces a total attempt budget", async () => {
  const delivery = await text("packages/webhooks/src/delivery.ts");
  assert.match(delivery, /retryAfterMs/);
  assert.match(delivery, /retry-after/);
  assert.match(delivery, /CELLFLOW_WEBHOOK_MAX_ATTEMPTS/);
  assert.match(delivery, /x-cellflow-attempt/);
});

test("readiness verifies latest schema migration and liveness returns 503 when database is unhealthy", async () => {
  const ready = await text("apps/web/app/api/ready/route.ts");
  const health = await text("apps/web/app/api/health/route.ts");
  assert.match(ready, /005_input_evidence\.sql/);
  assert.match(ready, /schema: false/);
  assert.match(health, /status: database \? 200 : 503/);
});

test("browser and CLI requests carry correlation IDs that errors echo into support messages", async () => {
  const http = await text("apps/api/src/http.ts");
  const browser = await text("apps/web/lib/browser-api.ts");
  const cli = await text("packages/cli/bin/cellflow.mjs");
  assert.match(http, /requestIdFrom/);
  assert.match(http, /x-request-id/);
  assert.match(browser, /crypto\?\.randomUUID/);
  assert.match(browser, /\[request \$\{correlation\}\]/);
  assert.match(cli, /randomUUID/);
  assert.match(cli, /operations/);
});
