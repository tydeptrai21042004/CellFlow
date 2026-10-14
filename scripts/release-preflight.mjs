#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vercel = process.argv.includes("--vercel");
const strict = process.argv.includes("--strict") || vercel;
const checks = [];
// GitHub web uploads and some ZIP tools omit dotfiles. Those files are useful
// for developers and strict source releases, but none is read by Vercel at
// runtime. Do not block a production build for their absence; keep the missing
// artifacts visible as warnings and require them in `release:check`.
const sourceSupportFiles = new Set([
  ".nvmrc", ".gitignore", ".env.example", ".env.testnet.example",
]);
const sourceSupportSeverity = vercel ? "warning" : "blocker";

async function exists(path) {
  try { await access(join(root, path), constants.F_OK); return true; } catch { return false; }
}
function add(name, ok, severity, detail) { checks.push({ name, ok, severity, detail }); }

const nodeMajor = Number(process.versions.node.split(".")[0]);
add("node-version", nodeMajor === 22, "blocker", `Node ${process.versions.node}; required >=22 <23 to match package.json engines`);

const lockfile = await exists("package-lock.json");
add("dependency-lockfile", lockfile, vercel ? "warning" : "blocker", lockfile
  ? "package-lock.json present; npm ci reproducible"
  : "package-lock.json missing: Vercel may bootstrap with npm install; generate and commit a genuine lockfile for reproducible releases");
if (lockfile) {
  try {
    const parsed = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    add("lockfile-format", parsed.lockfileVersion >= 3 && parsed.name === "cellflow" && Boolean(parsed.packages?.[""]),
      "blocker", "npm workspace lockfile v3, named cellflow, with root package record");
  } catch {
    add("lockfile-format", false, "blocker", "package-lock.json could not be parsed");
  }
}

for (const path of [
  "packages/db/migrations/003_production_readiness.sql",
  "packages/db/migrations/004_operational_scalability.sql",
  "SECURITY.md",
  "docs/operations/RUNBOOK.md",
  "docs/funding/REVIEWER_VERIFICATION.md",
  "docs/funding/AUTOMATED_EVIDENCE.md",
  "docs/api/openapi.yaml",
  "scripts/generate-env.sh",
  "scripts/generate-lockfile.sh",
  "scripts/clean-release-check.sh",
  "scripts/evidence/testnet-preflight.mjs",
  "scripts/evidence/rpc-failover-proof.mjs",
  "scripts/evidence/db-restart-proof.mjs",
  "evidence/testnet/README.md",
  "evidence/testnet/manifest.example.json",
  ".nvmrc",
  ".gitignore",
  ".env.testnet.example",
]) add(`file:${path}`, await exists(path),
  sourceSupportFiles.has(path) ? sourceSupportSeverity : "blocker", path);

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

// Vercel-only deployment: GitHub Actions files are neither required nor checked.
const vercelConfigExists = await exists("vercel.json");
add("file:vercel.json", vercelConfigExists, "blocker", "Vercel deployment configuration");
if (vercelConfigExists) {
  try {
    const deploy = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
    add("vercel-install", deploy.installCommand === "node scripts/vercel-install.mjs", "blocker",
      "Vercel must use lock-aware installer (not unconditional npm ci)");
    add("vercel-build", deploy.buildCommand === "npm run ci:vercel", "blocker",
      "Vercel runs deployment preflight, regression checks and Next.js build");
    add("vercel-maintenance", Array.isArray(deploy.crons) && deploy.crons.some(c => c.path === "/api/internal/maintenance"),
      "blocker", "Vercel owns scheduled maintenance; GitHub Actions not required");
  } catch { add("vercel-config-json", false, "blocker", "Invalid vercel.json"); }
}
add("file:scripts/vercel-install.mjs", await exists("scripts/vercel-install.mjs"), "blocker", "lock-aware Vercel installer");

const envExampleExists = await exists(".env.example");
add("file:.env.example", envExampleExists, sourceSupportSeverity, envExampleExists ? ".env.example present" : ".env.example missing");
if (envExampleExists) {
  const envExample = await readFile(join(root, ".env.example"), "utf8");
  for (const key of [
    "DATABASE_URL", "CKB_NETWORK", "CKB_RPC_URL", "CKB_EXPECTED_GENESIS_HASH",
    "CELLFLOW_ENCRYPTION_KEY", "CELLFLOW_BOOTSTRAP_TOKEN", "CELLFLOW_SETUP_ENABLED", "CRON_SECRET",
    "CELLFLOW_RECONCILE_CONCURRENCY", "CELLFLOW_WEBHOOK_CONCURRENCY", "CELLFLOW_WEBHOOK_MAX_ATTEMPTS",
    "CKB_RPC_CIRCUIT_FAILURES", "CKB_RPC_CIRCUIT_COOLDOWN_MS", "CKB_ALLOW_INSECURE_RPC",
  ]) add(`env-template:${key}`, envExample.includes(`${key}=`), sourceSupportSeverity, `${key} documented`);
}

const blockers = checks.filter((item) => item.severity === "blocker" && !item.ok);
const warnings = checks.filter((item) => item.severity === "warning" && !item.ok);
const report = {
  schemaVersion: "cellflow-release-preflight-v1",
  version: "0.3.0",
  generatedAt: new Date().toISOString(),
  // Reproducible source-release readiness is stricter than deploy readiness.
  // This is intentionally false when any source-only support file is missing.
  readyForCleanReleasePipeline: blockers.length === 0 && lockfile &&
    !warnings.some((item) => item.name.startsWith("env-template:") ||
      [...sourceSupportFiles].some((path) => item.name === `file:${path}`)),
  readyForVercelDeployment: blockers.length === 0,
  reproducibleDependencies: lockfile,
  blockers: blockers.map(({ name, detail }) => ({ name, detail })),
  warnings: warnings.map(({ name, detail }) => ({ name, detail })),
  deploymentMode: vercel ? "vercel" : "strict-release",
  checks,
};
console.log(JSON.stringify(report, null, 2));
if (strict && blockers.length) process.exitCode = 1;
