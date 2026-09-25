import { sleep } from "workflow";

interface WorkflowStepResult {
  status: string;
  terminal: boolean;
  nextDelay: "12s" | "20s" | "30s" | "1m" | "2m" | "5m";
}

function workflowDelay(ms: number | null): WorkflowStepResult["nextDelay"] {
  if (ms === null || ms <= 12_000) return "12s";
  if (ms <= 20_000) return "20s";
  if (ms <= 30_000) return "30s";
  if (ms <= 60_000) return "1m";
  if (ms <= 120_000) return "2m";
  return "5m";
}

async function reconcileIntentStep(projectId: string, intentId: string): Promise<WorkflowStepResult> {
  "use step";
  const { CellFlowRepository } = await import("@cellflow/db");
  const { reconcileIntent } = await import("@cellflow/reconcile");
  const repository = new CellFlowRepository();
  const aggregate = await repository.getIntent(projectId, intentId);
  if (!aggregate) return { status: "MISSING", terminal: true, nextDelay: "30s" };
  const result = await reconcileIntent(aggregate, repository);
  return { status: result.status, terminal: result.terminal, nextDelay: workflowDelay(result.nextDelayMs) };
}

async function markWorkflowComplete(projectId: string, intentId: string): Promise<void> {
  "use step";
  const { CellFlowRepository } = await import("@cellflow/db");
  await new CellFlowRepository().markWorkflowCompleted(projectId, intentId);
}

export async function transactionReconciliationWorkflow(
  projectId: string,
  intentId: string,
): Promise<{ intentId: string; finalStatus: string; iterations: number }> {
  "use workflow";
  for (let iterations = 1; iterations <= 720; iterations += 1) {
    const result = await reconcileIntentStep(projectId, intentId);
    if (result.terminal) {
      await markWorkflowComplete(projectId, intentId);
      return { intentId, finalStatus: result.status, iterations };
    }
    await sleep(result.nextDelay);
  }
  await markWorkflowComplete(projectId, intentId);
  return { intentId, finalStatus: "WORKFLOW_HORIZON_REACHED", iterations: 720 };
}
