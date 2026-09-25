import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request, "read");
    const { intentId } = await context.params;
    const evidence = await service.evidence(project, intentId, false);
    return Response.json({ evidence });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request, "admin");
    const { intentId } = await context.params;
    const evidence = await service.evidence(project, intentId, true);
    return Response.json({ evidence }, { status: 201 });
  } catch (error) {
    return errorResponse(error, request);
  }
}
