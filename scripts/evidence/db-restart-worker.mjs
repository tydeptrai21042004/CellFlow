#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { CellFlowRepository, closeSql } from "../../packages/db/src/index.ts";

const mode = process.argv[2];
const repository = new CellFlowRepository();

try {
  if (mode === "create") {
    const suffix = randomUUID().slice(0, 8);
    const project = await repository.createProject({
      name: `restart-proof-${suffix}`,
      network: "testnet",
      confirmationPolicy: { mode: "depth", blocks: 4 },
      apiKeyId: randomUUID(),
      apiKeyPrefix: `cf_${suffix}`,
      apiKeyHash: `restart-proof-hash-${suffix}`,
    });
    const intentId = `restart-proof:${suffix}`;
    const txHash = `0x${"cd".repeat(32)}`;
    const { aggregate } = await repository.createIntent({
      project,
      intentId,
      metadata: { proof: "process-restart" },
      expectedCells: [],
      txHash,
      submissionStatus: "SUBMISSION_UNKNOWN",
    });
    console.log(JSON.stringify({
      projectId: project.id,
      intentId,
      intentRowId: aggregate.intent.id,
      executionId: aggregate.execution.id,
      txHash: aggregate.execution.txHash,
      submissionStatus: aggregate.execution.submissionStatus,
    }));
  } else if (mode === "read") {
    const projectId = process.argv[3];
    const intentId = process.argv[4];
    if (!projectId || !intentId) throw new Error("read mode requires projectId and intentId");
    const aggregate = await repository.getIntent(projectId, intentId);
    if (!aggregate) throw new Error("persisted intent not found after process restart");
    console.log(JSON.stringify({
      projectId,
      intentId,
      intentRowId: aggregate.intent.id,
      executionId: aggregate.execution.id,
      txHash: aggregate.execution.txHash,
      submissionStatus: aggregate.execution.submissionStatus,
    }));
  } else {
    throw new Error("mode must be create or read");
  }
} finally {
  await closeSql();
}
