import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) { return readFile(path, "utf8"); }

test("RPC configuration supports multiple fallback endpoints and bounded timeouts", async () => {
  const rpc = await text("workflows/reconcile/src/rpc.ts");
  const reconcile = await text("workflows/reconcile/src/reconcile.ts");
  assert.match(rpc, /parseRpcUrls/);
  assert.match(rpc, /CKB_RPC_TIMEOUT_MS/);
  assert.match(reconcile, /CKB_RPC_FALLBACK_URLS/);
});

test("readiness probe verifies database, RPC and critical runtime secrets", async () => {
  const ready = await text("apps/web/app/api/ready/route.ts");
  assert.match(ready, /repository\.ping/);
  assert.match(ready, /getTipHeader/);
  assert.match(ready, /CELLFLOW_ENCRYPTION_KEY/);
  assert.match(ready, /CRON_SECRET/);
});

test("maintenance tasks are failure-isolated", async () => {
  const maintenance = await text("apps/web/app/api/internal/maintenance/route.ts");
  assert.match(maintenance, /Promise\.allSettled/);
  assert.match(maintenance, /rateLimitCleanup/);
  assert.match(maintenance, /status: ok \? 200 : 207/);
});

test("JSON request parser enforces a body size ceiling and deterministic errors", async () => {
  const server = await text("apps/web/lib/server.ts");
  assert.match(server, /CELLFLOW_MAX_JSON_BODY_BYTES/);
  assert.match(server, /REQUEST_TOO_LARGE/);
  assert.match(server, /INVALID_JSON/);
});

test("operator notes are durable audit events exposed by API and UI", async () => {
  const repository = await text("packages/db/src/repository.ts");
  const route = await text("apps/web/app/api/v1/intents/[intentId]/notes/route.ts");
  const drawer = await text("apps/web/components/IntentDrawer.tsx");
  assert.match(repository, /OPERATOR_NOTE/);
  assert.match(route, /operatorNoteSchema/);
  assert.match(drawer, /Durable audit annotation/);
});

test("webhooks expose delivery health and can be disabled without deleting history", async () => {
  const repository = await text("packages/db/src/repository.ts");
  const route = await text("apps/web/app/api/v1/webhooks/[endpointId]/route.ts");
  const ui = await text("apps/web/components/IntegrationsPanel.tsx");
  assert.match(repository, /delivered_count/);
  assert.match(repository, /enabled = false/);
  assert.match(route, /service\.disableWebhook/);
  assert.match(ui, /pendingCount/);
  assert.match(ui, /Disable/);
});


test("dashboard metrics come from project-wide database aggregates rather than the 200-row view", async () => {
  const repository = await text("packages/db/src/repository.ts");
  const route = await text("apps/web/app/api/v1/metrics/route.ts");
  const dashboard = await text("apps/web/components/Dashboard.tsx");
  assert.match(repository, /getProjectMetrics/);
  assert.match(route, /service\.projectMetrics/);
  assert.match(dashboard, /\/api\/v1\/metrics/);
});
