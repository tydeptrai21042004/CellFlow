import { errorResponse, submissionFailureSchema } from "@cellflow/api";
import { CellFlowError } from "@cellflow/core";
import { projectFromRequest, readJson, service } from "../../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request, "write");
    const { intentId } = await context.params;
    const failure = submissionFailureSchema.parse(await readJson(request));
    if (failure.errorType !== "RPC_REJECTION") {
      throw new CellFlowError("TRANSITION_INVALID", "Rejected submissions must use RPC_REJECTION evidence", 400);
    }
    const intent = await service.markSubmission(project, intentId, "NODE_REJECTED", failure);
    return Response.json({ intent });
  } catch (error) {
    return errorResponse(error, request);
  }
}
