import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("V0.2 migration contains worker leases and workflow dedupe fields", async () => {
  const sql = await read("packages/db/migrations/002_v02_hardening.sql");
  for (const field of ["reconcile_lease_id", "reconcile_lease_until", "workflow_run_id", "lease_owner", "lease_until"]) {
    assert.match(sql, new RegExp(field));
  }
});

test("repository claims concurrent work using SKIP LOCKED", async () => {
  const source = await read("packages/db/src/repository.ts");
  assert.match(source, /for update of e skip locked/i);
  assert.match(source, /for update skip locked/i);
  assert.match(source, /OptimisticConcurrencyError/);
});

test("state event and webhook outbox are emitted by the same repository transaction path", async () => {
  const source = await read("packages/db/src/repository.ts");
  assert.match(source, /insertEventAndOutbox/);
  assert.match(source, /insert into state_events/i);
  assert.match(source, /insert into webhook_deliveries/i);
});

test("browser does not persist service API key in sessionStorage/localStorage", async () => {
  const dashboard = await read("apps/web/components/Dashboard.tsx");
  const bootstrap = await read("apps/web/components/BootstrapProject.tsx");
  assert.doesNotMatch(dashboard, /sessionStorage|localStorage/);
  assert.doesNotMatch(bootstrap, /sessionStorage|localStorage/);
  assert.match(bootstrap, /CELLFLOW_BOOTSTRAP_TOKEN/);
});

test("encryption and bootstrap secrets are separate", async () => {
  const env = await read(".env.example");
  assert.match(env, /CELLFLOW_ENCRYPTION_KEY=/);
  assert.match(env, /CELLFLOW_BOOTSTRAP_TOKEN=/);
});
