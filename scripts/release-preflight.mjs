#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const checks = [];

async function exists(path) {
  try { await access(join(root, path), constants.F_OK); return true; } catch { return false; }
}
function add(name, ok, severity, detail) { checks.push({ name, ok, severity, detail }); }

const nodeMajor = Number(process.versions.node.split(".")[0]);
add("node-version", nodeMajor >= 22, "blocker", `Node ${process.versions.node}; required >=22`);

const lockfile = await exists("package-lock.json");
add("dependency-lockfile", lockfile, "blocker", lockfile ? "package-lock.json present" : "package-lock.json missing; generate and commit it before release");

for (const path of [
  "packages/db/migrations/003_production_readiness.sql",
  "packages/db/migrations/004_operational_scalability.sql",
  "SECURITY.md",
  "docs/operations/RUNBOOK.md",
  "docs/funding/REVIEWER_VERIFICATION.md",
  "docs/api/openapi.yaml",
]) add(`file:${path}`, await exists(path), "blocker", path);

const manifests = ["package.json"];
for (const dir of ["apps/api", "apps/web", "packages/assertions", "packages/ccc", "packages/cli", "packages/core", "packages/db", "packages/webhooks", "workflows/reconcile"]) {
  if (await exists(`${dir}/package.json`)) manifests.push(`${dir}/package.json`);
}
const floating = [];
for (const path of manifests) {
  const json = JSON.parse(await readFile(join(root, path), "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(json[section] ?? {})) {
      if (name.startsWith("@cellflow/")) continue;
      if (/^[~^*]|\bx\b/i.test(String(version))) floating.push(`${relative(root, join(root, path))}:${section}:${name}=${version}`);
    }
  }
}
add("pinned-direct-dependencies", floating.length === 0, "blocker", floating.length ? floating.join(", ") : "direct third-party versions are pinned");

add("file:.github/workflows/ci.yml", await exists(".github/workflows/ci.yml"), "blocker", ".github/workflows/ci.yml");

const envExampleExists = await exists(".env.example");
add("file:.env.example", envExampleExists, "blocker", envExampleExists ? ".env.example present" : ".env.example missing");
if (envExampleExists) {
  const envExample = await readFile(join(root, ".env.example"), "utf8");
  for (const key of [
    "DATABASE_URL", "CKB_NETWORK", "CKB_RPC_URL", "CKB_EXPECTED_GENESIS_HASH",
    "CELLFLOW_ENCRYPTION_KEY", "CELLFLOW_BOOTSTRAP_TOKEN", "CELLFLOW_SETUP_ENABLED", "CRON_SECRET",
    "CELLFLOW_RECONCILE_CONCURRENCY", "CELLFLOW_WEBHOOK_CONCURRENCY", "CELLFLOW_WEBHOOK_MAX_ATTEMPTS",
    "CKB_RPC_CIRCUIT_FAILURES", "CKB_RPC_CIRCUIT_COOLDOWN_MS", "CKB_ALLOW_INSECURE_RPC",
  ]) add(`env-template:${key}`, envExample.includes(`${key}=`), "blocker", `${key} documented`);
}

const blockers = checks.filter((item) => item.severity === "blocker" && !item.ok);
const report = {
  schemaVersion: "cellflow-release-preflight-v1",
  version: "0.3.0",
  generatedAt: new Date().toISOString(),
  readyForCleanReleasePipeline: blockers.length === 0,
  blockers: blockers.map(({ name, detail }) => ({ name, detail })),
  checks,
};
console.log(JSON.stringify(report, null, 2));
if (strict && blockers.length) process.exitCode = 1;
