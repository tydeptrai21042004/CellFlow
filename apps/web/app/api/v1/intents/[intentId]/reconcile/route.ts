import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../../../lib/server.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request, "write");
    const { intentId } = await context.params;
    const intent = await service.reconcile(project, intentId);
    return Response.json({ intent });
  } catch (error) {
    return errorResponse(error, request);
  }
}
