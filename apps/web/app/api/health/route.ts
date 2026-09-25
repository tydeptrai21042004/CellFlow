import { errorResponse } from "@cellflow/api";
import { repository } from "../../../lib/server.ts";

export const runtime = "nodejs";

export async function GET() {
  try {
    const database = await repository.ping();
    return Response.json({ ok: true, database, service: "cellflow", version: "0.3.0" });
  } catch (error) {
    return errorResponse(error);
  }
}
