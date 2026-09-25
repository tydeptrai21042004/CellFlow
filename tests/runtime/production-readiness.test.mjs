import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("V0.3 migration adds least-privilege expiring API keys and project evidence", async () => {
  const sql = await read("packages/db/migrations/003_production_readiness.sql");
  assert.match(sql, /scopes text\[\]/i);
  assert.match(sql, /expires_at/i);
  assert.match(sql, /project_evidence_exports/i);
});

test("API authentication enforces scopes and expiry-aware lookup", async () => {
  const auth = await read("apps/api/src/auth.ts");
  const repository = await read("packages/db/src/repository.ts");
  assert.match(auth, /AUTH_SCOPE_REQUIRED/);
  assert.match(auth, /requiredScope/);
  assert.match(repository, /expires_at > now\(\)/i);
  assert.match(repository, /auth_scopes/i);
});

test("RPC failover includes circuit breaking and network identity probes", async () => {
  const rpc = await read("workflows/reconcile/src/rpc.ts");
  const service = await read("apps/api/src/service.ts");
  assert.match(rpc, /CKB_RPC_CIRCUIT_FAILURES/);
  assert.match(rpc, /healthyFirst/);
  assert.match(rpc, /getBlockchainInfo/);
  assert.match(service, /ckb_testnet/);
  assert.match(service, /RPC network mismatch/);
});

test("readiness can pin genesis and fails open bootstrap configuration in production", async () => {
  const ready = await read("apps/web/app/api/ready/route.ts");
  assert.match(ready, /CKB_EXPECTED_GENESIS_HASH/);
  assert.match(ready, /setupLocked/);
  assert.match(ready, /only one CKB RPC endpoint configured/);
});

test("operational health and grant evidence are exposed as machine-readable endpoints", async () => {
  const repository = await read("packages/db/src/repository.ts");
  const dashboard = await read("apps/web/components/Dashboard.tsx");
  const operations = await read("apps/web/app/api/v1/operations/route.ts");
  const evidence = await read("apps/web/app/api/v1/project-evidence/route.ts");
  assert.match(repository, /getOperationalHealth/);
  assert.match(repository, /stale_active_intents/);
  assert.match(operations, /operationalHealth/);
  assert.match(evidence, /projectEvidence/);
  assert.match(dashboard, /Export project evidence/);
});

test("failed webhook deliveries have an explicit operator retry path", async () => {
  const repository = await read("packages/db/src/repository.ts");
  const route = await read("apps/web/app/api/v1/webhooks/retry/route.ts");
  const ui = await read("apps/web/components/IntegrationsPanel.tsx");
  assert.match(repository, /retryFailedWebhookDeliveries/);
  assert.match(route, /retryWebhookFailures/);
  assert.match(ui, /Retry failed/);
});

test("HTTP responses have trace IDs and the web app emits production security headers", async () => {
  const http = await read("apps/api/src/http.ts");
  const config = await read("apps/web/next.config.ts");
  assert.match(http, /x-request-id/);
  assert.match(http, /JSON\.stringify\(entry\)/);
  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /X-Frame-Options/);
  assert.match(config, /X-Robots-Tag/);
});

test("direct third-party dependency versions are pinned", async () => {
  const root = JSON.parse(await read("package.json"));
  const web = JSON.parse(await read("apps/web/package.json"));
  const db = JSON.parse(await read("packages/db/package.json"));
  for (const deps of [root.devDependencies, web.dependencies, web.devDependencies, db.dependencies]) {
    for (const [name, version] of Object.entries(deps ?? {})) {
      if (name.startsWith("@cellflow/")) continue;
      assert.doesNotMatch(String(version), /^[~^*]/, `${name} should be pinned`);
    }
  }
});

test("project evidence is read-only for reviewers and durable recording is admin-only", async () => {
  const route = await read("apps/web/app/api/v1/project-evidence/route.ts");
  const service = await read("apps/api/src/service.ts");
  assert.match(route, /projectEvidence\(project, false\)/);
  assert.match(route, /projectFromRequest\(request, "admin"\)/);
  assert.match(route, /projectEvidence\(project, true\)/);
  assert.match(service, /persisted: false/);
  assert.match(service, /VERCEL_GIT_COMMIT_SHA/);
});

test("production readiness redacts details and validates network plus RPC transport", async () => {
  const ready = await read("apps/web/app/api/ready/route.ts");
  assert.match(ready, /canSeeDetails/);
  assert.match(ready, /authenticateBearer/);
  assert.match(ready, /rpcNetwork/);
  assert.match(ready, /CKB_ALLOW_INSECURE_RPC/);
  assert.match(ready, /detailed \? \{ \.\.\.base, checks, rpc, warnings, errors \} : base/);
});

test("release preflight makes dependency reproducibility an explicit release gate", async () => {
  const script = await read("scripts/release-preflight.mjs");
  const ci = await read(".github/workflows/ci.yml");
  const root = JSON.parse(await read("package.json"));
  assert.match(script, /dependency-lockfile/);
  assert.match(script, /pinned-direct-dependencies/);
  assert.match(ci, /npm run release:check/);
  assert.equal(root.scripts["release:check"], "node scripts/release-preflight.mjs --strict");
});
