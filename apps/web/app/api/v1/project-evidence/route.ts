import { errorResponse } from "@cellflow/api";
import { projectFromRequest, service } from "../../../../lib/server.ts";

export const runtime = "nodejs";

// Read-only snapshot: safe for reviewer/observer credentials and has no database-write side effect.
export async function GET(request: Request) {
  try {
    const project = await projectFromRequest(request, "read");
    const evidence = await service.projectEvidence(project, false);
    return Response.json({ evidence });
  } catch (error) {
    return errorResponse(error, request);
  }
}

// Explicitly records an immutable audit/export row. Admin is required because this mutates durable state.
export async function POST(request: Request) {
  try {
    const project = await projectFromRequest(request, "admin");
    const evidence = await service.projectEvidence(project, true);
    return Response.json({ evidence }, { status: 201 });
  } catch (error) {
    return errorResponse(error, request);
  }
}
