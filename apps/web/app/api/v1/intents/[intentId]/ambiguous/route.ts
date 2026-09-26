import { errorResponse, submissionFailureSchema } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../../../lib/server.ts";
import { startReconciliationWorkflow } from "../../../../../../lib/workflow.ts";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request, "write");
    const { intentId } = await context.params;
    const body = await readJson(request);
    const hasFailure = Boolean(
      body && typeof body === "object" && !Array.isArray(body) &&
      Object.keys(body as Record<string, unknown>).length > 0,
    );
    const failure = hasFailure ? submissionFailureSchema.parse(body) : undefined;
    const intent = await service.markSubmission(project, intentId, "SUBMISSION_UNKNOWN", failure);
    const workflowRunId = await startReconciliationWorkflow(project.id, intentId);
    return Response.json({ intent, workflowRunId });
  } catch (error) {
    return errorResponse(error, request);
  }
}
