import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const project = await projectFromRequest(request, "read");
    return Response.json({ metrics: await service.projectMetrics(project) });
  } catch (error) {
    return errorResponse(error, request);
  }
}
