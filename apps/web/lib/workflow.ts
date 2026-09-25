import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { CellFlowRepository } from "@cellflow/db";
import { transactionReconciliationWorkflow } from "../workflows/reconcile-intent.ts";

export async function startReconciliationWorkflow(projectId: string, intentId: string): Promise<string> {
  const repository = new CellFlowRepository();
  const claimId = `starting:${randomUUID()}`;
  const claimed = await repository.claimWorkflowStart(projectId, intentId, claimId);
  if (claimed !== claimId) return claimed ?? "already-active";
  try {
    const run = await start(transactionReconciliationWorkflow, [projectId, intentId]);
    await repository.replaceWorkflowClaim(projectId, intentId, claimId, run.runId);
    return run.runId;
  } catch (error) {
    await repository.releaseWorkflowClaim(projectId, intentId, claimId).catch(() => undefined);
    throw error;
  }
}
