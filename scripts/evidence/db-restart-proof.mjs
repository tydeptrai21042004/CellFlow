#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; run migrations first");
const worker = fileURLToPath(new URL("./db-restart-worker.mjs", import.meta.url));

function run(args) {
  const result = spawnSync(process.execPath, ["--experimental-transform-types", worker, ...args], {
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `worker exited ${result.status}`);
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  return JSON.parse(line);
}

const before = run(["create"]);
// A different OS process is now started. No JS heap/module state from the creator survives.
const after = run(["read", before.projectId, before.intentId]);

const checks = {
  sameIntentRow: before.intentRowId === after.intentRowId,
  sameExecution: before.executionId === after.executionId,
  sameTxHash: before.txHash === after.txHash,
  submissionUnknownPersisted: before.submissionStatus === "SUBMISSION_UNKNOWN" && after.submissionStatus === "SUBMISSION_UNKNOWN",
};
const proof = {
  schemaVersion: "cellflow-db-process-restart-proof-v1",
  generatedAt: new Date().toISOString(),
  claim: "Persisted operation identity survives a full Node.js process boundary; in-memory continuity is not required for retrieval.",
  limitation: "This is a PostgreSQL durability proof, not a real CKB broadcast/redeploy proof.",
  before,
  after,
  checks,
  passed: Object.values(checks).every(Boolean),
};
const body = JSON.stringify(proof, null, 2) + "\n";
const sha256 = createHash("sha256").update(body).digest("hex");
const output = { ...proof, documentSha256: sha256 };

const outDir = resolve(process.env.CELLFLOW_EVIDENCE_DIR || "evidence/testnet/generated");
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = resolve(outDir, `db-process-restart-${stamp}.json`);
await writeFile(filename, JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ output: filename, sha256, proof: output }, null, 2));
if (!output.passed) process.exitCode = 2;
