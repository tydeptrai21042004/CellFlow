import { errorResponse, prepareTransactionSchema } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request, "write");
    const { intentId } = await context.params;
    const { txHash, inputOutPoints } = prepareTransactionSchema.parse(await readJson(request));
    const intent = await service.attachTransaction(project, intentId, txHash, "PREPARED", inputOutPoints);
    return Response.json({ intent });
  } catch (error) {
    return errorResponse(error, request);
  }
}
