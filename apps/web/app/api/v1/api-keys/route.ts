import { apiKeyCreateSchema, errorResponse } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../lib/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const project = await projectFromRequest(request);
    return Response.json({ keys: await service.listApiKeys(project) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const project = await projectFromRequest(request);
    const input = apiKeyCreateSchema.parse(await readJson(request));
    const key = await service.createApiKey(project, input.label);
    return Response.json({ key }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
