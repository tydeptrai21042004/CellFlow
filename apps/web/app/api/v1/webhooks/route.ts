import { errorResponse, webhookSchema } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const project = await projectFromRequest(request, "admin");
    return Response.json({ webhooks: await service.listWebhooks(project) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const project = await projectFromRequest(request, "admin");
    const input = webhookSchema.parse(await readJson(request));
    const webhook = await service.createWebhook(project, input.url);
    return Response.json({ webhook }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
