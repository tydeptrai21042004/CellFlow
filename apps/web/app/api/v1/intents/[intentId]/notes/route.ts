import { errorResponse, operatorNoteSchema } from "@cellflow/api";
import { projectFromRequest, readJson, service } from "../../../../../../lib/server.ts";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const project = await projectFromRequest(request);
    const { intentId } = await context.params;
    const { note } = operatorNoteSchema.parse(await readJson(request));
    const intent = await service.addOperatorNote(project, intentId, note);
    return Response.json({ intent }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
