import { createIntentSchema, errorResponse } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const project = await projectFromRequest(request, "read");
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const page = await service.listIntents(
      project,
      Number.isFinite(limit) ? limit : 100,
      url.searchParams.get("cursor"),
    );
    return Response.json(page);
  } catch (error) {
    return errorResponse(error, request);
  }
}

export async function POST(request: Request) {
  try {
    const project = await projectFromRequest(request, "write");
    const input = createIntentSchema.parse(await readJson(request));
    const result = await service.createIntent(project, input);
    return Response.json({ intent: result.view, created: result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error, request);
  }
}
