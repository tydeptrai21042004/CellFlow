import { errorResponse, prepareTransactionSchema } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request, "write");
    const { intentId } = await context.params;
    const { txHash, signedPayloadHashSha256, allowSignedPayloadRevision, inputOutPoints, inputRefs, attemptKind, parentAttemptId } = prepareTransactionSchema.parse(await readJson(request));
    const intent = await service.attachTransaction(
      project,
      intentId,
      txHash,
      "PREPARED",
      signedPayloadHashSha256,
      inputOutPoints,
      inputRefs,
      attemptKind,
      parentAttemptId,
      allowSignedPayloadRevision,
    );
    return Response.json({ intent });
  } catch (error) {
    return errorResponse(error, request);
  }
}
