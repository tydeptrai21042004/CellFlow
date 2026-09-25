import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const project = await projectFromRequest(request, "read");
    return Response.json({ operations: await service.operationalHealth(project) });
  } catch (error) {
    return errorResponse(error);
  }
}
