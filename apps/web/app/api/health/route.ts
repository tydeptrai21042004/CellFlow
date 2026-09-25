import { errorResponse } from "@cellflow/api";
import { repository } from "../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const database = await repository.ping();
    return Response.json(
      { ok: database, database, service: "cellflow", version: "0.3.0" },
      { status: database ? 200 : 503, headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
