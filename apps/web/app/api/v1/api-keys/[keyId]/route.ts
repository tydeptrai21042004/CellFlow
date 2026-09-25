import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ keyId: string }> }) {
  try {
    const project = await projectFromRequest(request);
    const { keyId } = await context.params;
    await service.revokeApiKey(project, keyId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
