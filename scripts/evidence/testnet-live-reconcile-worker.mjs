#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CellFlowClient } from "@cellflow/ccc";

const endpoint = process.env.CELLFLOW_URL?.trim();
const apiKey = process.env.CELLFLOW_API_KEY?.trim();
const intentId = process.env.CELLFLOW_RECOVERY_INTENT_ID?.trim();
const output = process.env.CELLFLOW_RECOVERY_OUTPUT?.trim();
const timeoutMs = Number(process.env.CELLFLOW_TESTNET_TIMEOUT_MS || 900_000);
const pollMs = Number(process.env.CELLFLOW_TESTNET_POLL_MS || 5_000);

if (!endpoint || !apiKey || !intentId || !output) {
  throw new Error("CELLFLOW_URL, CELLFLOW_API_KEY, CELLFLOW_RECOVERY_INTENT_ID and CELLFLOW_RECOVERY_OUTPUT are required");
}

const flow = new CellFlowClient({ endpoint, apiKey });
const startedAt = new Date().toISOString();
const deadline = Date.now() + timeoutMs;
const observations = [];
let final = null;

while (Date.now() < deadline) {
  try {
    await flow.reconcile(intentId);
  } catch (error) {
    observations.push({
      at: new Date().toISOString(),
      kind: "reconcile-error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  final = await flow.get(intentId);
  observations.push({
    at: new Date().toISOString(),
    kind: "state",
    status: final?.status ?? null,
    submissionStatus: final?.submissionStatus ?? null,
    chainStatus: final?.chainStatus ?? null,
    workflowStatus: final?.workflowStatus ?? null,
    assertionStatus: final?.assertionStatus ?? null,
    confirmationCount: final?.confirmationCount ?? null,
  });
  if (final && final.status === "CONFIRMED" && (!final.assertionStatus || final.assertionStatus === "VERIFIED")) break;
  if (final && ["REJECTED", "NODE_REJECTED", "CONFLICTED", "EXPIRED"].includes(final.status)) break;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
}

const document = {
  schemaVersion: "cellflow-testnet-new-process-recovery-v1",
  startedAt,
  finishedAt: new Date().toISOString(),
  pid: process.pid,
  intentId,
  observations,
  final,
  passed: Boolean(final && final.status === "CONFIRMED" && (!final.assertionStatus || final.assertionStatus === "VERIFIED")),
};

await writeFile(resolve(output), JSON.stringify(document, null, 2) + "\n", { mode: 0o600 });
if (!document.passed) process.exitCode = 2;
