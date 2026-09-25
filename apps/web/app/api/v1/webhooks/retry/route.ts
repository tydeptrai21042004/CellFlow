import { errorResponse, webhookRetrySchema } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const project = await projectFromRequest(request, "admin");
    const input = webhookRetrySchema.parse(await readJson(request));
    const retried = await service.retryWebhookFailures(project, input.endpointId);
    return Response.json({ retried });
  } catch (error) {
    return errorResponse(error);
  }
}
