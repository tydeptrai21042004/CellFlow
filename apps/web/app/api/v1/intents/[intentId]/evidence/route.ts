import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request, "read");
    const { intentId } = await context.params;
    const evidence = await service.evidence(project, intentId);
    return Response.json({ evidence });
  } catch (error) {
    return errorResponse(error);
  }
}
