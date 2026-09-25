import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ endpointId: string }> }) {
  try {
    const project = await projectFromRequest(request);
    const { endpointId } = await context.params;
    await service.disableWebhook(project, endpointId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
