import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request);
    const { intentId } = await context.params;
    const intent = await service.intentDetail(project, intentId);
    return Response.json({ intent });
  } catch (error) {
    return errorResponse(error);
  }
}
