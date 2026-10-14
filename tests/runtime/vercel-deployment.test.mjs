import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, cp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
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


test("Vercel preflight permits GitHub web-upload checkout without dotfiles, strict release does not", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const sandbox = await mkdtemp(join(tmpdir(), "cellflow-vercel-preflight-"));
  const checkout = join(sandbox, "checkout");
  const omit = new Set([
    ".nvmrc", ".gitignore", ".env.example", ".env.testnet.example",
    "node_modules", ".git", ".next", ".vercel", ".tmp", "dist", "coverage",
  ]);
  try {
    await cp(root, checkout, {
      recursive: true,
      filter: (src) => {
        const parts = relative(root, src).split(sep);
        return !parts.some((part) => omit.has(part));
      },
    });
    const run = (...args) => spawnSync(process.execPath,
      ["scripts/release-preflight.mjs", ...args], { cwd: checkout, encoding: "utf8" });
    const deploy = run("--vercel");
    assert.equal(deploy.status, 0, deploy.stderr || deploy.stdout);
    const report = JSON.parse(deploy.stdout);
    assert.equal(report.readyForVercelDeployment, true);
    assert.equal(report.readyForCleanReleasePipeline, false);
    assert.deepEqual(report.blockers, []);
    for (const path of [".nvmrc", ".gitignore", ".env.example", ".env.testnet.example"]) {
      assert.ok(report.warnings.some((x) => x.name === `file:${path}`), `${path} should be warned about`);
    }
    const strict = run("--strict");
    assert.equal(strict.status, 1, "Strict source-release mode must require missing support files");
    await unlink(join(checkout, "packages/db/migrations/003_production_readiness.sql"));
    const unsafe = run("--vercel");
    assert.equal(unsafe.status, 1, "Required production migration must block deployment");
    assert.ok(JSON.parse(unsafe.stdout).blockers.some((x) => x.name === "file:packages/db/migrations/003_production_readiness.sql"));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
