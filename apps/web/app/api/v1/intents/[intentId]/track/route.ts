import { errorResponse, txHashSchema } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../../../lib/server";
import { startReconciliationWorkflow } from "../../../../../../lib/workflow";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request);
    const { intentId } = await context.params;
    const { txHash } = txHashSchema.parse(await readJson(request));
    const intent = await service.attachTransaction(project, intentId, txHash, "SUBMITTED");
    const workflowRunId = await startReconciliationWorkflow(project.id, intentId);
    return Response.json({ intent, workflowRunId });
  } catch (error) {
    return errorResponse(error);
  }
}
