import { errorResponse, requireBootstrapToken, setupSchema } from "@cellflow/api";
import { readJson, service } from "../../../lib/server.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireBootstrapToken(request.headers.get("authorization"));
    const input = setupSchema.parse(await readJson(request));
    const result = await service.setupProject({
      name: input.name,
      network: input.network,
      ...(input.rpcUrl === undefined ? {} : { rpcUrl: input.rpcUrl }),
      ...(input.confirmationPolicy === undefined ? {} : { confirmationPolicy: input.confirmationPolicy }),
    });
    return Response.json({ project: result.project, apiKey: result.apiKey }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
