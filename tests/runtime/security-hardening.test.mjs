import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("RPC failure preserves prior trusted chain state through the state machine", async () => {
  const source = await read("workflows/reconcile/src/reconcile.ts");
  assert.match(source, /source: "rpc_failure"/);
  assert.match(source, /applyChainObservation\(prior, failureObservation\)/);
  assert.doesNotMatch(source, /snapshot: \{ \.\.\.reconciling, chainStatus: "UNKNOWN" \}/);
});

test("API-key mutations serialize at project scope", async () => {
  const source = await read("packages/db/src/repository.ts");
  const projectLocks = source.match(/select id from projects where id = \$\{(?:input\.projectId|projectId)\} for update/g) ?? [];
  assert.ok(projectLocks.length >= 2, "create and revoke should share a project-level lock");
  assert.match(source, /LAST_ADMIN/);
  assert.match(source, /activeAdmins\.length <= 1/);
});

test("intent evidence GET is read-only and persistence requires admin POST", async () => {
  const route = await read("apps/web/app/api/v1/intents/[intentId]/evidence/route.ts");
  const service = await read("apps/api/src/service.ts");
  assert.match(route, /service\.evidence\(project, intentId, false\)/);
  assert.match(route, /export async function POST/);
  assert.match(route, /projectFromRequest\(request, "admin"\)/);
  assert.match(route, /service\.evidence\(project, intentId, true\)/);
  assert.match(service, /if \(!persist\) return \{ \.\.\.document, sha256, persisted: false \}/);
});

test("reconciliation validates the exact failover RPC identity before trusting it", async () => {
  const rpc = await read("workflows/reconcile/src/rpc.ts");
  const reconcile = await read("workflows/reconcile/src/reconcile.ts");
  assert.match(rpc, /await session\.assertIdentity\(expectedIdentity\)/);
  assert.match(rpc, /RPC endpoint network mismatch/);
  assert.match(rpc, /RPC endpoint genesis hash mismatch/);
  assert.match(reconcile, /chain: expectedChain\(project\.network\)/);
});

test("readiness probes every configured RPC instead of mixing failover sessions", async () => {
  const source = await read("apps/web/app/api/ready/route.ts");
  assert.match(source, /for \(const url of urls\)/);
  assert.match(source, /new CkbRpcClient\(\[url\]\)/);
  assert.match(source, /endpointResults\.every/);
});

test("release artifacts include environment template and CI workflow", async () => {
  const env = await read(".env.example");
  const ci = await read(".github/workflows/ci.yml");
  assert.match(env, /CKB_EXPECTED_GENESIS_HASH=/);
  assert.match(env, /CELLFLOW_BOOTSTRAP_TOKEN=/);
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm run release:check/);
});
