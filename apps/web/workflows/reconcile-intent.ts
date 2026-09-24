import { sleep } from "workflow";

interface WorkflowStepResult {
  status: string;
  terminal: boolean;
  nextDelay: "12s" | "20s" | "30s" | "1m" | "2m";
}

async function reconcileIntentStep(projectId: string, intentId: string): Promise<WorkflowStepResult> {
  "use step";
  const { CellFlowRepository } = await import("@cellflow/db");
  const { reconcileIntent } = await import("@cellflow/reconcile");
  const repository = new CellFlowRepository();
  const aggregate = await repository.getIntent(projectId, intentId);
  if (!aggregate) return { status: "MISSING", terminal: true, nextDelay: "30s" };

  const result = await reconcileIntent(aggregate, repository);
  const terminal = ["CONFIRMED", "REJECTED", "CONFLICTED", "EXPIRED"].includes(result.status);
  const nextDelay: WorkflowStepResult["nextDelay"] =
    result.status === "COMMITTED" ? "12s" :
    result.status === "PROPOSED" ? "20s" :
    result.status === "PENDING" ? "20s" :
    result.status === "REORGED" ? "30s" :
    result.status === "RECONCILING" || result.status === "UNKNOWN" ? "1m" : "30s";
  return { status: result.status, terminal, nextDelay };
}

export async function transactionReconciliationWorkflow(
  projectId: string,
  intentId: string,
): Promise<{ intentId: string; finalStatus: string; iterations: number }> {
  "use workflow";

  // A bounded workflow prevents accidental immortal runs. If this horizon is
  // reached, the database-backed maintenance sweep can continue reconciliation.
  for (let iterations = 1; iterations <= 720; iterations += 1) {
    const result = await reconcileIntentStep(projectId, intentId);
    if (result.terminal) return { intentId, finalStatus: result.status, iterations };
    await sleep(result.nextDelay);
  }
  return { intentId, finalStatus: "WORKFLOW_HORIZON_REACHED", iterations: 720 };
}
