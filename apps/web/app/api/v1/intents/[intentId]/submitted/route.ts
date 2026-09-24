import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../../../lib/server";
import { startReconciliationWorkflow } from "../../../../../../lib/workflow";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request);
    const { intentId } = await context.params;
    const intent = await service.markSubmission(project, intentId, "SUBMITTED");
    const workflowRunId = await startReconciliationWorkflow(project.id, intentId);
    return Response.json({ intent, workflowRunId });
  } catch (error) {
    return errorResponse(error);
  }
}
