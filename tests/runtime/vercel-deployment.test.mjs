import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { selectInstall } from "../../scripts/vercel-install.mjs";
import { assertDeployedReadiness, verifyLive } from "../../scripts/verify-deployment.mjs";

const sha = "a".repeat(40);
test("Vercel uses npm install without an npm lock, npm ci when a valid lock exists", () => {
  assert.deepEqual(selectInstall().args, ["install", "--no-audit", "--no-fund", "--package-lock=false"]);
  assert.equal(selectInstall({ packageLock: true }).args[0], "ci");
  assert.equal(selectInstall({ shrinkwrap: true }).args[0], "ci");
  assert.throws(() => selectInstall({ packageLock: true, lockValid: false }), /invalid/);
});
test("Vercel installation plan prints without accessing npm registry", () => {
  const result = spawnSync(process.execPath, ["scripts/vercel-install.mjs", "--print-plan"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm install.*--package-lock=false|npm ci/);
});
test("Vercel deployment uses internal maintenance and build checks without GitHub Actions", async () => {
  const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url)));
  assert.equal(config.installCommand, "node scripts/vercel-install.mjs");
  assert.equal(config.buildCommand, "npm run ci:vercel");
  assert.ok(config.crons.some(x => x.path === "/api/internal/maintenance"));
  const preflight = await readFile(new URL("../../scripts/release-preflight.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(preflight, /\.github\/workflows\/\$\{workflow\}/);
});
test("deployment verifier rejects SHA mismatch, unhealthy readiness and malformed identifiers", () => {
  const body = { ok: true, releaseSha: sha, status: { code: "READY" }, version: "0.3.0" };
  assert.equal(assertDeployedReadiness({ expectedSha: sha, httpStatus: 200, body }).healthy, true);
  assert.throws(() => assertDeployedReadiness({ expectedSha: "bad", httpStatus: 200, body }), /40-character/);
  assert.throws(() => assertDeployedReadiness({ expectedSha: "b".repeat(40), httpStatus: 200, body }), /SHA mismatch/);
  assert.throws(() => assertDeployedReadiness({ expectedSha: sha, httpStatus: 503, body }), /not healthy/);
  assert.throws(() => assertDeployedReadiness({ expectedSha: sha, httpStatus: 200, body: { ...body, status: { code: "RPC_UNAVAILABLE" } } }), /not healthy/);
});
test("deployment verifier checks HTTPS origin and JSON without needing external network", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ ok: true, releaseSha: sha, status: { code: "READY" } }), { status: 200 });
  assert.equal((await verifyLive({ origin: "https://cellflow.example/", expectedSha: sha, fetchImpl })).healthy, true);
  await assert.rejects(() => verifyLive({ origin: "https://api-key@cellflow.example", expectedSha: sha, fetchImpl }), /clean deployment origin/);
  await assert.rejects(() => verifyLive({ origin: "http://cellflow.example", expectedSha: sha, fetchImpl }), /HTTPS/);
  await assert.rejects(() => verifyLive({ origin: "https://cellflow.example/console", expectedSha: sha, fetchImpl }), /clean deployment origin/);
});
