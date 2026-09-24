import { start } from "workflow/api";
import { transactionReconciliationWorkflow } from "../workflows/reconcile-intent";

export async function startReconciliationWorkflow(projectId: string, intentId: string): Promise<string> {
  const run = await start(transactionReconciliationWorkflow, [projectId, intentId]);
  return run.runId;
}
