import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../../lib/server";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request);
    const { intentId } = await context.params;
    const aggregate = await service.getIntent(project, intentId);
    const intent = await service.repository.executionPublicView(aggregate);
    return Response.json({ intent });
  } catch (error) {
    return errorResponse(error);
  }
}
